import {getStore} from '@netlify/blobs';

/**
 * Best-effort daily request accounting for live automation.
 * Netlify Blobs is eventually consistent: this is NOT a strict global cap.
 * A successful reservation is counted even if the vendor call fails.
 */
export async function reserveTuyaApiAttempt(now = new Date()): Promise<void> {
  if (process.env.TUYA_QUOTA_GUARD_ENABLED !== 'true')
    throw new Error('Tuya request blocked: quota guard disabled');
  const limit = Number(process.env.TUYA_DAILY_API_LIMIT ?? '100');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Tuya request blocked: daily budget must be 1..1000');
  const store = getStore({name:process.env.AUTOMATION_BLOB_STORE || 'home-automation-prod',consistency:'eventual'});
  const day=now.toISOString().slice(0,10), key='tuya-api/'+day;
  const record=await store.get(key,{type:'json',consistency:'eventual'}) as {attempts:number}|null;
  const used=record?.attempts ?? 0;
  if(!Number.isSafeInteger(used)||used<0) throw new Error('Invalid Tuya counter');
  if(used>=limit) throw new Error('Tuya request blocked: daily budget reached');
  await store.setJSON(key,{date:day,attempts:used+1,lastAt:now.toISOString()});
  console.log(JSON.stringify({event:'tuya_test_request_reserved',day,attempts:used+1,limit,approximate:true}));
}
