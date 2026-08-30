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

  try {
    const lgClient = new LgThinQClient();
    const devices = await lgClient.getDevices();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        data: devices,
      }),
    };
  } catch (err: any) {
    console.error('[LG Devices Error]', err.message);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: 'Failed to retrieve LG ThinQ devices',
        message: err.message,
      }),
    };
  }
};
