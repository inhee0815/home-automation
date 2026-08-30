import type { Handler, HandlerResponse } from '@netlify/functions';
import { AutomationEngine } from '../../src/automation/engine';

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

export const handler: Handler = async (event): Promise<HandlerResponse> => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const engine = new AutomationEngine();
    const result = await engine.evaluateAndExecute();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        data: result,
      }),
    };
  } catch (err: any) {
    console.error('[Hood Automation Error]', err.message);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: 'Failed to execute hood automation engine',
        message: err.message,
      }),
    };
  }
};
