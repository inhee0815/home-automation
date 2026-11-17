import { AutomationEngine } from '../../src/automation/engine';
import { sendDirectPlugCommand } from '../../src/tuya/directCommand';
import { HoodState } from '../../src/automation/stateStore';

jest.mock('../../src/tuya/directCommand', () => ({sendDirectPlugCommand: jest.fn(async () => undefined)}));
const command = sendDirectPlugCommand as jest.Mock;
const on = {online: true, isOperating: true, powerState: 'ON'};
const off = {online: true, isOperating: false, powerState: 'OFF'};
const baseline = (overrides: Partial<HoodState> = {}): HoodState => ({
  induction: 'OFF', desired: 'OFF', confirmed: 'OFF', offDetectedAt: 1000,
  lastCommandAt: null, lastVerifiedAt: null, failureCount: 0,
  nextRetryAt: 0, updatedAt: 1000, ...overrides,
});
function setup(status: any, initial: HoodState | null) {
  let data = initial;
  const store = {load: jest.fn(async () => data), save: jest.fn(async (v: HoodState) => {data = v;})};
  const lg = {getCooktopStatus: jest.fn(async () => status)};
  const tuya = {getStatus: jest.fn(async () => ({switch_1: false}))};
  return {store, lg, tuya, engine: new AutomationEngine(lg as any, tuya as any, store)};
}
beforeEach(() => {
  jest.clearAllMocks();
  process.env.AUTOMATION_ENABLED = 'true';
  process.env.TUYA_COMMANDS_ENABLED = 'true';
  delete process.env.TUYA_PERIODIC_VERIFY;
});
test('disabled automation never makes external calls', async () => {
  process.env.AUTOMATION_ENABLED = 'false';
  const s = setup(on, baseline());
  await s.engine.evaluateAndExecute(200000);
  expect(s.lg.getCooktopStatus).not.toHaveBeenCalled();
  expect(s.tuya.getStatus).not.toHaveBeenCalled();
  expect(command).not.toHaveBeenCalled();
});
test('unchanged OFF consumes zero Tuya requests', async () => {
  const s = setup(off, baseline());
  expect((await s.engine.evaluateAndExecute(200000)).action).toBe('ALREADY_OFF');
  expect(s.tuya.getStatus).not.toHaveBeenCalled();
  expect(command).not.toHaveBeenCalled();
});
test('ON transition sends one direct command without GET', async () => {
  const s = setup(on, baseline());
  expect((await s.engine.evaluateAndExecute(200000)).action).toBe('TURN_ON');
  expect(command).toHaveBeenCalledWith(true);
  expect(s.tuya.getStatus).not.toHaveBeenCalled();
});
test('OFF is delayed from first OFF detection', async () => {
  const s = setup(off, baseline({induction: 'ON', desired: 'ON', confirmed: 'ON', offDetectedAt: null}));
  const r = await s.engine.evaluateAndExecute(100000);
  expect(r.action).toBe('WAITING_SHUTDOWN_DELAY');
  expect(r.remainingDelaySeconds).toBe(90);
  expect(command).not.toHaveBeenCalled();
});
test('first execution initializes only', async () => {
  const s = setup(on, null);
  await s.engine.evaluateAndExecute(200000);
  expect(command).not.toHaveBeenCalled();
  expect(s.tuya.getStatus).not.toHaveBeenCalled();
});
test('offline LG cannot turn hood off', async () => {
  const s = setup({...off, online: false}, baseline());
  expect((await s.engine.evaluateAndExecute(200000)).action).toBe('SKIPPED_LG_ERROR');
  expect(command).not.toHaveBeenCalled();
});
test('successful prior command is checked after cooldown', async () => {
  const s = setup(on, baseline({induction: 'ON', desired: 'ON', confirmed: 'UNKNOWN', lastCommandAt: 100000, nextRetryAt: 160000}));
  (s.tuya.getStatus as jest.Mock).mockResolvedValue({switch_1: true});
  expect((await s.engine.evaluateAndExecute(200000)).action).toBe('ALREADY_ON');
  expect(s.tuya.getStatus).toHaveBeenCalledTimes(1);
  expect(command).not.toHaveBeenCalled();
});
