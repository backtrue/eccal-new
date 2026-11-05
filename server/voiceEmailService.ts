import { VoiceQuotaError } from '../shared/voiceQuota';

export const VOICE_EMAIL_FROM = 'AI 小黑 <call@toldyou.co>';
export type VoiceEmailJob = { memberId: string; jobId: string; recordId: string; documentId: string; recipient: string; createdAt: number };
export type VoiceEmailResult = { outcome: 'sent'; receipt: string } | { outcome: 'rejected' | 'unknown'; failureCode: 'EMAIL_NOT_CONFIGURED' | 'RECIPIENT_UNVERIFIED' | 'RESEND_REJECTED' | 'RESEND_UNAVAILABLE'; providerStatus?: number };

export function createVoiceEmailService(deps: {
  getUser: (id: string) => Promise<{ id: string; email: string | null } | undefined>;
  getApiKey?: () => string | undefined;
  getAppOrigin?: () => string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  const getApiKey = deps.getApiKey ?? (() => process.env.RESEND_API_KEY);
  const getAppOrigin = deps.getAppOrigin ?? (() => process.env.VOICE_APP_ORIGIN);
  const recipient = async (memberId: string) => {
    const user = await deps.getUser(memberId);
    if (!user || user.id !== memberId) throw new VoiceQuotaError('MEMBER_NOT_FOUND', 404);
    const email = user.email?.trim().toLowerCase();
    if (!email || email.length > 320 || !/^[^\s@<>]+@[^\s@<>]+$/.test(email)) throw new VoiceQuotaError('EMAIL_RECIPIENT_UNAVAILABLE', 503);
    return { memberId, recipient: email };
  };
  const verify = async (job: VoiceEmailJob) => {
    const account = await recipient(job.memberId);
    if (job.recipient !== account.recipient) throw new VoiceQuotaError('RECIPIENT_UNVERIFIED', 403);
    if (job.createdAt > now()) throw new VoiceQuotaError('INVALID_REQUEST', 400);
    return { memberId: job.memberId, jobId: job.jobId, documentId: job.documentId, recipient: account.recipient, verifiedAt: now(), supervised: false };
  };
  const send = async (job: VoiceEmailJob & { resultUrl: string }): Promise<VoiceEmailResult> => {
    try { await verify(job); }
    catch (error) {
      if (error instanceof VoiceQuotaError && ['MEMBER_NOT_FOUND', 'EMAIL_RECIPIENT_UNAVAILABLE', 'RECIPIENT_UNVERIFIED'].includes(error.code)) return { outcome: 'rejected', failureCode: 'RECIPIENT_UNVERIFIED' };
      throw error;
    }
    const origin = getAppOrigin();
    let expected: URL;
    try {
      const url = new URL(origin ?? '');
      if (url.origin !== origin || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error();
      expected = new URL(`/#call=${encodeURIComponent(job.recordId)}&document=${encodeURIComponent(job.documentId)}`, url);
    } catch { return { outcome: 'rejected', failureCode: 'EMAIL_NOT_CONFIGURED' }; }
    if (job.resultUrl !== expected.href) throw new VoiceQuotaError('INVALID_REQUEST', 400);
    const apiKey = getApiKey();
    if (!apiKey) return { outcome: 'rejected', failureCode: 'EMAIL_NOT_CONFIGURED' };
    try {
      const response = await (deps.fetch ?? fetch)('https://api.resend.com/emails', {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(7000),
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'idempotency-key': `voice-result/${job.jobId}` },
        body: JSON.stringify({ from: VOICE_EMAIL_FROM, to: [job.recipient], subject: 'AI 小黑諮詢成果', text: `你的諮詢成果已準備好\n\n開啟成果：${job.resultUrl}\n\n請使用本次諮詢的 ECCAL 會員帳號登入` }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status)
          ? { outcome: 'rejected', failureCode: 'RESEND_REJECTED', providerStatus: response.status }
          : { outcome: 'unknown', failureCode: 'RESEND_UNAVAILABLE', providerStatus: response.status };
      }
      if (!response.headers.get('content-type')?.startsWith('application/json')) { await response.body?.cancel(); return { outcome: 'unknown', failureCode: 'RESEND_UNAVAILABLE' }; }
      const reader = response.body?.getReader();
      if (!reader) return { outcome: 'unknown', failureCode: 'RESEND_UNAVAILABLE' };
      let size = 0; const chunks: Uint8Array[] = [];
      try {
        for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 8192) { await reader.cancel(); return { outcome: 'unknown', failureCode: 'RESEND_UNAVAILABLE' }; } chunks.push(chunk.value); }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id)) return { outcome: 'unknown', failureCode: 'RESEND_UNAVAILABLE' };
      return { outcome: 'sent', receipt: value.id };
    } catch { return { outcome: 'unknown', failureCode: 'RESEND_UNAVAILABLE' }; }
  };
  return { recipient, verify, send };
}
