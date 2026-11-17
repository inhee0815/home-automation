import { getStore } from '@netlify/blobs';

/**
 * Additional runtime kill-switch; absence or a read failure ALWAYS means OFF.
 * This is not a distributed lock and does not prevent an already-in-flight command.
 */
export interface RuntimeSwitch { enabled: boolean; updatedAt: string }
const store = () => getStore({
  name: process.env.AUTOMATION_BLOB_STORE || 'home-automation-prod',
  consistency: 'strong',
});
export function deploymentAllowsRun(): boolean {
  return process.env.AUTOMATION_ENABLED === 'true'
    && process.env.TUYA_COMMANDS_ENABLED === 'true'
    && process.env.TUYA_QUOTA_GUARD_ENABLED === 'true';
}
export function mayArmFromDashboard(): boolean {
  return deploymentAllowsRun()
    && process.env.ENABLE_DASHBOARD_ARMING === 'true'
    && process.env.CONTEXT === 'production';
}
export async function runtimeEnabled(): Promise<boolean> {
  // Never read LG / Tuya when a deployment-level guard is off.
  if (!deploymentAllowsRun()) return false;
  try {
    const state = await store().get('control/runtime-switch', {type:'json',consistency:'strong'}) as RuntimeSwitch | null;
    return state?.enabled === true;
  } catch {
    console.error(JSON.stringify({event:'runtime_switch_read_failed'}));
    return false;
  }
}
export async function setRuntimeSwitch(enabled: boolean): Promise<RuntimeSwitch> {
  if (enabled && !mayArmFromDashboard()) throw new Error('ARMING_NOT_PERMITTED');
  const state: RuntimeSwitch = {enabled,updatedAt:new Date().toISOString()};
  await store().setJSON('control/runtime-switch',state);
  return state;
}
