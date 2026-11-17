jest.mock('@netlify/blobs', () => ({ getStore: jest.fn() }));
import {getStore} from '@netlify/blobs';
import {reserveTuyaApiAttempt} from '../../src/tuya/quota';

const store = {
  getWithMetadata: jest.fn(),
  setJSON: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
  (getStore as jest.Mock).mockReturnValue(store);
  process.env.TUYA_QUOTA_GUARD_ENABLED = 'true';
  process.env.TUYA_DAILY_API_LIMIT = '2';
});
test('blocks all requests when guard disabled', async () => {
  process.env.TUYA_QUOTA_GUARD_ENABLED = 'false';
  await expect(reserveTuyaApiAttempt()).rejects.toThrow('not enabled');
  expect(store.getWithMetadata).not.toHaveBeenCalled();
});
test('reserves a daily attempt and records usage', async () => {
  store.getWithMetadata.mockResolvedValue(null);
  store.setJSON.mockResolvedValue({modified:true});
  await reserveTuyaApiAttempt(new Date('2026-11-17T00:00:00Z'));
  expect(store.setJSON).toHaveBeenCalledWith('tuya-api/2026-11-17', expect.objectContaining({attempts:1}), {onlyIfNew:true});
});
test('rejects limit exhausted', async () => {
  store.getWithMetadata.mockResolvedValue({data:{date:'2026-11-17',attempts:2},etag:'"abc"'});
  await expect(reserveTuyaApiAttempt(new Date('2026-11-17T00:00:00Z'))).rejects.toThrow('exhausted');
  expect(store.setJSON).not.toHaveBeenCalled();
});
test('fails closed when storage fails', async () => {
  store.getWithMetadata.mockRejectedValue(new Error('Blobs unavailable'));
  await expect(reserveTuyaApiAttempt()).rejects.toThrow('Blobs unavailable');
});
