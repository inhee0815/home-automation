import type { Handler, HandlerResponse } from '@netlify/functions';
import { TuyaClient } from '../../src/tuya/client';
import { TuyaControlRequest } from '../../src/tuya/types';

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

export const handler: Handler = async (event): Promise<HandlerResponse> => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  let body: TuyaControlRequest;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON request body' }),
    };
  }

  if (typeof body.on !== 'boolean') {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Validation Error',
        message: 'The "on" property must be a boolean (true or false).',
      }),
    };
  }

  try {
    const tuyaClient = new TuyaClient();
    const result = await tuyaClient.setPlugState(body.on);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        data: result,
      }),
    };
  } catch (err: any) {
    console.error('[Tuya Control Error]', err.message);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: 'Failed to execute Tuya device control',
        message: err.message,
      }),
    };
  }
};
