import type { Handler } from '@netlify/functions';
import { getStore, connectLambda } from '@netlify/blobs';
import crypto from 'crypto';
import type { HoodState } from '../../src/automation/stateStore';
import type { RunRecord } from '../../src/automation/monitor';
import { runtimeEnabled, mayArmFromDashboard, armingBlockers, manualLiveTestEnabled } from '../../src/automation/runtimeSwitch';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const incidentCodes = [
  'LG_UNAVAILABLE', 'TUYA_UNAVAILABLE', 'HOOD_UNVERIFIED',
  'QUOTA_WARNING', 'QUOTA_BLOCKED', 'AUTOMATION_STALE',
] as const;

function authorized(input?: string): boolean {
  const expected = process.env.AUTOMATION_ADMIN_TOKEN;
  if (!expected || !input) return false;
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export const handler: Handler = async (event) => {
  connectLambda(event as unknown as Parameters<typeof connectLambda>[0]);
  if (event.httpMethod !== 'GET')
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  if (!process.env.AUTOMATION_ADMIN_TOKEN)
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Dashboard authentication not configured' }) };
  if (!authorized(event.headers['x-automation-token']))
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  // Never contact LG or Tuya to render the dashboard.
  // Each Blobs operation is independently fault tolerant.
  const warnings: string[] = [];
  let store: ReturnType<typeof getStore> | null = null;
  try {
    store = getStore({
      name: process.env.AUTOMATION_BLOB_STORE || 'home-automation-prod',
      consistency: 'eventual',
    });
  } catch {
    warnings.push('BLOBS_STORE_UNAVAILABLE');
    console.error(JSON.stringify({ event: 'monitoring_read_failed', section: 'store' }));
  }

  async function safely<T>(section: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    if (!store) return fallback;
    try {
      return await fn();
    } catch {
      warnings.push(section);
      console.error(JSON.stringify({ event: 'monitoring_read_failed', section }));
      return fallback;
    }
  }

  const [active, canArm] = await Promise.all([runtimeEnabled(),Promise.resolve(mayArmFromDashboard(event.headers.host))]);
  const today = new Date().toISOString().slice(0, 10);
  const s = store;
  const [run, hood, usage, incidents, historyKeys] = await Promise.all([
    safely<RunRecord | null>('LATEST_RUN_UNAVAILABLE',
      async () => await s!.get('monitor/latest', { type: 'json', consistency: 'eventual' }) as RunRecord | null, null),
    safely<HoodState | null>('HOOD_STATE_UNAVAILABLE',
      async () => await s!.get('hood-state', { type: 'json', consistency: 'eventual' }) as HoodState | null, null),
    safely<{ attempts: number } | null>('TUYA_USAGE_UNAVAILABLE',
      async () => await s!.get('tuya-api/' + today, { type: 'json', consistency: 'eventual' }) as { attempts: number } | null, null),
    Promise.all(incidentCodes.map(async code => {
      const value = await safely<Record<string, unknown> | null>(
        'INCIDENT_' + code + '_UNAVAILABLE',
        async () => await s!.get('incidents/' + code, { type: 'json', consistency: 'eventual' }) as Record<string, unknown> | null,
        null,
      );
      return value ? { code, ...value } : null;
    })),
    safely<string[]>('HISTORY_LIST_UNAVAILABLE',
      async () => (await s!.list({ prefix: 'monitor/runs/' })).blobs.map(v => v.key), []),
  ]);

  const history = await Promise.all(historyKeys.sort().reverse().slice(0, 20).map(key =>
    safely<RunRecord | null>('HISTORY_ENTRY_UNAVAILABLE',
      async () => await s!.get(key, { type: 'json', consistency: 'eventual' }) as RunRecord | null,
      null),
  ));
  const stale = active && (!run || !Number.isFinite(Date.parse(run.time)) || Date.now() - Date.parse(run.time) > 5 * 60_000);
  const status = !active ? 'PAUSED' : warnings.length ? 'DEGRADED' : stale ? 'STALE' : run?.outcome === 'ERROR' ? 'ERROR' : run ? 'RUNNING' : 'UNKNOWN';

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      serverTime: new Date().toISOString(),
      automationEnabled: active, canArmFromDashboard: canArm, armingBlockers: armingBlockers(event.headers.host),
      manualLiveTestEnabled: manualLiveTestEnabled(),
      controlMode: process.env.AUTOMATION_CONTROL_MODE === 'deploy' ? 'DEPLOY' : 'DISABLED',
      storageEvidence: {
        latestRunFound: run !== null,
        latestRunAt: run?.time ?? null,
        latestRunAgeSeconds: run?.time && Number.isFinite(Date.parse(run.time)) ? Math.max(0,Math.round((Date.now()-Date.parse(run.time))/1000)) : null,
        latestReadOk: !warnings.includes('LATEST_RUN_UNAVAILABLE') && !warnings.includes('BLOBS_STORE_UNAVAILABLE'),
        status: warnings.includes('LATEST_RUN_UNAVAILABLE') || warnings.includes('BLOBS_STORE_UNAVAILABLE')
          ? 'READ_ERROR'
          : !run ? 'NO_RECORD' : Number.isFinite(Date.parse(run.time)) && Date.now()-Date.parse(run.time)<=180000 ? 'HEALTHY' : 'STALE',
      },
      restartReadiness: {
        status: 'NOT_READY',
        reasons: [
          ...(process.env.AUTOMATION_RESTART_APPROVED === 'true' ? [] : ['RESTART_APPROVAL_MISSING']),
          ...(process.env.TUYA_TRIAL_QUOTA_VERIFIED === 'true' ? [] : ['TUYA_TRIAL_QUOTA_UNVERIFIED']),
          'TUYA_HARD_QUOTA_NOT_ENFORCED',
          'LG_DEVICE_MAPPING_NOT_FIELD_VERIFIED',
          'HOOD_PHYSICAL_BEHAVIOR_NOT_FIELD_VERIFIED',
          'IMMEDIATE_STOP_NOT_AVAILABLE',
        ],
        canResumeSafely: false,
      },
      commandsEnabled: process.env.TUYA_COMMANDS_ENABLED === 'true',
      status, partialData: warnings.length > 0, warnings,
      latestRun: run,
      hood: hood ? {
        induction: hood.induction, desired: hood.desired, confirmed: hood.confirmed,
        offDetectedAt: hood.offDetectedAt, lastCommandAt: hood.lastCommandAt,
        lastVerifiedAt: hood.lastVerifiedAt, failureCount: hood.failureCount,
        lastFailureReason: hood.lastFailureReason ?? null, lastFailureAt: hood.lastFailureAt ?? null,
      } : null,
      tuya: {
        today, attempts: warnings.includes('TUYA_USAGE_UNAVAILABLE') || warnings.includes('BLOBS_STORE_UNAVAILABLE')
          ? null : usage?.attempts ?? 0,
        limit: Number(process.env.TUYA_DAILY_API_LIMIT ?? 100),
        quotaGuardEnabled: process.env.TUYA_QUOTA_GUARD_ENABLED === 'true',
        enforcement: 'BEST_EFFORT_BLOBS_ONLY',
        approximate: true, // Legacy Blobs widget is NOT the transactional DB counter.
      },
      incidents: incidents.filter(Boolean),
      history: history.filter((x): x is RunRecord => x !== null),
    }),
  };
};
