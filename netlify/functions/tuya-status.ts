import type { Handler, HandlerResponse } from '@netlify/functions';
import { TuyaClient } from '../../src/tuya/client';

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
    const tuyaClient = new TuyaClient();
    const status = await tuyaClient.getStatus();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        data: status,
      }),
    };
  } catch (err: any) {
    console.error('[Tuya Status Error]', err.message);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: 'Failed to retrieve Tuya device status',
        message: err.message,
      }),
    };
  }
};
