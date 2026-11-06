import express, { type Express, type Request, type ErrorRequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { callerMatches } from './voiceQuotaRoutes';
import { VOICE_CONTRACT_VERSION } from '../shared/voiceQuota';

const ownerEmail = 'backtrue@gmail.com';
const officialAccount = '@791vlxya';
class LineError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
const text = z.string().min(1).max(500).regex(/^[^\x00-\x1f\x7f]+$/);
const jobId = text.max(100);
const registration = z.object({ memberId: text.max(256), recordId: jobId, jobId, expiresAt: z.number().int().positive() }).strict();
const prepare = z.object({ jobId, claimCode: z.string().regex(/^[a-f0-9]{32}$/), observedChatRef: text, chatRef: text, attemptId: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/), officialAccount: z.literal(officialAccount), supervised: z.literal(true) }).strict();
const complete = z.object({ jobId, attemptId: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/), chatRef: text, officialAccount: z.literal(officialAccount), outcome: z.enum(['sent', 'rejected', 'unknown']), receipt: z.string().min(1).max(1000).regex(/^[^\x00-\x1f\x7f]+$/), evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
type User = { id: string; email: string | null };
export function setupVoiceLineRoutes(app: Express, deps: {
  getServiceToken?: () => string | undefined; getJwtSecret?: () => string | undefined;
  getAppOrigin?: () => string | undefined; getUser?: (id: string) => Promise<User | null | undefined>;
  fetcher?: typeof fetch; assetRoot?: string;
} = {}) {
  const token = deps.getServiceToken ?? (() => process.env.THINKWITHBLACK_VOICE_SERVICE_TOKEN);
  const secret = deps.getJwtSecret ?? (() => process.env.JWT_SECRET);
  const origin = deps.getAppOrigin ?? (() => process.env.VOICE_APP_ORIGIN);
  const fetcher = deps.fetcher ?? fetch;
  const getUser = deps.getUser ?? (async (id: string) => { const [{ db }, { users }, { eq }] = await Promise.all([import('./db'), import('../shared/schema'), import('drizzle-orm')]); return (await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, id)).limit(1))[0]; });
  const headers: express.RequestHandler = (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Voice-Contract': VOICE_CONTRACT_VERSION, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" }); next();
  };
  const call = async (action: string, body: unknown): Promise<any> => {
    const configured = origin(); let base: URL;
    try { base = new URL(configured ?? ''); if (base.origin !== configured || base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error(); } catch { throw new LineError(503, 'VOICE_LINE_NOT_CONFIGURED'); }
    if (!callerMatches(`Bearer ${token() ?? ''}`, token())) throw new LineError(503, 'VOICE_LINE_NOT_CONFIGURED');
    let response: globalThis.Response;
    try { response = await fetcher(new URL('/internal/voice-line/' + action, base), { method: 'POST', redirect: 'manual', headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }); } catch { throw new LineError(503, 'VOICE_LINE_UNAVAILABLE'); }
    if (response.headers.get('x-voice-line-contract') !== 'voice-line-v1' || !response.headers.get('content-type')?.startsWith('application/json')) throw new LineError(503, 'VOICE_LINE_UNAVAILABLE');
    const reader = response.body?.getReader(); if (!reader) throw new LineError(503, 'VOICE_LINE_UNAVAILABLE');
    let raw = ''; const decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0;
    try { for (;;) { const value = await reader.read(); if (value.done) break; size += value.value.byteLength; if (size > 524288) { await reader.cancel(); throw new LineError(503, 'VOICE_LINE_UNAVAILABLE'); } raw += decoder.decode(value.value, { stream: true }); } raw += decoder.decode(); } finally { reader.releaseLock(); }
    let result: any; try { result = JSON.parse(raw); } catch { throw new LineError(503, 'VOICE_LINE_UNAVAILABLE'); }
    if (!response.ok) throw new LineError(response.status >= 400 && response.status < 500 ? response.status : 503, typeof result?.error === 'string' && /^[A-Z_]{1,64}$/.test(result.error) ? result.error : 'VOICE_LINE_UNAVAILABLE');
    if (!result || typeof result !== 'object') throw new LineError(503, 'VOICE_LINE_UNAVAILABLE');
    if (action === 'register' && result.registered !== true || action === 'list' && (result.officialAccount !== officialAccount || !Array.isArray(result.tasks))) throw new LineError(503, 'VOICE_LINE_UNAVAILABLE');
    if (action === 'prepare' || action === 'complete') {
      const requested = body as { jobId: string };
      if (result.id !== requested.jobId || result.channel !== 'line' || !['pending', 'sending', 'unknown', 'failed', 'succeeded'].includes(result.state)) throw new LineError(503, 'VOICE_LINE_UNAVAILABLE');
      if (result.resultUrl !== undefined && result.resultUrl !== new URL(`/#call=${encodeURIComponent(result.recordId)}&document=${encodeURIComponent(result.documentId)}`, base).href) throw new LineError(503, 'VOICE_LINE_UNAVAILABLE');
    }
    return result;
  };
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error instanceof LineError ? error.status : error?.type === 'entity.too.large' ? 413 : error?.type === 'entity.parse.failed' ? 400 : 503;
    res.status(status).json({ error: error instanceof LineError ? error.code : status === 413 ? 'REQUEST_TOO_LARGE' : status === 400 ? 'INVALID_REQUEST' : 'VOICE_LINE_UNAVAILABLE' });
  };
  const internal = express.Router(); internal.use(headers);
  internal.use((req, res, next) => { if (!token()) { res.status(503).json({ error: 'VOICE_LINE_NOT_CONFIGURED' }); return; } if (!callerMatches(req.get('authorization'), token())) { res.status(401).json({ error: 'UNAUTHORIZED_CALLER' }); return; } if (!req.is('application/json')) { res.status(415).json({ error: 'JSON_REQUIRED' }); return; } next(); });
  internal.use(express.json({ limit: '8kb', strict: true }));
  internal.post('/', async (req, res, next) => { try { const input = registration.safeParse(req.body); if (!input.success || input.data.expiresAt <= Date.now()) throw new LineError(400, 'INVALID_REQUEST'); const user = await getUser(input.data.memberId); if (!user || user.id !== input.data.memberId) throw new LineError(404, 'MEMBER_NOT_FOUND'); res.json(await call('register', input.data)); } catch (error) { next(error); } });
  internal.use(onError); app.use('/api/voice/internal/line/register', internal);

  const router = express.Router(); router.use(headers);
  const owner = async (req: Request) => {
    const key = secret(); if (!key || key === 'your-super-secret-jwt-key-change-this-in-production') throw new LineError(503, 'LOGIN_UNAVAILABLE');
    const cookies = (req.get('cookie') ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith('auth_token='));
    if (cookies.length !== 1) throw new LineError(401, 'LOGIN_REQUIRED');
    let value: jwt.JwtPayload; try { const parsed = jwt.verify(decodeURIComponent(cookies[0].slice(11)), key, { algorithms: ['HS256'] }); if (typeof parsed === 'string' || typeof parsed.id !== 'string' || typeof parsed.exp !== 'number' || parsed.email !== ownerEmail || parsed.sub !== undefined && parsed.sub !== parsed.id) throw new Error(); value = parsed; } catch { throw new LineError(401, 'LOGIN_REQUIRED'); }
    const user = await getUser(value.id); if (!user || user.id !== value.id || user.email?.trim().toLowerCase() !== ownerEmail) throw new LineError(403, 'OWNER_REQUIRED');
  };
  router.use(async (req, res, next) => { try { await owner(req); next(); } catch (error) { if (error instanceof LineError && error.status === 401 && req.method === 'GET' && ['/', ''].includes(req.path)) { res.status(401).type('html').send('<!doctype html><html lang="zh-Hant-TW"><meta charset="utf-8"><title>登入 LINE 成果核對</title><h1>LINE 成果核對</h1><a href="/api/auth/google?returnTo=%2Fbdmin%2Fvoice-line%2F">使用報數據 Google 登入</a></html>'); } else next(error); } });
  router.use((req, res, next) => { if (req.method === 'POST' && (req.get('origin') !== 'https://eccal.thinkwithblack.com' || req.get('x-voice-line-action') !== req.path.slice('/api/'.length) || !req.is('application/json'))) { res.status(403).json({ error: 'REQUEST_REJECTED' }); return; } next(); });
  router.use(express.json({ limit: '8kb', strict: true }));
  router.get('/api/tasks', async (_req, res, next) => { try { const result = await call('list', {}); const tasks = []; for (const task of result.tasks) { if (typeof task.memberId !== 'string') throw new LineError(503, 'VOICE_LINE_UNAVAILABLE'); const user = await getUser(task.memberId); tasks.push({ ...task, memberEmail: user?.email ?? null }); } res.json({ ...result, tasks }); } catch (error) { next(error); } });
  for (const [action, schema] of [['prepare', prepare], ['complete', complete]] as const) router.post('/api/' + action, async (req, res, next) => { try { const input = schema.safeParse(req.body); if (!input.success) throw new LineError(400, 'INVALID_REQUEST'); res.json(await call(action, input.data)); } catch (error) { next(error); } });
  for (const [route, file, type] of [['/', 'index.html', 'html'], ['/app.js', 'app.js', 'application/javascript'], ['/style.css', 'style.css', 'text/css']]) router.get(route, async (_req, res, next) => { try { res.type(type).send(await readFile(resolve(deps.assetRoot ?? resolve(process.cwd(), 'server/voice-line'), file), 'utf8')); } catch (error) { next(error); } });
  router.use(onError); app.use('/bdmin/voice-line', router);
}
