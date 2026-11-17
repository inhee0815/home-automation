import type { Handler } from '@netlify/functions';
import crypto from 'crypto';
import { mayArmFromDashboard, runtimeEnabled, setRuntimeSwitch } from '../../src/automation/runtimeSwitch';

const headers = {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function authorized(token?: string) {
  const expected = process.env.AUTOMATION_ADMIN_TOKEN;
  if (!token || !expected) return false;
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(token).digest(),
    crypto.createHash('sha256').update(expected).digest(),
  );
}
export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return {statusCode:405,headers,body:JSON.stringify({error:'Method Not Allowed'})};
  if (!authorized(event.headers['x-automation-token'])) return {statusCode:401,headers,body:JSON.stringify({error:'Unauthorized'})};
  let data: unknown;
  try {data=JSON.parse(event.body||'');} catch {
    return {statusCode:400,headers,body:JSON.stringify({error:'Invalid JSON'})};
  }
  if (!data || typeof data!=='object' || typeof (data as {enabled?: unknown}).enabled!=='boolean')
    return {statusCode:400,headers,body:JSON.stringify({error:'Expected {"enabled":boolean}'})};
  const enabled=(data as {enabled:boolean}).enabled;
  if (enabled && !mayArmFromDashboard())
    return {statusCode:409,headers,body:JSON.stringify({error:'Cannot enable: production safety prerequisites are not configured'})};
  try {
    await setRuntimeSwitch(enabled);
    const observed=await runtimeEnabled();
    // OFF can take effect even with disabled env; readback doesn't distinguish persisted OFF.
    if (enabled && !observed) return {statusCode:503,headers,body:JSON.stringify({error:'Failed to verify armed state'})};
    console.log(JSON.stringify({event:'automation_switch_changed',requested:enabled,observed}));
    return {statusCode:200,headers,body:JSON.stringify({ok:true,enabled:observed})};
  } catch {
    return {statusCode:503,headers,body:JSON.stringify({error:'Unable to save switch; automation remains fail-closed on read failure'})};
  }
};
