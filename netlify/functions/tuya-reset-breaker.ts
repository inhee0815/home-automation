import type {Handler} from '@netlify/functions';
import {connectLambda} from '@netlify/blobs';
import crypto from 'crypto';
import {TuyaClient} from '../../src/tuya/client';
import {BlobStateRepository} from '../../src/automation/stateStore';
import {runtimeEnabled} from '../../src/automation/runtimeSwitch';
import {classifyTuyaFailure} from '../../src/tuya/failure';
const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
function authorized(token?:string):boolean{
 const secret=process.env.AUTOMATION_ADMIN_TOKEN;
 if(!token||!secret)return false;
 return crypto.timingSafeEqual(crypto.createHash('sha256').update(token).digest(),crypto.createHash('sha256').update(secret).digest());
}
export const handler:Handler=async(event)=>{
 if(event.httpMethod!=='POST')return {statusCode:405,headers,body:JSON.stringify({error:'Method not allowed'})};
 if(!authorized(event.headers['x-automation-token']))return {statusCode:401,headers,body:JSON.stringify({error:'Unauthorized'})};
 if(!(await runtimeEnabled()))return {statusCode:409,headers,body:JSON.stringify({error:'Automation disabled'})};
 connectLambda(event as unknown as Parameters<typeof connectLambda>[0]);
 const store=new BlobStateRepository();
 try{
  const state=await store.load();
  if(!state||state.failureCount<3)return {statusCode:409,headers,body:JSON.stringify({error:'Circuit breaker is not open'})};
  const observed=await new TuyaClient().getStatus();
  if(!observed.online||typeof observed.switch_1!=='boolean')
   return {statusCode:409,headers,body:JSON.stringify({error:'Plug status unavailable'})};
  const confirmed=observed.switch_1?'ON':'OFF',now=Date.now();
  await store.save({...state,confirmed,failureCount:0,nextRetryAt:0,lastVerifiedAt:now,lastFailureReason:null,lastFailureAt:null,updatedAt:now});
  console.log(JSON.stringify({event:'tuya_breaker_reset',confirmed}));
  return {statusCode:200,headers,body:JSON.stringify({ok:true,confirmed})};
 }catch(error){
  const kind=classifyTuyaFailure(error);
  console.error(JSON.stringify({event:'tuya_breaker_reset_failed',category:kind}));
  return {statusCode:503,headers,body:JSON.stringify({error:'Reset unavailable: '+kind})};
 }
};
