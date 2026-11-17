jest.mock('@netlify/blobs',()=>({getStore:jest.fn(),connectLambda:jest.fn()}));
import {getStore} from '@netlify/blobs';
import {runtimeEnabled,setRuntimeSwitch,mayArmFromDashboard,armingBlockers,manualLiveTestEnabled} from '../../src/automation/runtimeSwitch';
import {handler} from '../../netlify/functions/automation-switch';
const store={get:jest.fn(),setJSON:jest.fn()};
const request=(enabled:boolean,token='admin',host='sweethome-automation.netlify.app')=>handler!({httpMethod:'POST',headers:{'x-automation-token':token,host},body:JSON.stringify({enabled})} as any,{} as any) as any;
beforeEach(()=>{
 jest.clearAllMocks();(getStore as jest.Mock).mockReturnValue(store);
 store.get.mockResolvedValue(null);store.setJSON.mockResolvedValue(undefined);
 process.env.AUTOMATION_ADMIN_TOKEN='admin';
 delete process.env.AUTOMATION_ENABLED;delete process.env.TUYA_COMMANDS_ENABLED;delete process.env.TUYA_QUOTA_GUARD_ENABLED;
 delete process.env.ENABLE_DASHBOARD_ARMING;delete process.env.CONTEXT;delete process.env.SITE_ID;delete process.env.URL;
 delete process.env.AUTOMATION_CONTROL_MODE;delete process.env.AUTOMATION_RESTART_APPROVED;delete process.env.TUYA_TRIAL_QUOTA_VERIFIED;delete process.env.LIVE_TEST_ENABLED;delete process.env.MANUAL_AUTOMATION_ENABLED;
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
test('dashboard ON is blocked in deploy-only control mode',async()=>{
 Object.assign(process.env,{AUTOMATION_ENABLED:'true',TUYA_COMMANDS_ENABLED:'true',TUYA_QUOTA_GUARD_ENABLED:'true',ENABLE_DASHBOARD_ARMING:'true',SITE_ID:'178acf14-19c5-40c9-b50e-3a11162a0412',URL:'https://sweethome-automation.netlify.app'});
 expect(mayArmFromDashboard('sweethome-automation.netlify.app')).toBe(false);
 expect(armingBlockers('sweethome-automation.netlify.app')).toContain('DASHBOARD_ON_UNSUPPORTED_USE_DEPLOY_CONTROL');
 const response=await request(true);
 expect(response.statusCode).toBe(409);
 expect(store.setJSON).not.toHaveBeenCalled();
});

test('preview host cannot arm even with production site env',async()=>{
 Object.assign(process.env,{AUTOMATION_ENABLED:'true',TUYA_COMMANDS_ENABLED:'true',TUYA_QUOTA_GUARD_ENABLED:'true',ENABLE_DASHBOARD_ARMING:'true',SITE_ID:'178acf14-19c5-40c9-b50e-3a11162a0412',URL:'https://sweethome-automation.netlify.app'});
 const response=await request(true,'admin','deploy-preview-3--sweethome-automation.netlify.app');
 expect(response.statusCode).toBe(409);
 expect(JSON.parse(response.body).blockers).toContain('NOT_PRODUCTION_SITE');
 expect(store.setJSON).not.toHaveBeenCalled();
});


test('manual test can be enabled without enabling scheduled automation',async()=>{
 Object.assign(process.env,{LIVE_TEST_ENABLED:'true',MANUAL_AUTOMATION_ENABLED:'true',TUYA_COMMANDS_ENABLED:'true',TUYA_QUOTA_GUARD_ENABLED:'true'});
 expect(manualLiveTestEnabled()).toBe(true);
 expect(await runtimeEnabled()).toBe(false);
});

test('explicit existing flags enable production scheduled automation',async()=>{
 Object.assign(process.env,{AUTOMATION_ENABLED:'true',TUYA_COMMANDS_ENABLED:'true',TUYA_QUOTA_GUARD_ENABLED:'true',TUYA_DAILY_API_LIMIT:'8',
 SITE_ID:'178acf14-19c5-40c9-b50e-3a11162a0412',URL:'https://sweethome-automation.netlify.app'});
 expect(await runtimeEnabled()).toBe(true);
 expect(store.get).not.toHaveBeenCalled();
});
test('preview and overbudget fail closed',async()=>{
 Object.assign(process.env,{AUTOMATION_ENABLED:'true',TUYA_COMMANDS_ENABLED:'true',TUYA_QUOTA_GUARD_ENABLED:'true',TUYA_DAILY_API_LIMIT:'8',
 SITE_ID:'178acf14-19c5-40c9-b50e-3a11162a0412',URL:'https://preview.example.com'});
 expect(await runtimeEnabled()).toBe(false);
 process.env.URL='https://sweethome-automation.netlify.app';
 process.env.TUYA_DAILY_API_LIMIT='1001';
 expect(await runtimeEnabled()).toBe(false);
});

test('production accepts a budget above the former 8-call cap',async()=>{
 Object.assign(process.env,{AUTOMATION_ENABLED:'true',TUYA_COMMANDS_ENABLED:'true',TUYA_QUOTA_GUARD_ENABLED:'true',TUYA_DAILY_API_LIMIT:'100',
 SITE_ID:'178acf14-19c5-40c9-b50e-3a11162a0412',URL:'https://sweethome-automation.netlify.app'});
 expect(await runtimeEnabled()).toBe(true);
});
