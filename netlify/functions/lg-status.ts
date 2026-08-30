import type { Handler, HandlerResponse } from '@netlify/functions';
import { LgThinQClient } from '../../src/lg/client';

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

  const deviceIdQuery = event.queryStringParameters?.deviceId;

  try {
    const lgClient = new LgThinQClient();
    const status = await lgClient.getCooktopStatus(deviceIdQuery);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        data: status,
      }),
    };
  } catch (err: any) {
    console.error('[LG Status Error]', err.message);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: 'Failed to retrieve LG induction status',
        message: err.message,
      }),
    };
  }
};
