import { rawHandler } from '../../netlify/functions/scheduled-automation';
import { AutomationEngine } from '../../src/automation/engine';
jest.mock('../../src/automation/engine');
jest.mock('../../src/automation/runtimeSwitch',()=>({runtimeEnabled:jest.fn()}));
jest.mock('../../src/lg/client',()=>({LgThinQClient:jest.fn()}));
jest.mock('@netlify/blobs',()=>({getStore:jest.fn(),connectLambda:jest.fn()}));
import { runtimeEnabled } from '../../src/automation/runtimeSwitch';
import { LgThinQClient } from '../../src/lg/client';
import { getStore } from '@netlify/blobs';
const evalMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (AutomationEngine as jest.Mock).mockImplementation(() => ({evaluateAndExecute: evalMock}));
  (runtimeEnabled as jest.Mock).mockResolvedValue(false);
  delete process.env.LG_OBSERVE_ONLY;
});
test('scheduled function is paused by default', async () => {
  const response = await rawHandler();
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body).skipped).toBe(true);
  expect(evalMock).not.toHaveBeenCalled();
});
test('enabled scheduled function evaluates once', async () => {
  (runtimeEnabled as jest.Mock).mockResolvedValue(true);
  evalMock.mockResolvedValue({action: 'ALREADY_OFF'});
  const response = await rawHandler();
  expect(JSON.parse(response.body).data.action).toBe('ALREADY_OFF');
  expect(evalMock).toHaveBeenCalledTimes(1);
});
test('scheduled function returns sanitized error', async () => {
  (runtimeEnabled as jest.Mock).mockResolvedValue(true);
  process.env.AUTOMATION_ENABLED = 'true';
  evalMock.mockRejectedValue(new Error('secret-data'));
  expect((await rawHandler()).statusCode).toBe(500);
});

test('LG observe-only mode writes safe state but never invokes Tuya or automation engine',async()=>{
 const s={setJSON:jest.fn().mockResolvedValue(undefined)};
 (getStore as jest.Mock).mockReturnValue(s);
 (LgThinQClient as jest.Mock).mockImplementation(()=>({getCooktopStatus:jest.fn().mockResolvedValue({online:true,powerState:'ON',isOperating:true})}));
 process.env.LG_OBSERVE_ONLY='true';
 const response=await rawHandler();
 expect(JSON.parse(response.body).skipped).toBe(true);
 expect(s.setJSON).toHaveBeenCalledWith('monitor/lg-observed',expect.objectContaining({powerState:'ON'}));
 expect(evalMock).not.toHaveBeenCalled();
});
test('unknown LG response is observed without enabling actuator',async()=>{
 const s={setJSON:jest.fn().mockResolvedValue(undefined)};
 (getStore as jest.Mock).mockReturnValue(s);
 (LgThinQClient as jest.Mock).mockImplementation(()=>({getCooktopStatus:jest.fn().mockResolvedValue({online:true,powerState:'UNKNOWN'})}));
 process.env.LG_OBSERVE_ONLY='true';
 await rawHandler();
 expect(s.setJSON).toHaveBeenCalledWith('monitor/lg-observed',expect.objectContaining({powerState:'UNKNOWN'}));
 expect(evalMock).not.toHaveBeenCalled();
});
