jest.mock('@netlify/blobs',()=>({getStore:jest.fn()}));
jest.mock('../../src/automation/notification',()=>({notifyIncident:jest.fn(async()=>true)}));
import {getStore} from '@netlify/blobs';
import {reserveTuyaApiAttempt} from '../../src/tuya/quota';
const store={get:jest.fn(),setJSON:jest.fn()};
beforeEach(()=>{jest.clearAllMocks();(getStore as jest.Mock).mockReturnValue(store);process.env.TUYA_QUOTA_GUARD_ENABLED='true';process.env.TUYA_DAILY_API_LIMIT='2'});
test('disabled guard blocks all requests',async()=>{
 process.env.TUYA_QUOTA_GUARD_ENABLED='false';
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('not enabled');
 expect(store.get).not.toHaveBeenCalled();
});
test('records one attempted API call',async()=>{
 store.get.mockResolvedValue(null);store.setJSON.mockResolvedValue(undefined);
 await reserveTuyaApiAttempt(new Date('2026-11-17T00:00:00Z'));
 expect(store.setJSON).toHaveBeenCalledWith('tuya-api/2026-11-17',expect.objectContaining({attempts:1}));
});
test('rejects exhausted budget',async()=>{
 store.get.mockResolvedValue({date:'2026-11-17',attempts:2});
 await expect(reserveTuyaApiAttempt(new Date('2026-11-17T00:00:00Z'))).rejects.toThrow('exhausted');
 expect(store.setJSON).not.toHaveBeenCalled();
});
test('fails closed on Blobs error',async()=>{
 store.get.mockRejectedValue(new Error('Blobs unavailable'));
 await expect(reserveTuyaApiAttempt()).rejects.toThrow('Blobs unavailable');
});
