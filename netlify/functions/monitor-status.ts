import type { Handler } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import crypto from 'crypto';
import type { HoodState } from '../../src/automation/stateStore';
import type { RunRecord } from '../../src/automation/monitor';

const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function authorized(input?: string): boolean {
  const expected=process.env.AUTOMATION_ADMIN_TOKEN;
  if (!expected || !input) return false;
  const a=crypto.createHash('sha256').update(input).digest();
  const b=crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a,b);
}
export const handler: Handler = async event => {
  if (event.httpMethod !== 'GET') return {statusCode:405,headers,body:JSON.stringify({error:'Method not allowed'})};
  if (!process.env.AUTOMATION_ADMIN_TOKEN) return {statusCode:503,headers,body:JSON.stringify({error:'Dashboard authentication not configured'})};
  if (!authorized(event.headers['x-automation-token'])) return {statusCode:401,headers,body:JSON.stringify({error:'Unauthorized'})};
  try {
    const s=getStore({name:process.env.AUTOMATION_BLOB_STORE || 'home-automation-prod',consistency:'strong'});
    const today=new Date().toISOString().slice(0,10);
    const [run,hood,usage,incidents,items]=await Promise.all([
      s.get('monitor/latest',{type:'json',consistency:'strong'}) as Promise<RunRecord|null>,
      s.get('hood-state',{type:'json',consistency:'strong'}) as Promise<HoodState|null>,
      s.get('tuya-api/'+today,{type:'json',consistency:'strong'}) as Promise<{attempts:number}|null>,
      Promise.all(['LG_UNAVAILABLE','TUYA_UNAVAILABLE','HOOD_UNVERIFIED','QUOTA_WARNING','QUOTA_BLOCKED','AUTOMATION_STALE'].map(async code => {
        const value=await s.get('incidents/'+code,{type:'json',consistency:'strong'});
        return value?{code,...(value as object)}:null;
      })),
      s.list({prefix:'monitor/runs/'}),
    ]);
    const sorted=items.blobs.map(v=>v.key).sort().reverse().slice(0,20);
    const history=await Promise.all(sorted.map(k=>s.get(k,{type:'json',consistency:'strong'})));
    const active=process.env.AUTOMATION_ENABLED==='true';
    const stale=active && (!run || Date.now()-Date.parse(run.time)>5*60000);
    const response={
      serverTime:new Date().toISOString(),
      automationEnabled:active,
      commandsEnabled:process.env.TUYA_COMMANDS_ENABLED==='true',
      status:!active?'PAUSED':stale?'STALE':run?.outcome==='ERROR'?'ERROR':run?'RUNNING':'UNKNOWN',
      latestRun:run,
      hood:hood?{induction:hood.induction,desired:hood.desired,confirmed:hood.confirmed,
        offDetectedAt:hood.offDetectedAt,lastCommandAt:hood.lastCommandAt,
        lastVerifiedAt:hood.lastVerifiedAt,failureCount:hood.failureCount}:null,
      tuya:{today,attempts:usage?.attempts??0,limit:Number(process.env.TUYA_DAILY_API_LIMIT??20),
        quotaGuardEnabled:process.env.TUYA_QUOTA_GUARD_ENABLED==='true',approximate:true},
      incidents:incidents.filter(Boolean),
      history:history.filter(Boolean),
    };
    return {statusCode:200,headers,body:JSON.stringify(response)};
  } catch {
    return {statusCode:503,headers,body:JSON.stringify({error:'Monitoring data unavailable'})};
  }
};
