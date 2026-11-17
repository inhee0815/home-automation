import {reserveTuyaApiAttempt} from '../../src/tuya/quota';
const originalFetch = global.fetch;
const stubFetch = jest.fn();
beforeEach(()=>{
  jest.resetAllMocks();
  global.fetch = stubFetch as unknown as typeof fetch;
  process.env.TUYA_QUOTA_GUARD_ENABLED='true';
  process.env.TUYA_QUOTA_BACKEND='postgres';
  process.env.TUYA_DAILY_API_LIMIT='2';
  process.env.TUYA_QUOTA_DB_URL='https://example.supabase.co';
  process.env.TUYA_QUOTA_DB_SERVICE_ROLE_KEY='test-secret';
});
afterAll(()=>{global.fetch=originalFetch});
test('guard disabled fails before outbound request', async()=>{
 process.env.TUYA_QUOTA_GUARD_ENABLED='false';
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('not enabled');
 expect(stubFetch).not.toHaveBeenCalled();
});
test('missing transactional storage fails closed',async()=>{
 delete process.env.TUYA_QUOTA_DB_SERVICE_ROLE_KEY;
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('unconfigured');
 expect(stubFetch).not.toHaveBeenCalled();
});
test('atomic RPC reservation must grant slot before Tuya API',async()=>{
 stubFetch.mockResolvedValue({ok:true,json:async()=>({allowed:true,used:1,cap:2})});
 await reserveTuyaApiAttempt();
 expect(stubFetch).toHaveBeenCalledTimes(1);
 const [url,init]=stubFetch.mock.calls[0];
 expect(url).toBe('https://example.supabase.co/rest/v1/rpc/reserve_tuya_api_call');
 expect(init.method).toBe('POST');
 expect(JSON.parse(init.body)).toEqual({p_limit:2});
 expect(init.headers.apikey).toBe('test-secret');
});
test('database budget exhaustion fails closed',async()=>{
 stubFetch.mockResolvedValue({ok:true,json:async()=>({allowed:false})});
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('exhausted');
});
test('network timeout/error fails closed',async()=>{
 stubFetch.mockRejectedValue(new Error('offline'));
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('unavailable');
});
test('invalid reservation response fails closed',async()=>{
 stubFetch.mockResolvedValue({ok:true,json:async()=>({allowed:true,used:3,cap:2})});
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('unverified');
});
test('HTTP RPC failure fails closed',async()=>{
 stubFetch.mockResolvedValue({ok:false,status:503});
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('failed');
});
test('invalid explicit limit fails closed',async()=>{
 process.env.TUYA_DAILY_API_LIMIT='21';
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('invalid explicit');
});
