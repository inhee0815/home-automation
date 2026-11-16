import { schedule } from '@netlify/functions';
import { AutomationEngine } from '../../src/automation/engine';

export const rawHandler = async () => {
  if (process.env.AUTOMATION_ENABLED !== 'true') {
    return {statusCode: 200, body: JSON.stringify({ok: true, skipped: true, reason: 'AUTOMATION_ENABLED is not true'})};
  }
  try {
    const result = await new AutomationEngine().evaluateAndExecute();
    console.log(JSON.stringify({event: 'hood_automation', ...result}));
    return {statusCode: 200, body: JSON.stringify({ok: true, data: result})};
  } catch {
    console.error('Scheduled hood automation failed');
    return {statusCode: 500, body: JSON.stringify({ok: false, error: 'Automation failed'})};
  }
};
export const handler = schedule('* * * * *', rawHandler);
