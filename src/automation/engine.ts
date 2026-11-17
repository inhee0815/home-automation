import { LgThinQClient } from '../lg/client';
import { TuyaClient } from '../tuya/client';
import { sendDirectPlugCommand } from '../tuya/directCommand';
import { BlobStateRepository, HoodState, Power, StateRepository } from './stateStore';
import { AutomationResult } from './types';
import { notifyIncident } from './notification';
import { runtimeEnabled } from './runtimeSwitch';

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

    const verifyDue = process.env.TUYA_PERIODIC_VERIFY === 'true'
      && (!state.lastVerifiedAt || now - state.lastVerifiedAt >= verificationMs());

    if (state.confirmed === target && !verifyDue) {
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
      return result('SKIPPED_TUYA_ERROR', induction, state.confirmed, 'Circuit breaker open; manual reset required.');
    }
    // When an OFF cooldown is pending, a new ON target must not be blocked by
    // that previous target. Verify the physical plug before issuing ON.
    if (target === 'ON' && state.desired === 'OFF' && now < state.nextRetryAt) {
      try {
        const observed = await this.tuyaClient.getStatus();
        if (!observed.online) throw new Error('Tuya device offline');
        next.lastVerifiedAt = now;
        next.confirmed = observed.switch_1 ? 'ON' : 'OFF';
        next.nextRetryAt = 0;
        if (next.confirmed === 'ON') {
          next.failureCount = 0;
          await this.store.save(next);
          return result('ALREADY_ON', induction, 'ON', 'ON target: plug already ON; previous OFF cooldown cleared.');
        }
        await this.store.save(next);
      } catch {
        next.nextRetryAt = now + retryMs();
        await this.store.save(next);
        return result('SKIPPED_TUYA_ERROR', induction, 'UNKNOWN', 'New ON target verification failed; retry delayed.');
      }
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
        next.confirmed = observed.switch_1 ? 'ON' : 'OFF';
        next.lastVerifiedAt = now;
        if (next.confirmed === target) {
          await this.store.save(next);
          return result(target === 'ON' ? 'ALREADY_ON' : 'ALREADY_OFF', induction, target, 'Periodic verification matched.');
        }
      }
      if (!(await runtimeEnabled())) return result('SKIPPED_TUYA_ERROR', induction, next.confirmed, 'Runtime interlock is off.');
      await sendDirectPlugCommand(target === 'ON');
      next.confirmed = 'UNKNOWN'; // Accepted != physically confirmed.
      next.lastCommandAt = now;
      next.lastVerifiedAt = null;
      next.failureCount = 0;
      next.nextRetryAt = now + retryMs();
      await this.store.save(next);
      return result(target === 'ON' ? 'TURN_ON' : 'TURN_OFF', induction, 'UNKNOWN', 'Tuya command accepted; physical state unverified.', true);
    } catch {
      next.confirmed = 'UNKNOWN';
      next.failureCount = state.failureCount + 1;
      next.nextRetryAt = now + Math.min(3600000, retryMs() * Math.pow(2, Math.min(5, next.failureCount - 1)));
      await this.store.save(next);
      await notifyIncident('TUYA_UNAVAILABLE', '후드 전원 변경 명령이 실패했습니다.');
      return result('SKIPPED_TUYA_ERROR', induction, 'UNKNOWN', 'Tuya command failed; retry delayed.');
    }
  }
}
