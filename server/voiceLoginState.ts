import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { VoiceQuotaError } from '../shared/voiceQuota';

export function voiceAppOrigin(value: string | undefined): string {
  try {
    const url = new URL(value ?? '');
    if (url.origin !== value || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error();
    return url.origin;
  } catch { throw new VoiceQuotaError('VOICE_LOGIN_NOT_CONFIGURED', 503); }
}
function key(value: string | undefined): Buffer {
  const result = Buffer.from(value ?? '', 'base64url');
  if (result.length !== 32 || result.toString('base64url') !== value) throw new VoiceQuotaError('VOICE_LOGIN_NOT_CONFIGURED', 503);
  return result;
}
export function verifyVoiceLoginState(state: string, serviceKey: string | undefined, appOrigin: string, now = Date.now()): boolean {
  try {
    const [version, payload, mac, extra] = state.split('.');
    if (version !== 'voice1' || !payload || !mac || extra !== undefined || state.length > 2048) return false;
    const expected = createHmac('sha256', key(serviceKey)).update(`${version}.${payload}`).digest();
    const supplied = Buffer.from(mac, 'base64url');
    if (supplied.length !== 32 || supplied.toString('base64url') !== mac || !timingSafeEqual(expected, supplied)) return false;
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return value.audience === appOrigin && typeof value.nonce === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.nonce) && typeof value.browser === 'string' && /^[a-f0-9]{64}$/.test(value.browser) && Number.isSafeInteger(value.expiresAt) && value.expiresAt > now && value.expiresAt <= now + 600000;
  } catch { return false; }
}

const GOOGLE_COOKIE = 'voice_google_state';
const contextOptions = (secure: boolean) => ({ httpOnly: true, secure, sameSite: 'lax' as const, path: '/' });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function signContext(value: unknown, secret: string | undefined) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${createHmac('sha256', key(secret)).update(`voice-context1.${payload}`).digest('base64url')}`;
}
function openContext(value: unknown, secret: string | undefined): { stateHash: string; jwtHash: string; expiresAt: number } | null {
  try {
    if (typeof value !== 'string' || value.length > 2048) return null;
    const [payload, signature, extra] = value.split('.'); if (extra !== undefined) return null;
    const expected = createHmac('sha256', key(secret)).update(`voice-context1.${payload}`).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== 32 || supplied.toString('base64url') !== signature || !timingSafeEqual(expected, supplied)) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return /^[a-f0-9]{64}$/.test(decoded.stateHash) && /^[a-f0-9]{64}$/.test(decoded.jwtHash) && Number.isSafeInteger(decoded.expiresAt) && decoded.expiresAt > Date.now() && decoded.expiresAt <= Date.now() + 600000 ? decoded : null;
  } catch { return null; }
}
export function bindVoiceLoginContext(res: { cookie: Function }, state: string, token: string, secret: string | undefined, secure: boolean) {
  res.cookie('voice_login_context', signContext({ stateHash: digest(state), jwtHash: digest(token), expiresAt: Date.now() + 600000 }, secret), { ...contextOptions(secure), maxAge: 600000 });
}
export function verifyVoiceLoginContext(value: unknown, state: string, token: string, secret: string | undefined) {
  const context = openContext(value, secret);
  return !!context && context.stateHash === digest(state) && context.jwtHash === digest(token);
}
export function completeVoiceLoginContext(req: { cookies?: Record<string, unknown> }, res: { cookie: Function }, token: string, secret: string | undefined, secure: boolean) {
  const context = openContext(req.cookies?.voice_login_context, secret);
  if (!context) throw new VoiceQuotaError('LOGIN_STATE_INVALID', 400);
  res.cookie('voice_login_context', signContext({ ...context, jwtHash: digest(token) }, secret), { ...contextOptions(secure), maxAge: Math.max(0, context.expiresAt - Date.now()) });
}
const options = (secure: boolean) => ({ httpOnly: true, secure, sameSite: 'lax' as const, path: '/api/auth/google' });
export function beginVoiceGoogleState(res: { cookie: Function }, secret: string | undefined, secure: boolean): string {
  const nonce = randomBytes(32).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ nonce, expiresAt: Date.now() + 600000 })).toString('base64url');
  const signature = createHmac('sha256', key(secret)).update(`voice-google1.${payload}`).digest('base64url');
  res.cookie(GOOGLE_COOKIE, nonce, { ...options(secure), maxAge: 600000 });
  return `voice-google1.${payload}.${signature}`;
}
export function consumeVoiceGoogleState(req: { cookies?: Record<string, unknown> }, res: { clearCookie: Function }, state: string, secret: string | undefined, secure: boolean): boolean {
  res.clearCookie(GOOGLE_COOKIE, options(secure));
  try {
    const [version, payload, signature, extra] = state.split('.');
    if (version !== 'voice-google1' || extra !== undefined || state.length > 2048) return false;
    const expected = createHmac('sha256', key(secret)).update(`${version}.${payload}`).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== 32 || supplied.toString('base64url') !== signature || !timingSafeEqual(expected, supplied)) return false;
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const cookie = req.cookies?.[GOOGLE_COOKIE];
    return typeof cookie === 'string' && cookie.length === 43 && value.nonce === cookie && Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now() && value.expiresAt <= Date.now() + 600000;
  } catch { return false; }
}
