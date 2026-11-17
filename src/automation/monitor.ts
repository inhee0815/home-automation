import { getStore } from '@netlify/blobs';
import type { AutomationResult } from './types';

export type MonitorOutcome = 'PAUSED' | 'OK' | 'ERROR';
export interface RunRecord {
  time: string;
  outcome: MonitorOutcome;
  action: string;
  induction: string;
  hood: string;
  message?: string;
  changed?: boolean;
}
function store() {
  return getStore({name:process.env.AUTOMATION_BLOB_STORE || 'home-automation-prod',consistency:'eventual'});
}
export async function recordRun(outcome: MonitorOutcome, result?: AutomationResult): Promise<boolean> {
  const now = new Date();
  const entry: RunRecord = {
    time:now.toISOString(),outcome,action:result?.action || outcome,
    induction:result?.inductionState || 'UNKNOWN',hood:result?.hoodState || 'UNKNOWN',
    message: result?.message,changed: result?.changed ?? false,
  };
  try {
    const s = store();
    await s.setJSON('monitor/latest',entry);
    // Each run has a unique history entry. Retain meaningful events and periodic heartbeats.
    if (outcome !== 'OK' || result?.changed || (result && !['ALREADY_ON','ALREADY_OFF','WAITING_SHUTDOWN_DELAY'].includes(result.action)) || now.getUTCMinutes()%15 === 0) {
      await s.setJSON('monitor/runs/'+now.toISOString()+'-'+Math.random().toString(36).slice(2,8),entry);
    }
    console.log(JSON.stringify({event:'monitoring_write_success',outcome,time:entry.time}));
    return true;
  } catch (error) {
    console.error(JSON.stringify({event:'netlify_blobs_error',operation:'monitoring_write',errorType:error instanceof Error ? error.name : 'UnknownError'}));
    return false;
  }
}

/**
 * Read-only verification of previously persisted monitoring data.
 * Uses the existing site-wide store and never calls external device providers.
 * Eventual consistency can briefly return an older entry.
 */
export async function verifyRecordedRunReadback(now = new Date()): Promise<{readable:boolean; latestAt:string|null; ageSeconds:number|null}> {
  try {
    const previous = await store().get('monitor/latest', {type:'json',consistency:'eventual'}) as RunRecord | null;
    if (!previous || !Number.isFinite(Date.parse(previous.time))) {
      console.log(JSON.stringify({event:'monitoring_readback_unverified',reason:'NO_VALID_ENTRY'}));
      return {readable:false,latestAt:null,ageSeconds:null};
    }
    const ageSeconds = Math.max(0,Math.round((now.getTime()-Date.parse(previous.time))/1000));
    console.log(JSON.stringify({event:'monitoring_readback_verified',latestAt:previous.time,ageSeconds}));
    return {readable:true,latestAt:previous.time,ageSeconds};
  } catch (error) {
    console.error(JSON.stringify({event:'monitoring_readback_failed',errorType:error instanceof Error?error.name:'UnknownError'}));
    return {readable:false,latestAt:null,ageSeconds:null};
  }
}
