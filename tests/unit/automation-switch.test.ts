jest.mock('@netlify/blobs',()=>({getStore:jest.fn()}));
import {getStore} from '@netlify/blobs';
import {runtimeEnabled,setRuntimeSwitch,mayArmFromDashboard} from '../../src/automation/runtimeSwitch';
import {handler} from '../../netlify/functions/automation-switch';
const store={get:jest.fn(),setJSON:jest.fn()};
const request=(enabled:boolean,token='admin')=>handler!({httpMethod:'POST',headers:{'x-automation-token':token},body:JSON.stringify({enabled})} as any,{} as any) as any;
beforeEach(()=>{
 jest.clearAllMocks();(getStore as jest.Mock).mockReturnValue(store);
 store.get.mockResolvedValue(null);store.setJSON.mockResolvedValue(undefined);
 process.env.AUTOMATION_ADMIN_TOKEN='admin';
 delete process.env.AUTOMATION_ENABLED;delete process.env.TUYA_COMMANDS_ENABLED;delete process.env.TUYA_QUOTA_GUARD_ENABLED;
 delete process.env.ENABLE_DASHBOARD_ARMING;delete process.env.CONTEXT;
});
test('absent runtime state fails closed',async()=>{
 process.env.AUTOMATION_ENABLED='true';process.env.TUYA_COMMANDS_ENABLED='true';process.env.TUYA_QUOTA_GUARD_ENABLED='true';
 expect(await runtimeEnabled()).toBe(false);
});
test('runtime store read failure fails closed',async()=>{
 process.env.AUTOMATION_ENABLED='true';process.env.TUYA_COMMANDS_ENABLED='true';process.env.TUYA_QUOTA_GUARD_ENABLED='true';
 store.get.mockRejectedValue(new Error('store down'));
 jest.spyOn(console,'error').mockImplementation(()=>undefined);
 expect(await runtimeEnabled()).toBe(false);
 jest.restoreAllMocks();
});
test('OFF works with env flags disabled, sends no vendor requests',async()=>{
 const response=await request(false);
 expect(response.statusCode).toBe(200);
 expect(store.setJSON).toHaveBeenCalledWith('control/runtime-switch',expect.objectContaining({enabled:false}));
});
test('ON prohibited without all explicit production preconditions',async()=>{
 const response=await request(true);
 expect(response.statusCode).toBe(409);
 expect(store.setJSON).not.toHaveBeenCalled();
});
test('bad token cannot change runtime state',async()=>{
 const response=await request(false,'wrong');
 expect(response.statusCode).toBe(401);
 expect(store.setJSON).not.toHaveBeenCalled();
});
test('permitted ON must read back true',async()=>{
 Object.assign(process.env,{AUTOMATION_ENABLED:'true',TUYA_COMMANDS_ENABLED:'true',TUYA_QUOTA_GUARD_ENABLED:'true',ENABLE_DASHBOARD_ARMING:'true',CONTEXT:'production'});
 expect(mayArmFromDashboard()).toBe(true);
 store.get.mockResolvedValue({enabled:true});
 const response=await request(true);
 expect(response.statusCode).toBe(200);
});
