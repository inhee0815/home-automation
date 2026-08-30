import { schedule } from '@netlify/functions';
import { AutomationEngine } from '../../src/automation/engine';

export const rawHandler = async () => {
  console.log('[Scheduled Hood Automation Triggered]');
  try {
    const engine = new AutomationEngine();
    const result = await engine.evaluateAndExecute();
    console.log('[Scheduled Hood Automation Completed]', JSON.stringify(result));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, data: result }),
    };
  } catch (err: any) {
    console.error('[Scheduled Hood Automation Error]', err.message);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};

export const handler = schedule('* * * * *', rawHandler);
