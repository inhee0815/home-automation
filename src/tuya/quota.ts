import { getStore } from '@netlify/blobs';
import { notifyIncident } from '../automation/notification';

/**
 * Quota observability + conservative fail-closed request gate.
 * Blobs is NOT a transactional counter or distributed lock. This cannot guarantee
 * an exact global hard quota with concurrent functions.
 */
interface DailyUsage { date: string; attempts: number; lastAt: string }
export async function reserveTuyaApiAttempt(now = new Date()): Promise<void> {
  const enabled = process.env.TUYA_QUOTA_GUARD_ENABLED === 'true';
  if (!enabled) throw new Error('Tuya API blocked: quota guard is not enabled');
  const max = Number(process.env.TUYA_DAILY_API_LIMIT ?? 20);
  if (!Number.isSafeInteger(max) || max < 1 || max > 1000)
    throw new Error('Invalid TUYA_DAILY_API_LIMIT');
  const date = now.toISOString().slice(0, 10);
  const key = 'tuya-api/' + date;
  const store = getStore({ name: process.env.AUTOMATION_BLOB_STORE || 'home-automation-prod', consistency: 'strong' });

  // Approximate monitoring only: @netlify/blobs v9 writes are last-write-wins.
  // Never treat this as a transactional hard cap.
  const current = await store.get(key, {type: 'json', consistency:'strong'}) as DailyUsage | null;
  const count = Number(current?.attempts ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid persisted Tuya usage');
  if (count >= max) {
    await notifyIncident('QUOTA_BLOCKED', `Tuya request budget exhausted: ${count}/${max}`);
    throw new Error('Tuya daily API request budget exhausted');
  }
  const value: DailyUsage = {date, attempts:count+1, lastAt:now.toISOString()};
  await store.setJSON(key,value);
  console.log(JSON.stringify({event:'tuya_api_attempt_reserved',date,attempts:value.attempts,limit:max}));
  if (value.attempts >= Math.ceil(max*0.8)) {
    await notifyIncident('QUOTA_WARNING', `Tuya request budget nearing limit: ${value.attempts}/${max}`);
  }
}
