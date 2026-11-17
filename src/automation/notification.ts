import { getStore } from '@netlify/blobs';
import type { AutomationResult } from './types';

// Errors are recorded for the authenticated Netlify dashboard, not forwarded
// to a third-party push service. The dashboard doesn't claim physical hood operation.
export type AlertCode = 'LG_UNAVAILABLE' | 'TUYA_UNAVAILABLE' | 'HOOD_UNVERIFIED' | 'QUOTA_WARNING' | 'QUOTA_BLOCKED' | 'AUTOMATION_STALE';

export function classifyAutomationFailure(result: AutomationResult): AlertCode | null {
  if (result.action === 'SKIPPED_LG_ERROR') return 'LG_UNAVAILABLE';
  if (result.action === 'SKIPPED_TUYA_ERROR') {
    if (/quota|budget/i.test(result.message)) return 'QUOTA_BLOCKED';
    if (/disabled|cooldown/i.test(result.message)) return null;
    return 'TUYA_UNAVAILABLE';
  }
  return null;
}

export async function notifyIncident(code: AlertCode, detail: string, now = Date.now()): Promise<boolean> {
  // Write failures must not obstruct the original automation decision.
  const safe = detail.slice(0,240);
  try {
    const store = getStore({name: process.env.AUTOMATION_BLOB_STORE || 'home-automation-prod',consistency:'strong'});
    const key = 'incidents/' + code;
    const previous = await store.get(key, {type:'json',consistency:'strong'}) as {lastLoggedAt:number;count:number}|null;
    const cooldown = Math.max(5,Number(process.env.ALERT_COOLDOWN_MINUTES ?? 60))*60000;
    const emit = !previous || now-previous.lastLoggedAt >= cooldown;
    await store.setJSON(key,{lastSeenAt:now,lastLoggedAt:emit?now:previous!.lastLoggedAt,count:(previous?.count ?? 0)+1,detail:safe});
    if (emit) console.warn(JSON.stringify({event:'home_automation_incident',code,detail:safe,timestamp:new Date(now).toISOString()}));
    return emit;
  } catch {
    console.error(JSON.stringify({event:'incident_persistence_failed',code}));
    return false;
  }
}
export async function notifyAutomationResult(result: AutomationResult): Promise<boolean> {
  const code = classifyAutomationFailure(result);
  if (!code) return false;
  return notifyIncident(code,`time=${result.evaluatedAt}, induction=${result.inductionState}, hood=${result.hoodState}`);
}
