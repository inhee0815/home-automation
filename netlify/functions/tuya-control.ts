import { connectLambda } from '@netlify/blobs';
import type {Handler} from '@netlify/functions';
import { sendDirectPlugCommand } from '../../src/tuya/directCommand';
import { manualLiveTestEnabled } from '../../src/automation/runtimeSwitch';

export const handler: Handler = async (event) => {
  connectLambda(event as unknown as Parameters<typeof connectLambda>[0]);
  if (event.httpMethod !== 'POST') return {statusCode: 405, body: 'Method Not Allowed'};
  if (process.env.TUYA_COMMANDS_ENABLED !== 'true' || process.env.MANUAL_AUTOMATION_ENABLED !== 'true')
    return {statusCode: 403, body: 'Manual control disabled'};
  const token = process.env.AUTOMATION_ADMIN_TOKEN;
  if (!token || event.headers['x-automation-token'] !== token)
    return {statusCode: 401, body: 'Unauthorized'};
  let body: unknown;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return {statusCode: 400, body: 'Invalid JSON'}; }
  if (!body || typeof body !== 'object' || typeof (body as {on?: unknown}).on !== 'boolean')
    return {statusCode: 400, body: 'Expected {"on":boolean}'};
  try {
    if (!manualLiveTestEnabled()) return {statusCode:403,body:'Manual live test is disabled'};
    await sendDirectPlugCommand((body as {on: boolean}).on);
    return {statusCode: 200, body: JSON.stringify({ok: true, status: 'command_accepted_not_verified'})};
  } catch {
    return {statusCode: 502, body: JSON.stringify({ok: false, error: 'Tuya command failed'})};
  }
};
