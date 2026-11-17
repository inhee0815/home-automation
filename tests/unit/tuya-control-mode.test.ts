jest.mock('@netlify/blobs',()=>({connectLambda:jest.fn()}));
jest.mock('../../src/automation/runtimeSwitch',()=>({manualLiveTestEnabled:jest.fn(),runtimeEnabled:jest.fn()}));
jest.mock('../../src/tuya/directCommand',()=>({sendDirectPlugCommand:jest.fn()}));
import {handler} from '../../netlify/functions/tuya-control';
import {runtimeEnabled,manualLiveTestEnabled} from '../../src/automation/runtimeSwitch';
import {sendDirectPlugCommand} from '../../src/tuya/directCommand';
const run=()=>handler!({httpMethod:'POST',headers:{'x-automation-token':'test-token'},body:'{"on":true}'} as any,{} as any) as any;
beforeEach(()=>{
 jest.clearAllMocks();process.env.AUTOMATION_ADMIN_TOKEN='test-token';
 process.env.TUYA_COMMANDS_ENABLED='true';process.env.MANUAL_AUTOMATION_ENABLED='true';
 (manualLiveTestEnabled as jest.Mock).mockReturnValue(true);
});
test('manual plug control rejected while scheduler active',async()=>{
 (runtimeEnabled as jest.Mock).mockResolvedValue(true);
 expect((await run()).statusCode).toBe(409);
 expect(sendDirectPlugCommand).not.toHaveBeenCalled();
});
test('manual control permitted when automatic control disabled',async()=>{
 (runtimeEnabled as jest.Mock).mockResolvedValue(false);
 expect((await run()).statusCode).toBe(200);
 expect(sendDirectPlugCommand).toHaveBeenCalledWith(true);
});
