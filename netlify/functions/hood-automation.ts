import { connectLambda } from '@netlify/blobs';
import type {Handler} from '@netlify/functions';
import { AutomationEngine } from '../../src/automation/engine';
import { runtimeEnabled } from '../../src/automation/runtimeSwitch';

export const handler: Handler = async (event) => {
  connectLambda(event as unknown as Parameters<typeof connectLambda>[0]);
  if (event.httpMethod !== 'POST') return {statusCode: 405, body: 'Method Not Allowed'};
  if (process.env.AUTOMATION_ENABLED !== 'true' || process.env.MANUAL_AUTOMATION_ENABLED !== 'true')
    return {statusCode: 403, body: 'Automation disabled'};
  const token = process.env.AUTOMATION_ADMIN_TOKEN;
  if (!token || event.headers['x-automation-token'] !== token)
    return {statusCode: 401, body: 'Unauthorized'};
  try {
    if (!(await runtimeEnabled())) return {statusCode:403,body:'Runtime interlock is off'};
    const result = await new AutomationEngine().evaluateAndExecute();
    return {statusCode: 200, body: JSON.stringify({ok: true, data: result})};
  } catch {
    return {statusCode: 500, body: JSON.stringify({ok: false, error: 'Automation failed'})};
  }
};
