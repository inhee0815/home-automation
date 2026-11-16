import type {Handler} from '@netlify/functions';
import { AutomationEngine } from '../../src/automation/engine';

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return {statusCode: 405, body: 'Method Not Allowed'};
  if (process.env.AUTOMATION_ENABLED !== 'true' || process.env.MANUAL_AUTOMATION_ENABLED !== 'true')
    return {statusCode: 403, body: 'Automation disabled'};
  const token = process.env.AUTOMATION_ADMIN_TOKEN;
  if (!token || event.headers['x-automation-token'] !== token)
    return {statusCode: 401, body: 'Unauthorized'};
  try {
    const result = await new AutomationEngine().evaluateAndExecute();
    return {statusCode: 200, body: JSON.stringify({ok: true, data: result})};
  } catch {
    return {statusCode: 500, body: JSON.stringify({ok: false, error: 'Automation failed'})};
  }
};
