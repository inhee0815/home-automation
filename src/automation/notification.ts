import { getStore } from '@netlify/blobs';
import type { AutomationResult } from './types';

export type AlertCode = 'LG_UNAVAILABLE' | 'TUYA_UNAVAILABLE' | 'HOOD_UNVERIFIED' | 'QUOTA_WARNING' | 'QUOTA_BLOCKED' | 'AUTOMATION_STALE';
const storeName = () => process.env.AUTOMATION_BLOB_STORE || 'home-automation-prod';
const intervalMs = () => Math.max(5, Number(process.env.ALERT_COOLDOWN_MINUTES ?? 60)) * 60_000;

export function classifyAutomationFailure(result: AutomationResult): AlertCode | null {
  if (result.action === 'SKIPPED_LG_ERROR') return 'LG_UNAVAILABLE';
  if (result.action === 'SKIPPED_TUYA_ERROR') {
    if (result.message.toLowerCase().includes('quota') || result.message.toLowerCase().includes('budget')) return 'QUOTA_BLOCKED';
    if (result.message.includes('disabled')) return null;
    return 'TUYA_UNAVAILABLE';
  }
  // TURN_ON/OFF means accepted by cloud, not physically verified: verify asynchronously.
  return null;
}

function alertMessage(code: AlertCode, detail: string): string {
  const title: Record<AlertCode,string> = {
    LG_UNAVAILABLE: 'LG ThinQ 상태 조회 실패',
    TUYA_UNAVAILABLE: 'Tuya 후드 제어/상태 확인 실패',
    HOOD_UNVERIFIED: '후드 작동 상태 불일치 또는 확인 지연',
    QUOTA_WARNING: 'Tuya Cloud API 사용량 경고',
    QUOTA_BLOCKED: 'Tuya API 호출 한도 차단',
    AUTOMATION_STALE: '홈 오토메이션 실행 기록 누락',
  };
  return `🚨 홈 오토메이션\n${title[code]}\n${detail}\n실제 후드 상태를 직접 확인해주세요.`;
}

/**
 * Telegram notifications are optional, and never use the Tuya Cloud API.
 * Stateful suppression is best-effort; Blobs is not a transactional store.
 * Errors do not override or conceal the original automation result.
 */
export async function notifyIncident(code: AlertCode, detail: string, now = Date.now()): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat || process.env.ALERTS_ENABLED !== 'true') {
    console.warn(JSON.stringify({event: 'alert_not_configured', code}));
    return false;
  }
  try {
    const store = getStore({name: storeName(), consistency: 'strong'});
    const key = `alerts/${code}`;
    const previous = await store.get(key, {type: 'json', consistency: 'strong'}) as {lastSentAt: number} | null;
    if (previous && now - previous.lastSentAt < intervalMs()) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({chat_id: chat, text: alertMessage(code, detail)}),
        signal: controller.signal,
      });
    } finally { clearTimeout(timeout); }
    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
    await store.setJSON(key, {lastSentAt: now});
    console.log(JSON.stringify({event: 'incident_alert_sent', code}));
    return true;
  } catch (error) {
    console.error(JSON.stringify({event:'incident_alert_failed', code, reason: error instanceof Error ? error.name : 'unknown'}));
    return false;
  }
}
export async function notifyAutomationResult(result: AutomationResult): Promise<boolean> {
  const code = classifyAutomationFailure(result);
  if (!code) return false;
  // No dynamic secret-bearing error text is forwarded.
  return notifyIncident(code, `감지 시각: ${result.evaluatedAt}\n상태: ${result.inductionState}/${result.hoodState}`);
}
