import { getStore } from '@netlify/blobs';
import type { AutomationResult } from './types';

export type MonitorOutcome = 'PAUSED' | 'OK' | 'ERROR';
export interface RunRecord {
  time: string;
  outcome: MonitorOutcome;
  action: string;
  induction: string;
  hood: string;
}
function store() {
  return getStore({name:process.env.AUTOMATION_BLOB_STORE || 'home-automation-prod',consistency:'strong'});
}
export async function recordRun(outcome: MonitorOutcome, result?: AutomationResult): Promise<void> {
  const now = new Date();
  const entry: RunRecord = {
    time:now.toISOString(),outcome,action:result?.action || outcome,
    induction:result?.inductionState || 'UNKNOWN',hood:result?.hoodState || 'UNKNOWN',
  };
  try {
    const s = store();
    await s.setJSON('monitor/latest',entry);
    // Each run has a unique history entry. Retain meaningful events and periodic heartbeats.
    if (outcome !== 'OK' || now.getUTCMinutes()%15 === 0) {
      await s.setJSON('monitor/runs/'+now.toISOString()+'-'+Math.random().toString(36).slice(2,8),entry);
    }
  } catch (error) {
    console.error(JSON.stringify({event:'netlify_blobs_error',operation:'monitoring_write',errorType:error instanceof Error ? error.name : 'UnknownError'}));
  }
}
