/**
 * Hard local Tuya HTTP request reservation.
 * Each source of Tuya traffic must call this immediately BEFORE every HTTP request.
 * No database configured, timeout, RPC error, or exhausted budget => no Tuya request.
 *
 * The Postgres RPC atomically increments a row using INSERT ON CONFLICT DO UPDATE
 * WHERE consumed < cap. This is an application-side ceiling, NOT vendor account
 * remaining quota nor a cap on other apps using the same Tuya account.
 */
export async function reserveTuyaApiAttempt(): Promise<void> {
  if (process.env.TUYA_QUOTA_GUARD_ENABLED !== 'true')
    throw new Error('Tuya API blocked: quota guard is not enabled');
  if (process.env.TUYA_QUOTA_BACKEND !== 'postgres')
    throw new Error('Tuya API blocked: transactional quota backend required');

  const max = Number(process.env.TUYA_DAILY_API_LIMIT);
  if (!Number.isSafeInteger(max) || max < 1 || max > 20)
    throw new Error('Tuya API blocked: invalid explicit daily quota');

  const dbUrl = process.env.TUYA_QUOTA_DB_URL;
  const apiKey = process.env.TUYA_QUOTA_DB_SERVICE_ROLE_KEY;
  if (!dbUrl || !apiKey) throw new Error('Tuya API blocked: quota database unconfigured');
  let url: URL;
  try {
    const base = new URL(dbUrl);
    if (base.protocol !== 'https:' || base.username || base.password ||
        base.pathname !== '/' || base.search || base.hash)
      throw new Error('Invalid quota database URL');
    url = new URL('/rest/v1/rpc/reserve_tuya_api_call', base.origin);
  } catch {
    throw new Error('Tuya API blocked: invalid quota database URL');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({p_limit:max}),
      signal: controller.signal,
    });
  } catch {
    throw new Error('Tuya API blocked: quota reservation unavailable');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error('Tuya API blocked: quota reservation failed');
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error('Tuya API blocked: invalid quota reservation response'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      !('allowed' in data) || data.allowed !== true ||
      !('used' in data) || !Number.isSafeInteger(data.used) ||
      !('cap' in data) || data.cap !== max && Number(data.cap) > max ||
      Number(data.used) < 1 || Number(data.used) > max)
    throw new Error('Tuya API blocked: quota exhausted or unverified');
  console.log(JSON.stringify({event:'tuya_api_reservation_granted',used:data.used,configuredLimit:max}));
}
