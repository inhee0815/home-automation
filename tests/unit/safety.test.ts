import { AutomationEngine } from '../../src/automation/engine';
import { HoodState } from '../../src/automation/stateStore';
import { sendDirectPlugCommand } from '../../src/tuya/directCommand';
jest.mock('../../src/tuya/directCommand', () => ({sendDirectPlugCommand: jest.fn()}));
const command = sendDirectPlugCommand as jest.Mock;
const state: HoodState = {induction:'ON',desired:'ON',confirmed:'ON',offDetectedAt:null,lastCommandAt:null,lastVerifiedAt:1000,failureCount:0,nextRetryAt:0,updatedAt:1000};
beforeEach(() => {
  jest.clearAllMocks();
  process.env.AUTOMATION_ENABLED='true';
  process.env.TUYA_COMMANDS_ENABLED='true';
});
test('LG failure never exposes secrets or controls plug', async () => {
  const lg = {getCooktopStatus: jest.fn().mockRejectedValue(new Error('secret-data'))};
  const tuya = {getStatus: jest.fn()};
  const store = {load: jest.fn().mockResolvedValue(state), save: jest.fn()};
  const result = await new AutomationEngine(lg as any, tuya as any, store as any).evaluateAndExecute(200000);
  expect(result.message).not.toContain('secret-data');
  expect(result.action).toBe('SKIPPED_LG_ERROR');
  expect(command).not.toHaveBeenCalled();
});
test('brief OFF then ON never sends OFF command', async () => {
  let saved = {...state};
  const store = {load: jest.fn(async () => saved), save: jest.fn(async (v: HoodState) => {saved = v;})};
  const lg = {getCooktopStatus: jest.fn()};
  const tuya = {getStatus: jest.fn()};
  const engine = new AutomationEngine(lg as any, tuya as any, store);
  lg.getCooktopStatus.mockResolvedValueOnce({online:true,isOperating:false,powerState:'OFF'});
  expect((await engine.evaluateAndExecute(200000)).action).toBe('WAITING_SHUTDOWN_DELAY');
  lg.getCooktopStatus.mockResolvedValueOnce({online:true,isOperating:true,powerState:'ON'});
  expect((await engine.evaluateAndExecute(210000)).action).toBe('ALREADY_ON');
  expect(command).not.toHaveBeenCalled();
});
