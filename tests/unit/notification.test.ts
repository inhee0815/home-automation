jest.mock('@netlify/blobs', () => ({getStore: jest.fn()}));
import {getStore} from '@netlify/blobs';
import {notifyIncident, classifyAutomationFailure} from '../../src/automation/notification';
import type {AutomationResult} from '../../src/automation/types';
const store = {get: jest.fn(), setJSON: jest.fn()};
const send = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (getStore as jest.Mock).mockReturnValue(store);
  process.env.ALERTS_ENABLED = 'true';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = '12345';
  (global as any).fetch = send;
  store.get.mockResolvedValue(null);
  store.setJSON.mockResolvedValue({});
  send.mockResolvedValue({ok: true});
});
afterAll(() => {delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID;});
test('posts Telegram incident and remembers cooldown', async () => {
  expect(await notifyIncident('LG_UNAVAILABLE', 'test', 1000000)).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
  expect(store.setJSON).toHaveBeenCalled();
});
test('suppresses repeat alerts', async () => {
  store.get.mockResolvedValue({lastSentAt:1000000});
  expect(await notifyIncident('LG_UNAVAILABLE', 'test', 1010000)).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
test('alerts do not leak environment token in message', async () => {
  await notifyIncident('TUYA_UNAVAILABLE','failure');
  const data = JSON.parse(send.mock.calls[0][1].body);
  expect(data.text).not.toContain('test-token');
});
test('classifies failures', () => {
  const result: AutomationResult = {action:'SKIPPED_LG_ERROR',inductionState:'UNKNOWN',hoodState:'UNKNOWN',changed:false,remainingDelaySeconds:0,message:'LG API unavailable',evaluatedAt:'2026-11-17T00:00:00Z'};
  expect(classifyAutomationFailure(result)).toBe('LG_UNAVAILABLE');
  expect(classifyAutomationFailure({...result,action:'TURN_ON'})).toBe(null);
});
