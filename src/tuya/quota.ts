import { getStore } from '@netlify/blobs';

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

  // All external Tuya requests must pass this code. Fail closed on store failures/conflicts.
  for (let attempt = 0; attempt < 3; attempt++) {
    const entry = await store.getWithMetadata(key, {type: 'json', consistency: 'strong'});
    const count = entry ? Number((entry.data as DailyUsage).attempts) : 0;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid persisted Tuya usage');
    if (count >= max) throw new Error('Tuya daily API request budget exhausted');
    const value: DailyUsage = {date, attempts: count + 1, lastAt: now.toISOString()};
    const written = entry
      ? await store.setJSON(key, value, { onlyIfMatch: entry.etag })
      : await store.setJSON(key, value, { onlyIfNew: true });
    if (written.modified) {
      console.log(JSON.stringify({event: 'tuya_api_attempt_reserved', date, attempts: value.attempts, limit: max}));
      return;
    }
  }
  throw new Error('Tuya request budget update conflict; blocked');
}
