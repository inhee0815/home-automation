import { LgThinQClient } from '../lg/client';
import { TuyaClient } from '../tuya/client';
import { sendDirectPlugCommand } from '../tuya/directCommand';
import { BlobStateRepository, HoodState, Power, StateRepository } from './stateStore';
import { AutomationResult } from './types';
import { notifyIncident } from './notification';
import { runtimeEnabled } from './runtimeSwitch';
import { classifyTuyaFailure } from '../tuya/failure';

export const SHUTDOWN_DELAY_MS = Math.max(0, Number(process.env.SHUTDOWN_DELAY_SECONDS ?? 90)) * 1000;
const retryMs = () => Math.max(60, Number(process.env.CONTROL_RETRY_SECONDS ?? 300)) * 1000;
const verificationMs = () => Math.max(3600, Number(process.env.TUYA_VERIFY_SECONDS ?? 86400)) * 1000;

export class AutomationEngine {
  constructor(
    private readonly lgClient = new LgThinQClient(),
    private readonly tuyaClient = new TuyaClient(),
    private readonly store: StateRepository = new BlobStateRepository(),
  ) {}

  async evaluateAndExecute(now = Date.now()): Promise<AutomationResult> {
    const evaluatedAt = new Date(now).toISOString();
    const result = (
      action: AutomationResult['action'], inductionState: AutomationResult['inductionState'],
      hoodState: AutomationResult['hoodState'], message: string, changed = false, remainingDelaySeconds = 0,
    ): AutomationResult => ({ action, inductionState, hoodState, changed, remainingDelaySeconds, message, evaluatedAt });

    // Default disabled: no external network calls, and no writes to Blobs.
    if (!(await runtimeEnabled()))
      return result('SKIPPED_TUYA_ERROR', 'UNKNOWN', 'UNKNOWN', 'Automation is disabled.');

    let lg;
    try { lg = await this.lgClient.getCooktopStatus(); }
    catch { return result('SKIPPED_LG_ERROR', 'UNKNOWN', 'UNKNOWN', 'LG API unavailable; hood unchanged.'); }
    if (!lg.online || lg.powerState === 'UNKNOWN')
      return result('SKIPPED_LG_ERROR', 'UNKNOWN', 'UNKNOWN', 'LG state offline or unknown; hood unchanged.');

    const induction: Power = lg.isOperating ? 'ON' : 'OFF';
    let state: HoodState | null;
    try { state = await this.store.load(); }
    catch { return result('SKIPPED_TUYA_ERROR', induction, 'UNKNOWN', 'State store unavailable; hood unchanged.'); }
    if (!state) {
      const initial: HoodState = {
        induction, desired: 'UNKNOWN', confirmed: 'UNKNOWN',
        offDetectedAt: induction === 'OFF' ? now : null,
        lastCommandAt: null, lastVerifiedAt: null, failureCount: 0, nextRetryAt: 0, updatedAt: now,
      };
      await this.store.save(initial);
      return result('WAITING_SHUTDOWN_DELAY', induction, 'UNKNOWN', 'Initialized persistent state; no device command.');
    }

    const next: HoodState = { ...state, induction, updatedAt: now };
    next.offDetectedAt = induction === 'OFF' ? (state.induction === 'OFF' ? state.offDetectedAt ?? now : now) : null;
    const remaining = induction === 'OFF' ? Math.max(0, next.offDetectedAt! + SHUTDOWN_DELAY_MS - now) : 0;
    const target: Power | null = induction === 'ON' ? 'ON' : remaining === 0 ? 'OFF' : null;
    if (!target) {
      await this.store.save(next);
      return result('WAITING_SHUTDOWN_DELAY', induction, next.confirmed, 'Waiting after first OFF observation.', false, Math.ceil(remaining / 1000));
    }
    next.desired = target;

    // Cached plug state can be stale after manual control. On every actual
    // target transition, verify the physical Tuya switch before deciding.
    if (state.desired !== 'UNKNOWN' && state.desired !== target) {
      try {
        const observed = await this.tuyaClient.getStatus();
        if (!observed.online || typeof observed.switch_1 !== 'boolean')
          throw new Error('Tuya device offline or switch status unavailable');
        next.confirmed = observed.switch_1 ? 'ON' : 'OFF';
        next.lastVerifiedAt = now;
        if (next.confirmed === target) {
          next.failureCount = 0;
          next.nextRetryAt = 0;
          await this.store.save(next);
          return result(target === 'ON' ? 'ALREADY_ON' : 'ALREADY_OFF', induction, target, 'Verified plug already matches new target.');
        }
        if (state.failureCount < 3) next.nextRetryAt = 0;
      } catch (error) {
        next.confirmed = 'UNKNOWN';
        next.lastFailureReason = classifyTuyaFailure(error);
        next.lastFailureAt = now;
        next.nextRetryAt = now + retryMs();
        await this.store.save(next);
        return result('SKIPPED_TUYA_ERROR', induction, 'UNKNOWN', 'Target change verification failed; no command.');
      }
    }

    // One initial status read, never a read on every scheduled invocation.
    if (state.desired === 'UNKNOWN' && state.confirmed === 'UNKNOWN') {
      try {
        const observed = await this.tuyaClient.getStatus();
        next.confirmed = observed.switch_1 ? 'ON' : 'OFF';
        next.lastVerifiedAt = now;
        await this.store.save(next);
        return result('WAITING_SHUTDOWN_DELAY', induction, next.confirmed, 'Established hardware baseline; no command.');
      } catch {
        return result('SKIPPED_TUYA_ERROR', induction, 'UNKNOWN', 'Tuya baseline read failed.');
      }
    }

    // OFF is safety-relevant: a cached OFF is not evidence that the plug is
    // currently OFF. Reconcile shortly after shutdown, then at a lower idle
    // frequency to avoid exceeding the daily Tuya request budget.
    const recentOff = next.offDetectedAt !== null && now - next.offDetectedAt <= 15 * 60_000;
    const offIntervalMs = recentOff ? 3 * 60_000 : 60 * 60_000;
    const offConfirmationStale = target === 'OFF' && next.confirmed === 'OFF'
      && (!state.lastVerifiedAt
        || (next.offDetectedAt !== null && state.lastVerifiedAt < next.offDetectedAt)
        || now - state.lastVerifiedAt >= offIntervalMs);
    const verifyDue = offConfirmationStale ||
      (process.env.TUYA_PERIODIC_VERIFY === 'true'
       && (!state.lastVerifiedAt || now - state.lastVerifiedAt >= verificationMs()));

    if (next.confirmed === target && !verifyDue) {
      await this.store.save(next);
      return result(target === 'ON' ? 'ALREADY_ON' : 'ALREADY_OFF', induction, target, 'Cached target matches; no Tuya API request.');
    }

    // Command acceptance is not physical verification. Re-check after cooldown.
    if (state.confirmed === 'UNKNOWN' && state.lastCommandAt && now >= state.nextRetryAt && state.desired === target) {
      try {
        const observed = await this.tuyaClient.getStatus();
        next.lastVerifiedAt = now;
        next.confirmed = observed.switch_1 ? 'ON' : 'OFF';
        if (next.confirmed === target) {
          next.failureCount = 0;
          await this.store.save(next);
          return result(target === 'ON' ? 'ALREADY_ON' : 'ALREADY_OFF', induction, target, 'Verified previously accepted command.');
        }
      } catch {
        next.nextRetryAt = now + retryMs();
        await this.store.save(next);
        await notifyIncident('HOOD_UNVERIFIED', '명령 후 Tuya 상태 확인에 실패했습니다.');
        return result('SKIPPED_TUYA_ERROR', induction, 'UNKNOWN', 'Post-command verification failed; retry delayed.');
      }
    }

    if (state.failureCount >= 3) {
      await notifyIncident('TUYA_UNAVAILABLE', '명령 실패 누적으로 제어가 차단되었습니다.');
      await this.store.save(next);
      return result('SKIPPED_TUYA_ERROR', induction, state.confirmed, 'Circuit breaker open; manual reset required. Last failure: '+(state.lastFailureReason||'UNKNOWN'));
    }
    if (now < next.nextRetryAt) {
      await this.store.save(next);
      return result('SKIPPED_TUYA_ERROR', induction, state.confirmed, 'Command cooldown/backoff active.');
    }
    if (process.env.TUYA_COMMANDS_ENABLED !== 'true') {
      await this.store.save(next);
      return result('SKIPPED_TUYA_ERROR', induction, state.confirmed, 'Commands disabled.');
    }
    try {
      if (verifyDue && state.confirmed === target) {
        const observed = await this.tuyaClient.getStatus();
        if (!observed.online || typeof observed.switch_1 !== 'boolean')
          throw new Error('Tuya plug state unavailable');
        next.confirmed = observed.switch_1 ? 'ON' : 'OFF';
        next.lastVerifiedAt = now;
        if (next.confirmed === target) {
          next.failureCount = 0;
          await this.store.save(next);
          return result(target === 'ON' ? 'ALREADY_ON' : 'ALREADY_OFF', induction, target, 'Verified actual Tuya switch matches target.');
        }
      }
      if (!(await runtimeEnabled())) return result('SKIPPED_TUYA_ERROR', induction, next.confirmed, 'Runtime interlock is off.');
      // Check LG again just before sending a physical command. The induction
      // may have changed while Tuya was queried or between scheduler ticks.
      let freshLg;
      try { freshLg = await this.lgClient.getCooktopStatus(); }
      catch { await this.store.save(next); return result('SKIPPED_LG_ERROR', 'UNKNOWN', next.confirmed, 'Final LG check failed; command cancelled.'); }
      if (!freshLg.online || freshLg.powerState === 'UNKNOWN' ||
          (freshLg.isOperating ? 'ON' : 'OFF') !== induction) {
        await this.store.save(next);
        return result('SKIPPED_LG_ERROR', 'UNKNOWN', next.confirmed, 'Induction changed during evaluation; command cancelled.');
      }
      await sendDirectPlugCommand(target === 'ON');
      next.confirmed = 'UNKNOWN'; // Accepted != physically confirmed.
      next.lastCommandAt = now;
      next.lastVerifiedAt = null;
      next.failureCount = 0;
      next.nextRetryAt = now + 60_000;
      await this.store.save(next);
      return result(target === 'ON' ? 'TURN_ON' : 'TURN_OFF', induction, 'UNKNOWN', 'Tuya command accepted; physical state unverified.', true);
    } catch (error) {
      next.confirmed = 'UNKNOWN';
      next.lastFailureReason = classifyTuyaFailure(error);
      next.lastFailureAt = now;
      next.failureCount = state.failureCount + 1;
      next.nextRetryAt = now + Math.min(3600000, retryMs() * Math.pow(2, Math.min(5, next.failureCount - 1)));
      await this.store.save(next);
      await notifyIncident('TUYA_UNAVAILABLE', '후드 전원 변경 명령이 실패했습니다.');
      return result('SKIPPED_TUYA_ERROR', induction, 'UNKNOWN', 'Tuya command failed ('+next.lastFailureReason+'); retry delayed.');
    }
  }
}
