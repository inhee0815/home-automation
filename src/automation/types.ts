export interface AutomationStoreState {
  lastInductionState: 'ON' | 'OFF' | 'UNKNOWN';
  lastActiveTimestamp: number;
  lastOffDetectedTimestamp: number;
  lastHoodCommand: 'ON' | 'OFF' | 'NONE';
  lastEvaluatedAt: number;
}

export type AutomationAction =
  | 'TURN_ON'
  | 'TURN_OFF'
  | 'ALREADY_ON'
  | 'ALREADY_OFF'
  | 'WAITING_SHUTDOWN_DELAY'
  | 'SKIPPED_LG_ERROR'
  | 'SKIPPED_TUYA_ERROR';

export interface AutomationResult {
  action: AutomationAction;
  inductionState: 'ON' | 'OFF' | 'UNKNOWN';
  hoodState: 'ON' | 'OFF' | 'UNKNOWN';
  changed: boolean;
  remainingDelaySeconds: number;
  message: string;
  evaluatedAt: string;
}

export interface StructuredLogEvent {
  event: 'hood_automation';
  induction: 'ON' | 'OFF' | 'UNKNOWN';
  hood: 'ON' | 'OFF' | 'UNKNOWN';
  action: AutomationAction;
  changed: boolean;
  remainingDelaySeconds?: number;
  message: string;
  timestamp: string;
}
