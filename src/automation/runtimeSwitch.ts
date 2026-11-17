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
  consistency: 'eventual',
});
/**
 * Deploy-only gate: immutable for the duration of a published function deployment.
 * No eventually-consistent Blob is used to authorize LG/Tuya calls.
 * All new approval flags default to OFF.
 */
export function deploymentAllowsRun(): boolean {
  // Scheduled automatic control stays off during manual hardware tests.
  return false;
}
export function manualLiveTestEnabled(): boolean {
  return process.env.LIVE_TEST_ENABLED === 'true'
    && process.env.MANUAL_AUTOMATION_ENABLED === 'true'
    && process.env.TUYA_QUOTA_GUARD_ENABLED === 'true'
    && process.env.TUYA_COMMANDS_ENABLED === 'true';
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
  const blockers: string[] = ['SCHEDULED_AUTOMATION_DISABLED_DURING_LIVE_TEST'];
  if (process.env.AUTOMATION_CONTROL_MODE !== 'deploy') blockers.push('DEPLOY_CONTROL_MODE_REQUIRED');
  if (process.env.LIVE_TEST_ENABLED !== 'true') blockers.push('MANUAL_TEST_DISABLED');
  if (process.env.AUTOMATION_RESTART_APPROVED !== 'true') blockers.push('RESTART_REVIEW_REQUIRED');
  if (process.env.TUYA_TRIAL_QUOTA_VERIFIED !== 'true') blockers.push('TUYA_TRIAL_QUOTA_UNVERIFIED');
  const budget = Number(process.env.TUYA_DAILY_API_LIMIT ?? 20);
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 20) blockers.push('INVALID_DAILY_BUDGET');
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
  // Read no mutable state to authorize device control. Only immutable deploy config.
  return deploymentAllowsRun();
}
export async function setRuntimeSwitch(enabled: boolean, host?: string): Promise<RuntimeSwitch> {
  if (process.env.AUTOMATION_CONTROL_MODE === 'deploy') throw new Error('DEPLOY_CONTROL_ONLY');
  if (enabled && !mayArmFromDashboard(host)) throw new Error('ARMING_NOT_PERMITTED');
  const state: RuntimeSwitch = {enabled,updatedAt:new Date().toISOString()};
  await store().setJSON('control/runtime-switch',state);
  return state;
}
