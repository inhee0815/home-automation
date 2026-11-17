import { schedule } from '@netlify/functions';
import { AutomationEngine } from '../../src/automation/engine';
import { notifyAutomationResult, notifyIncident } from '../../src/automation/notification';
import { recordRun } from '../../src/automation/monitor';

export const rawHandler = async () => {
  if (process.env.AUTOMATION_ENABLED !== 'true') {
    await recordRun('PAUSED');
    return {statusCode:200,body:JSON.stringify({ok:true,skipped:true,reason:'AUTOMATION_ENABLED is not true'})};
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
