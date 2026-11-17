jest.mock('@netlify/blobs',()=>({getStore:jest.fn()}));
import {getStore} from '@netlify/blobs';
import {reserveTuyaApiAttempt} from '../../src/tuya/quota';
const store={get:jest.fn(),setJSON:jest.fn()};
beforeEach(()=>{
  jest.clearAllMocks();
  (getStore as jest.Mock).mockReturnValue(store);
  store.get.mockResolvedValue(null);
  store.setJSON.mockResolvedValue(undefined);
  process.env.TUYA_QUOTA_GUARD_ENABLED='true';
  process.env.TUYA_DAILY_API_LIMIT='8';
});
test('denies when guard disabled',async()=>{
 process.env.TUYA_QUOTA_GUARD_ENABLED='false';
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('disabled');
 expect(store.get).not.toHaveBeenCalled();
});
test('records a permitted test attempt',async()=>{
 await reserveTuyaApiAttempt(new Date('2026-11-17T00:00:00Z'));
 expect(store.setJSON).toHaveBeenCalledWith('tuya-api/2026-11-17',expect.objectContaining({attempts:1}));
});
test('blocks at daily allowance',async()=>{
 store.get.mockResolvedValue({attempts:8});
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('budget reached');
 expect(store.setJSON).not.toHaveBeenCalled();
});
test('fails closed on store outage',async()=>{
 store.get.mockRejectedValue(new Error('store unavailable'));
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('store unavailable');
});
test('denies invalid limit',async()=>{
 process.env.TUYA_DAILY_API_LIMIT='1001';
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('1..1000');
});
