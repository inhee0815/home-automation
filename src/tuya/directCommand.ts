import crypto from 'crypto';
import axios from 'axios';

// Issue a Tuya command without a preflight device-status GET.
let cachedToken: {value: string; expiresAt: number} | null = null;
const endpoint = () => (process.env.TUYA_API_ENDPOINT || 'https://openapi.tuyaus.com').replace(/\/$/, '');
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
function signHeaders(method: string, path: string, body: string, token = '') {
  const id = process.env.TUYA_ACCESS_ID || '';
  const secret = process.env.TUYA_ACCESS_SECRET || '';
  if (!id || !secret) throw new Error('Missing Tuya credentials');
  const t = Date.now().toString();
  const payload = [method.toUpperCase(), hash(body), '', path].join('\n');
  const sign = crypto.createHmac('sha256', secret).update(id + token + t + payload).digest('hex').toUpperCase();
  return {client_id: id, t, sign, sign_method: 'HMAC-SHA256', ...(token ? {access_token: token} : {})};
}
async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60000) return cachedToken.value;
  const path = '/v1.0/token?grant_type=1';
  const res = await axios.get(endpoint() + path, {headers: signHeaders('GET', path, ''), timeout: 10000});
  if (!res.data?.success) throw new Error('Tuya access-token request failed');
  cachedToken = {value: res.data.result.access_token, expiresAt: Date.now() + Number(res.data.result.expire_time || 7200) * 1000};
  return cachedToken.value;
}
export async function sendDirectPlugCommand(on: boolean): Promise<void> {
  const deviceId = process.env.TUYA_DEVICE_ID;
  if (!deviceId) throw new Error('Missing TUYA_DEVICE_ID');
  const path = `/v1.0/devices/${deviceId}/commands`;
  const body = JSON.stringify({commands: [{code: 'switch_1', value: on}]});
  const token = await accessToken();
  const res = await axios.post(endpoint() + path, body, {
    headers: {...signHeaders('POST', path, body, token), 'Content-Type': 'application/json'},
    timeout: 10000,
  });
  if (!res.data?.success) throw new Error('Tuya command rejected');
}
