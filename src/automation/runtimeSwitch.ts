import { getStore } from '@netlify/blobs';

/**
 * Additional runtime kill-switch; absence or a read failure ALWAYS means OFF.
 * This is not a distributed lock and does not prevent an already-in-flight command.
 */
export interface RuntimeSwitch { enabled: boolean; updatedAt: string }
function logBlobFailure(operation: string, error: unknown): void {
  const name = error instanceof Error ? error.name : 'UnknownError';
  // Do not log provider messages or tokens; error class is sufficient to diagnose setup.
  console.error(JSON.stringify({event:'netlify_blobs_error',operation,errorType:name}));
}

const store = () => getStore({
  name: process.env.AUTOMATION_BLOB_STORE || 'home-automation-prod',
  consistency: 'strong',
});
export function deploymentAllowsRun(): boolean {
  return process.env.AUTOMATION_ENABLED === 'true'
    && process.env.TUYA_COMMANDS_ENABLED === 'true'
    && process.env.TUYA_QUOTA_GUARD_ENABLED === 'true';
}
const PRODUCTION_SITE_ID = '178acf14-19c5-40c9-b50e-3a11162a0412';
const PRODUCTION_HOST = 'sweethome-automation.netlify.app';
function isProductionRequest(host?: string): boolean {
  const environment = process.env.CONTEXT;
  // CONTEXT is Netlify build-only and is not guaranteed inside Functions.
  // SITE_ID and URL are documented runtime read-only values.
  if (environment && environment !== 'production') return false;
  return process.env.SITE_ID === PRODUCTION_SITE_ID
    && process.env.URL === 'https://' + PRODUCTION_HOST
    && host?.toLowerCase() === PRODUCTION_HOST;
}
export function armingBlockers(host?: string): string[] {
  const blockers: string[] = [];
  if (process.env.AUTOMATION_ENABLED !== 'true') blockers.push('AUTOMATION_DISABLED');
  if (process.env.TUYA_COMMANDS_ENABLED !== 'true') blockers.push('TUYA_COMMANDS_DISABLED');
  if (process.env.TUYA_QUOTA_GUARD_ENABLED !== 'true') blockers.push('QUOTA_GUARD_DISABLED');
  if (process.env.ENABLE_DASHBOARD_ARMING !== 'true') blockers.push('DASHBOARD_ARMING_DISABLED');
  if (!isProductionRequest(host)) blockers.push('NOT_PRODUCTION_SITE');
  return blockers;
}
export function mayArmFromDashboard(host?: string): boolean {
  return armingBlockers(host).length === 0;
}
export async function runtimeEnabled(): Promise<boolean> {
  // Never read LG / Tuya when a deployment-level guard is off.
  if (!deploymentAllowsRun()) return false;
  try {
    const state = await store().get('control/runtime-switch', {type:'json',consistency:'strong'}) as RuntimeSwitch | null;
    return state?.enabled === true;
  } catch (error) {
    logBlobFailure('runtime_switch_read',error);
    return false;
  }
}
export async function setRuntimeSwitch(enabled: boolean, host?: string): Promise<RuntimeSwitch> {
  if (enabled && !mayArmFromDashboard(host)) throw new Error('ARMING_NOT_PERMITTED');
  const state: RuntimeSwitch = {enabled,updatedAt:new Date().toISOString()};
  await store().setJSON('control/runtime-switch',state);
  return state;
}
