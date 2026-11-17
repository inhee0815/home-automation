jest.mock('@netlify/blobs', () => ({ getStore: jest.fn(), connectLambda: jest.fn() }));
import { getStore } from '@netlify/blobs';
import { handler } from '../../netlify/functions/monitor-status';
import { runtimeEnabled,mayArmFromDashboard,armingBlockers } from '../../src/automation/runtimeSwitch';
jest.mock('../../src/automation/runtimeSwitch',()=>({runtimeEnabled:jest.fn(),mayArmFromDashboard:jest.fn(),armingBlockers:jest.fn()}));
const store = { get: jest.fn(), list: jest.fn() };
async function request(token?: string) {
  return await handler!({
    httpMethod: 'GET',
    headers: token ? { 'x-automation-token': token } : {},
  } as any, {} as any) as any;
}
beforeEach(() => {
  jest.clearAllMocks();
  (runtimeEnabled as jest.Mock).mockResolvedValue(false);
  (mayArmFromDashboard as jest.Mock).mockReturnValue(false);
  (armingBlockers as jest.Mock).mockReturnValue(['NOT_PRODUCTION_SITE']);
  (getStore as jest.Mock).mockReturnValue(store);
  process.env.AUTOMATION_ADMIN_TOKEN = 'test-admin';
  delete process.env.AUTOMATION_ENABLED;
  store.get.mockResolvedValue(null);
  store.list.mockResolvedValue({ blobs: [] });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
test('missing admin token config rejects access', async () => {
  delete process.env.AUTOMATION_ADMIN_TOKEN;
  expect((await request('test-admin')).statusCode).toBe(503);
});
test('unauthenticated request stays forbidden', async () => {
  expect((await request()).statusCode).toBe(401);
  expect((await request('bad')).statusCode).toBe(401);
  expect(store.get).not.toHaveBeenCalled();
});
test('empty store returns paused dashboard', async () => {
  const response = await request('test-admin');
  expect(response.statusCode).toBe(200);
  const data = JSON.parse(response.body);
  expect(data.status).toBe('PAUSED');
  expect(data.partialData).toBe(false);
  expect(data.tuya.attempts).toBe(0);
});
test('one failing Blob read produces a partial response instead of 503', async () => {
  store.get.mockImplementation(async (key: string) => {
    if (key === 'hood-state') throw new Error('Blobs read failed');
    return null;
  });
  const response = await request('test-admin');
  expect(response.statusCode).toBe(200);
  const data = JSON.parse(response.body);
  expect(data.partialData).toBe(true);
  expect(data.warnings).toContain('HOOD_STATE_UNAVAILABLE');
  expect(data.hood).toBe(null);
  expect(data.status).toBe('PAUSED');
});
test('unavailable store does not masquerade as zero Tuya calls', async () => {
  (getStore as jest.Mock).mockImplementation(() => { throw new Error('Unavailable'); });
  const response = await request('test-admin');
  const data = JSON.parse(response.body);
  expect(response.statusCode).toBe(200);
  expect(data.partialData).toBe(true);
  expect(data.tuya.attempts).toBe(null);
  expect(data.warnings).toContain('BLOBS_STORE_UNAVAILABLE');
});
test('an active automation with a failed monitor read is degraded', async () => {
  process.env.AUTOMATION_ENABLED = 'true';
  (runtimeEnabled as jest.Mock).mockResolvedValue(true);
  store.list.mockRejectedValue(new Error('Cannot list'));
  const response = await request('test-admin');
  expect(JSON.parse(response.body).status).toBe('DEGRADED');
});
