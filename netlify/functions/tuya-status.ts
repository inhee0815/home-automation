import { connectLambda } from '@netlify/blobs';
import type { Handler, HandlerResponse } from '@netlify/functions';
import { TuyaClient } from '../../src/tuya/client';
import crypto from 'crypto';
import { runtimeEnabled } from '../../src/automation/runtimeSwitch';

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

  const provided = event.headers['x-automation-token'];
  const expected = process.env.AUTOMATION_ADMIN_TOKEN;
  if (!expected || !provided || !crypto.timingSafeEqual(
    crypto.createHash('sha256').update(provided).digest(),
    crypto.createHash('sha256').update(expected).digest()
  )) return {statusCode:401,headers,body:JSON.stringify({error:'Unauthorized'})};

  if (!(await runtimeEnabled())) return {statusCode:403,headers,body:JSON.stringify({error:'Automation is paused; no Tuya API quota will be spent'})};
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
    console.error(JSON.stringify({event:'tuya_status_failed',errorType:err instanceof Error?err.name:'UnknownError'}));

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: 'Failed to retrieve Tuya device status',
      }),
    };
  }
};
