import { AutomationEngine } from '../../src/automation/engine';
import { sendDirectPlugCommand } from '../../src/tuya/directCommand';
import { HoodState } from '../../src/automation/stateStore';
import { runtimeEnabled } from '../../src/automation/runtimeSwitch';
jest.mock('../../src/automation/runtimeSwitch', () => ({runtimeEnabled:jest.fn()}));

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
  const tuya = {getStatus: jest.fn(async () => ({online:true,switch_1: false}))};
  return {store, lg, tuya, engine: new AutomationEngine(lg as any, tuya as any, store)};
}
beforeEach(() => {
  jest.clearAllMocks();
  (runtimeEnabled as jest.Mock).mockResolvedValue(true);
  process.env.AUTOMATION_ENABLED = 'true';
  process.env.TUYA_COMMANDS_ENABLED = 'true';
  delete process.env.TUYA_PERIODIC_VERIFY;
});
test('disabled automation never makes external calls', async () => {
  process.env.AUTOMATION_ENABLED = 'false';
  (runtimeEnabled as jest.Mock).mockResolvedValue(false);
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
test('ON transition checks physical plug before command', async () => {
  const s = setup(on, baseline());
  expect((await s.engine.evaluateAndExecute(200000)).action).toBe('TURN_ON');
  expect(command).toHaveBeenCalledWith(true);
  expect(s.tuya.getStatus).toHaveBeenCalledTimes(1);
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

test('new ON target bypasses old OFF cooldown after plug verification',async()=>{
 const s=setup(on,baseline({induction:'OFF',desired:'OFF',confirmed:'UNKNOWN',lastCommandAt:100000,nextRetryAt:400000}));
 (s.tuya.getStatus as jest.Mock).mockResolvedValue({online:true,switch_1:false});
 expect((await s.engine.evaluateAndExecute(200000)).action).toBe('TURN_ON');
 expect(s.tuya.getStatus).toHaveBeenCalledTimes(1);
 expect(command).toHaveBeenCalledWith(true);
});
test('new ON target avoids duplicate command when plug is ON',async()=>{
 const s=setup(on,baseline({induction:'OFF',desired:'OFF',confirmed:'UNKNOWN',lastCommandAt:100000,nextRetryAt:400000}));
 (s.tuya.getStatus as jest.Mock).mockResolvedValue({online:true,switch_1:true});
 expect((await s.engine.evaluateAndExecute(200000)).action).toBe('ALREADY_ON');
 expect(command).not.toHaveBeenCalled();
});
test('same ON target cooldown remains in force',async()=>{
 const s=setup(on,baseline({induction:'ON',desired:'ON',confirmed:'UNKNOWN',lastCommandAt:100000,nextRetryAt:400000}));
 expect((await s.engine.evaluateAndExecute(200000)).message).toBe('Command cooldown/backoff active.');
 expect(s.tuya.getStatus).not.toHaveBeenCalled();
 expect(command).not.toHaveBeenCalled();
});
test('failed ON verification leaves plug untouched',async()=>{
 const s=setup(on,baseline({induction:'OFF',desired:'OFF',confirmed:'UNKNOWN',lastCommandAt:100000,nextRetryAt:400000}));
 (s.tuya.getStatus as jest.Mock).mockRejectedValue(new Error('Tuya API failure'));
 expect((await s.engine.evaluateAndExecute(200000)).message).toMatch(/verification failed/);
 expect(command).not.toHaveBeenCalled();
});
test('circuit breaker remains enforced across new target',async()=>{
 const s=setup(on,baseline({induction:'OFF',desired:'OFF',confirmed:'UNKNOWN',lastCommandAt:100000,nextRetryAt:400000,failureCount:3}));
 expect((await s.engine.evaluateAndExecute(200000)).message).toMatch(/Circuit breaker/);
 expect(command).not.toHaveBeenCalled();
});

test('circuit breaker message includes safe diagnostic category', async () => {
 const s=setup(on, baseline({induction:'ON',desired:'ON',confirmed:'UNKNOWN',failureCount:3,nextRetryAt:999999,lastFailureReason:'AUTH'}));
 const result=await s.engine.evaluateAndExecute(200000);
 expect(result.message).toContain('AUTH');
 expect(command).not.toHaveBeenCalled();
});
test('command failure stores sanitized diagnostic without exposing provider details', async () => {
 const s=setup(on,baseline());
 command.mockRejectedValueOnce(new Error('secret provider message'));
 const result=await s.engine.evaluateAndExecute(200000);
 expect(result.action).toBe('SKIPPED_TUYA_ERROR');
 expect(result.message).not.toContain('secret provider message');
 const persisted=s.store.save.mock.calls.at(-1)?.[0];
 expect(persisted?.failureCount).toBe(1);
 expect(persisted?.lastFailureReason).toBe('UNKNOWN');
});

test('new ON target repairs stale cached ON after verifying actual plug OFF',async()=>{
 const s=setup(on,baseline({induction:'OFF',desired:'OFF',confirmed:'ON'}));
 (s.tuya.getStatus as jest.Mock).mockResolvedValue({online:true,switch_1:false});
 expect((await s.engine.evaluateAndExecute(200000)).action).toBe('TURN_ON');
 expect(command).toHaveBeenCalledWith(true);
});
test('OFF target after 90s checks plug and sends OFF if physically ON',async()=>{
 const s=setup(off,baseline({induction:'OFF',desired:'ON',confirmed:'OFF',offDetectedAt:1000}));
 (s.tuya.getStatus as jest.Mock).mockResolvedValue({online:true,switch_1:true});
 expect((await s.engine.evaluateAndExecute(200000)).action).toBe('TURN_OFF');
 expect(command).toHaveBeenCalledWith(false);
});
test('OFF target skips command if actual plug already OFF',async()=>{
 const s=setup(off,baseline({induction:'OFF',desired:'ON',confirmed:'ON',offDetectedAt:1000}));
 (s.tuya.getStatus as jest.Mock).mockResolvedValue({online:true,switch_1:false});
 expect((await s.engine.evaluateAndExecute(200000)).action).toBe('ALREADY_OFF');
 expect(command).not.toHaveBeenCalled();
});
test('LG turning OFF during evaluation cancels stale ON command',async()=>{
 const s=setup(on,baseline());
 s.lg.getCooktopStatus.mockResolvedValueOnce(on).mockResolvedValueOnce(off);
 expect((await s.engine.evaluateAndExecute(200000)).message).toMatch(/Induction changed/);
 expect(command).not.toHaveBeenCalled();
});
test('LG turning ON during evaluation cancels stale OFF command',async()=>{
 const s=setup(off,baseline({induction:'OFF',desired:'ON',confirmed:'ON',offDetectedAt:1000}));
 (s.tuya.getStatus as jest.Mock).mockResolvedValue({online:true,switch_1:true});
 s.lg.getCooktopStatus.mockResolvedValueOnce(off).mockResolvedValueOnce(on);
 expect((await s.engine.evaluateAndExecute(200000)).message).toMatch(/Induction changed/);
 expect(command).not.toHaveBeenCalled();
});

test('cached OFF without verification reconciles physical ON and sends OFF',async()=>{
 const s=setup(off,baseline({induction:'OFF',desired:'OFF',confirmed:'OFF',offDetectedAt:1000,lastVerifiedAt:null}));
 (s.tuya.getStatus as jest.Mock).mockResolvedValue({online:true,switch_1:true});
 expect((await s.engine.evaluateAndExecute(200000)).action).toBe('TURN_OFF');
 expect(s.tuya.getStatus).toHaveBeenCalledTimes(1);
 expect(command).toHaveBeenCalledWith(false);
});
test('cached OFF with physical OFF verifies without redundant command',async()=>{
 const s=setup(off,baseline({induction:'OFF',desired:'OFF',confirmed:'OFF',offDetectedAt:1000,lastVerifiedAt:null}));
 (s.tuya.getStatus as jest.Mock).mockResolvedValue({online:true,switch_1:false});
 expect((await s.engine.evaluateAndExecute(200000)).action).toBe('ALREADY_OFF');
 expect(s.tuya.getStatus).toHaveBeenCalledTimes(1);
 expect(command).not.toHaveBeenCalled();
});
test('recent verified OFF avoids unnecessary Tuya requests until its verification window',async()=>{
 const s=setup(off,baseline({induction:'OFF',desired:'OFF',confirmed:'OFF',offDetectedAt:1000,lastVerifiedAt:180000}));
 expect((await s.engine.evaluateAndExecute(200000)).action).toBe('ALREADY_OFF');
 expect(s.tuya.getStatus).not.toHaveBeenCalled();
 expect(command).not.toHaveBeenCalled();
});
test('cached OFF rechecks after 3 minutes when shutdown recently detected',async()=>{
 const s=setup(off,baseline({induction:'OFF',desired:'OFF',confirmed:'OFF',offDetectedAt:100000,lastVerifiedAt:120000}));
 (s.tuya.getStatus as jest.Mock).mockResolvedValue({online:true,switch_1:true});
 expect((await s.engine.evaluateAndExecute(320001)).action).toBe('TURN_OFF');
 expect(command).toHaveBeenCalledWith(false);
});
