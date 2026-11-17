import { schedule } from '@netlify/functions';
import { AutomationEngine } from '../../src/automation/engine';
import { notifyAutomationResult } from '../../src/automation/notification';

export const rawHandler = async () => {
  if (process.env.AUTOMATION_ENABLED !== 'true') {
    return {statusCode: 200, body: JSON.stringify({ok: true, skipped: true, reason: 'AUTOMATION_ENABLED is not true'})};
  }
  try {
    const result = await new AutomationEngine().evaluateAndExecute();
    console.log(JSON.stringify({event: 'hood_automation', ...result}));
    await notifyAutomationResult(result);
    return {statusCode: 200, body: JSON.stringify({ok: true, data: result})};
  } catch {
    console.error('Scheduled hood automation failed');
    const { notifyIncident } = await import('../../src/automation/notification');
    await notifyIncident('TUYA_UNAVAILABLE', '자동화 실행 중 예상하지 못한 오류가 발생했습니다.');
    return {statusCode: 500, body: JSON.stringify({ok: false, error: 'Automation failed'})};
  }
};
export const handler = schedule('* * * * *', rawHandler);
