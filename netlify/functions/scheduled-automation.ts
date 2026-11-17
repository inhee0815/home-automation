import { schedule } from '@netlify/functions';
import { connectLambda } from '@netlify/blobs';
import { AutomationEngine } from '../../src/automation/engine';
import { notifyAutomationResult, notifyIncident } from '../../src/automation/notification';
import { recordRun } from '../../src/automation/monitor';
import { runtimeEnabled } from '../../src/automation/runtimeSwitch';

export const rawHandler = async (event?: Parameters<Parameters<typeof schedule>[1]>[0]) => {
  // Lambda compatibility handlers need Blobs metadata initialized per invocation.
  if (event) connectLambda(event as unknown as Parameters<typeof connectLambda>[0]);

  if (!(await runtimeEnabled())) {
    await recordRun('PAUSED');
    return {statusCode:200,body:JSON.stringify({ok:true,skipped:true,reason:'Automation safety interlock is off'})};
  }
  try {
    const result = await new AutomationEngine().evaluateAndExecute();
    await recordRun(result.action.startsWith('SKIPPED_') ? 'ERROR' : 'OK', result);
    await notifyAutomationResult(result);
    console.log(JSON.stringify({event:'hood_automation',...result}));
    return {statusCode:200,body:JSON.stringify({ok:true,data:result})};
  } catch {
    await recordRun('ERROR');
    await notifyIncident('TUYA_UNAVAILABLE','Unexpected automation evaluation failure');
    return {statusCode:500,body:JSON.stringify({ok:false,error:'Automation failed'})};
  }
};
export const handler = schedule('* * * * *',rawHandler);
