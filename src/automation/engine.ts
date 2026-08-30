import { LgThinQClient } from '../lg/client';
import { TuyaClient } from '../tuya/client';
import { AutomationStateStore } from './stateStore';
import {
  AutomationResult,
  AutomationAction,
  StructuredLogEvent,
} from './types';

export const SHUTDOWN_DELAY_MS = 3 * 60 * 1000; // 3 minutes = 180,000 ms

export class AutomationEngine {
  private lgClient: LgThinQClient;
  private tuyaClient: TuyaClient;

  constructor(lgClient?: LgThinQClient, tuyaClient?: TuyaClient) {
    this.lgClient = lgClient || new LgThinQClient();
    this.tuyaClient = tuyaClient || new TuyaClient();
  }

  public async evaluateAndExecute(currentTime?: number): Promise<AutomationResult> {
    const now = currentTime || Date.now();
    const isoTimestamp = new Date(now).toISOString();

    let lgStatus;
    try {
      lgStatus = await this.lgClient.getCooktopStatus();
    } catch (err: any) {
      console.error('[LG API Failure]', err.message);

      const result: AutomationResult = {
        action: 'SKIPPED_LG_ERROR',
        inductionState: 'UNKNOWN',
        hoodState: 'UNKNOWN',
        changed: false,
        remainingDelaySeconds: 0,
        message: `LG ThinQ API error: ${err.message}. Safely maintaining current hood state.`,
        evaluatedAt: isoTimestamp,
      };

      this.logStructuredEvent(result, now);
      return result;
    }

    let tuyaStatus;
    try {
      tuyaStatus = await this.tuyaClient.getStatus();
    } catch (err: any) {
      console.error('[Tuya API Failure]', err.message);

      const result: AutomationResult = {
        action: 'SKIPPED_TUYA_ERROR',
        inductionState: lgStatus.isOperating ? 'ON' : 'OFF',
        hoodState: 'UNKNOWN',
        changed: false,
        remainingDelaySeconds: 0,
        message: `Tuya API error: ${err.message}. Could not query smart plug state.`,
        evaluatedAt: isoTimestamp,
      };

      this.logStructuredEvent(result, now);
      return result;
    }

    const state = AutomationStateStore.loadState();
    const lgIsActive = lgStatus.isOperating;
    const plugIsOn = tuyaStatus.switch_1;

    let action: AutomationAction;
    let changed = false;
    let remainingDelaySeconds = 0;
    let message = '';
    let finalHoodState: 'ON' | 'OFF' = plugIsOn ? 'ON' : 'OFF';

    if (lgIsActive) {
      // Cooktop is operating -> Hood MUST be ON immediately
      AutomationStateStore.saveState({
        lastInductionState: 'ON',
        lastActiveTimestamp: now,
        lastOffDetectedTimestamp: 0,
        lastHoodCommand: 'ON',
      });

      if (plugIsOn) {
        action = 'ALREADY_ON';
        changed = false;
        message = 'Induction cooktop is ACTIVE. Hood plug is already ON.';
      } else {
        const controlRes = await this.tuyaClient.setPlugState(true);
        action = 'TURN_ON';
        changed = controlRes.changed;
        finalHoodState = 'ON';
        message = 'Induction cooktop active. Turned kitchen hood plug ON.';
      }
    } else {
      // Cooktop is INACTIVE -> Evaluate 3-minute shutdown delay
      const lastActive = state.lastActiveTimestamp;

      let timeSinceActive = Infinity;
      if (lastActive > 0) {
        timeSinceActive = now - lastActive;
      }

      if (timeSinceActive < SHUTDOWN_DELAY_MS) {
        // Shutdown delay pending -> Keep hood ON
        const remainingMs = SHUTDOWN_DELAY_MS - timeSinceActive;
        remainingDelaySeconds = Math.ceil(remainingMs / 1000);
        action = 'WAITING_SHUTDOWN_DELAY';
        changed = false;

        const secondsSinceOff = Math.round(timeSinceActive / 1000);
        message = `Induction stopped ${secondsSinceOff}s ago. Waiting 3-minute shutdown delay (${remainingDelaySeconds}s remaining) before turning hood OFF.`;
      } else {
        // Delay elapsed (or no active history) -> Hood MUST be OFF
        AutomationStateStore.saveState({
          lastInductionState: 'OFF',
          lastHoodCommand: 'OFF',
        });

        if (!plugIsOn) {
          action = 'ALREADY_OFF';
          changed = false;
          message = 'Induction inactive for >= 3 minutes. Hood plug is already OFF.';
        } else {
          const controlRes = await this.tuyaClient.setPlugState(false);
          action = 'TURN_OFF';
          changed = controlRes.changed;
          finalHoodState = 'OFF';
          message = 'Induction inactive for >= 3 minutes. Turned kitchen hood plug OFF.';
        }
      }
    }

    const result: AutomationResult = {
      action,
      inductionState: lgIsActive ? 'ON' : 'OFF',
      hoodState: finalHoodState,
      changed,
      remainingDelaySeconds,
      message,
      evaluatedAt: isoTimestamp,
    };

    this.logStructuredEvent(result, now);
    return result;
  }

  private logStructuredEvent(result: AutomationResult, now: number): void {
    const logEvent: StructuredLogEvent = {
      event: 'hood_automation',
      induction: result.inductionState,
      hood: result.hoodState,
      action: result.action,
      changed: result.changed,
      remainingDelaySeconds: result.remainingDelaySeconds,
      message: result.message,
      timestamp: new Date(now).toISOString(),
    };

    console.log(JSON.stringify(logEvent));
  }
}
