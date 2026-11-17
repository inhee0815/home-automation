jest.mock('@netlify/blobs',()=>({getStore:jest.fn(),connectLambda:jest.fn()}));
import {getStore} from '@netlify/blobs';
import {runtimeEnabled,setRuntimeSwitch,mayArmFromDashboard} from '../../src/automation/runtimeSwitch';
import {handler} from '../../netlify/functions/automation-switch';
const store={get:jest.fn(),setJSON:jest.fn()};
const request=(enabled:boolean,token='admin',host='sweethome-automation.netlify.app')=>handler!({httpMethod:'POST',headers:{'x-automation-token':token,host},body:JSON.stringify({enabled})} as any,{} as any) as any;
beforeEach(()=>{
 jest.clearAllMocks();(getStore as jest.Mock).mockReturnValue(store);
 store.get.mockResolvedValue(null);store.setJSON.mockResolvedValue(undefined);
 process.env.AUTOMATION_ADMIN_TOKEN='admin';
 delete process.env.AUTOMATION_ENABLED;delete process.env.TUYA_COMMANDS_ENABLED;delete process.env.TUYA_QUOTA_GUARD_ENABLED;
 delete process.env.ENABLE_DASHBOARD_ARMING;delete process.env.CONTEXT;delete process.env.SITE_ID;delete process.env.URL;
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
 Object.assign(process.env,{AUTOMATION_ENABLED:'true',TUYA_COMMANDS_ENABLED:'true',TUYA_QUOTA_GUARD_ENABLED:'true',ENABLE_DASHBOARD_ARMING:'true',SITE_ID:'178acf14-19c5-40c9-b50e-3a11162a0412',URL:'https://sweethome-automation.netlify.app'});
 expect(mayArmFromDashboard('sweethome-automation.netlify.app')).toBe(true);
 store.get.mockResolvedValue({enabled:true});
 const response=await request(true);
 expect(response.statusCode).toBe(200);
});

test('preview host cannot arm even with production site env',async()=>{
 Object.assign(process.env,{AUTOMATION_ENABLED:'true',TUYA_COMMANDS_ENABLED:'true',TUYA_QUOTA_GUARD_ENABLED:'true',ENABLE_DASHBOARD_ARMING:'true',SITE_ID:'178acf14-19c5-40c9-b50e-3a11162a0412',URL:'https://sweethome-automation.netlify.app'});
 const response=await request(true,'admin','deploy-preview-3--sweethome-automation.netlify.app');
 expect(response.statusCode).toBe(409);
 expect(JSON.parse(response.body).blockers).toContain('NOT_PRODUCTION_SITE');
 expect(store.setJSON).not.toHaveBeenCalled();
});
