import { schedule } from '@netlify/functions';
import { connectLambda } from '@netlify/blobs';
import { AutomationEngine } from '../../src/automation/engine';
import { notifyAutomationResult, notifyIncident } from '../../src/automation/notification';
import { recordRun, verifyRecordedRunReadback } from '../../src/automation/monitor';
import { runtimeEnabled } from '../../src/automation/runtimeSwitch';
import { LgThinQClient } from '../../src/lg/client';
import { getStore } from '@netlify/blobs';

export const rawHandler = async (event?: Parameters<Parameters<typeof schedule>[1]>[0]) => {
  // Lambda compatibility handlers need Blobs metadata initialized per invocation.
  if (event) connectLambda(event as unknown as Parameters<typeof connectLambda>[0]);

  if (!(await runtimeEnabled())) {
    // Separate observation-only phase: LG state is read but never commands Tuya.
    if (process.env.LG_OBSERVE_ONLY === 'true') {
      try {
        const lg = await new LgThinQClient().getCooktopStatus();
        const state = !lg.online ? 'UNKNOWN' : lg.powerState;
        await getStore({name:process.env.AUTOMATION_BLOB_STORE || 'home-automation-prod',consistency:'eventual'})
          .setJSON('monitor/lg-observed',{time:new Date().toISOString(),powerState:state,online:lg.online});
        console.log(JSON.stringify({event:'lg_observed_no_tuya',powerState:state}));
      } catch (error) {
        console.error(JSON.stringify({event:'lg_observation_failed',errorType:error instanceof Error?error.name:'UnknownError'}));
      }
    }
    // Read the previous heartbeat before writing a new one; no Tuya API calls.
    await verifyRecordedRunReadback();
    const monitorRecorded = await recordRun('PAUSED');
    return {statusCode:200,body:JSON.stringify({ok:true,skipped:true,monitorRecorded,reason:'Automation safety interlock is off'})};
  }
  try {
    const result = await new AutomationEngine().evaluateAndExecute();
    const monitorRecorded = await recordRun(result.action.startsWith('SKIPPED_') ? 'ERROR' : 'OK', result);
    await notifyAutomationResult(result);
    console.log(JSON.stringify({event:'hood_automation',...result}));
    return {statusCode:200,body:JSON.stringify({ok:true,data:result,monitorRecorded})};
  } catch {
    await recordRun('ERROR');
    await notifyIncident('TUYA_UNAVAILABLE','Unexpected automation evaluation failure');
    return {statusCode:500,body:JSON.stringify({ok:false,error:'Automation failed'})};
  }
};
export const handler = schedule('* * * * *',rawHandler);
