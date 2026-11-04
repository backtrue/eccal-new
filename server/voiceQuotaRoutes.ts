import { createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import express, { type Express, type ErrorRequestHandler, type RequestHandler } from 'express';
import { z } from 'zod';
import { VOICE_CONTRACT_VERSION, VoiceQuotaError, voiceMemberId, voiceOperationId } from '../shared/voiceQuota';
import { createVoiceQuotaService, type VoiceQuotaService } from './voiceQuotaService';

export function verifyVoiceJwt(token: string, secret: string | undefined): string | null {
  if (!secret) throw new VoiceQuotaError('VOICE_AUTH_NOT_CONFIGURED', 503);
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !voiceMemberId.safeParse(payload.id).success || typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now() || payload.sub !== undefined && payload.sub !== payload.id) return null;
    return payload.id;
  } catch { return null; }
}

function memberToken(credentials: { cookie: string; authorization: string }): string | null {
  if (credentials.authorization) return /^Bearer ([^\s]+)$/.exec(credentials.authorization)?.[1] ?? null;
  const cookies = credentials.cookie.split(';').map(part => part.trim()).filter(part => part.startsWith('auth_token='));
  if (cookies.length !== 1) return null;
  try { return decodeURIComponent(cookies[0].slice('auth_token='.length)) || null; } catch { return null; }
}
export function callerMatches(header: string | undefined, expected: string | undefined) {
  const candidate = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? '')?.[1] ?? '';
  const validKey = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, 'base64url').length === 32 && Buffer.from(value, 'base64url').toString('base64url') === value;
  return timingSafeEqual(createHash('sha256').update(candidate).digest(), createHash('sha256').update(expected ?? '').digest()) && validKey(candidate) && validKey(expected ?? '');
}

export function setupVoiceQuotaRoutes(app: Express, deps: {
  getServiceToken?: () => string | undefined;
  verifyJwt?: (token: string) => string | null | Promise<string | null>;
  service?: () => Promise<VoiceQuotaService>;
  authenticateSession?: (token: string) => Promise<{ memberId: string; expiresAt: number } | null>;
} = {}) {
  const getServiceToken = deps.getServiceToken ?? (() => process.env.THINKWITHBLACK_VOICE_SERVICE_TOKEN);
  const verifyJwt = deps.verifyJwt ?? (token => verifyVoiceJwt(token, process.env.JWT_SECRET));
  const load = deps.service ?? (async () => {
    const [{ pool, db }, { users }, { eq }, { createVoiceQuotaRepository }] = await Promise.all([import('./db'), import('../shared/schema'), import('drizzle-orm'), import('./voiceQuotaRepository')]);
    return createVoiceQuotaService({ repository: createVoiceQuotaRepository(pool), getUser: async id => (await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1))[0] });
  });
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Voice-Contract', VOICE_CONTRACT_VERSION); next(); });
  router.use('/internal', (req, res, next) => {
    if (!getServiceToken()) { res.status(503).json({ error: 'VOICE_NOT_CONFIGURED' }); return; }
    if (!callerMatches(req.get('Authorization'), getServiceToken())) { res.status(401).json({ error: 'UNAUTHORIZED_CALLER' }); return; }
    if (!req.is('application/json')) { res.status(415).json({ error: 'JSON_REQUIRED' }); return; }
    next();
  });
  router.use(express.json({ limit: '256kb', strict: true }));
  const credentials = z.object({ cookie: z.string().max(8192), authorization: z.string().max(8192) }).strict();
  async function identity(input: z.infer<typeof credentials>) {
    const sessionNames = ['__Host-realtime_session', ...(process.env.VOICE_APP_ORIGIN?.startsWith('http://') ? ['realtime_session'] : [])];
    const sessions = input.cookie.split(';').map(part => part.trim()).filter(part => sessionNames.some(name => part.startsWith(`${name}=`)));
    if (sessions.length) {
      if (sessions.length !== 1) return null;
      const token = sessions[0].slice(sessions[0].indexOf('=') + 1);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const authenticate = deps.authenticateSession ?? (async (value: string) => { const [{ pool }, { createVoiceLoginRepository }] = await Promise.all([import('./db'), import('./voiceLoginRepository')]); return createVoiceLoginRepository(pool).authenticate(value); });
      const session = await authenticate(token);
      if (!session || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Date.now()) return null;
      return (await load()).identity(session.memberId);
    }
    const token = memberToken(input);
    if (!token) return null;
    const id = await verifyJwt(token);
    if (!id) return null;
    try { return await (await load()).identity(id); }
    catch (error) { if (error instanceof VoiceQuotaError && error.code === 'MEMBER_NOT_FOUND') return null; throw error; }
  }
  const handle = (schema: z.ZodTypeAny, action: (input: any) => Promise<unknown>): RequestHandler => async (req, res, next) => {
    try {
      const input = schema.safeParse(req.body);
      if (!input.success) throw new VoiceQuotaError('INVALID_REQUEST', 400);
      res.json(await action(input.data));
    } catch (error) { next(error); }
  };
  router.post('/internal/authenticate', handle(credentials, identity));
  router.post('/internal/balance', handle(z.object({ memberId: voiceMemberId }).strict(), async input => (await load()).balance(input.memberId)));
  router.post('/internal/reserve', handle(z.object({ memberId: voiceMemberId, operationId: voiceOperationId }).strict(), async input => (await load()).reserve(input.memberId, input.operationId)));
  router.post('/internal/settle', handle(z.object({ memberId: voiceMemberId, reservationId: z.string().uuid(), events: z.unknown() }).strict(), async input => (await load()).settle(input.memberId, input.reservationId, input.events)));
  router.get('/quota', async (req, res, next) => {
    try {
      const input = credentials.safeParse({ cookie: req.get('Cookie') ?? '', authorization: req.get('Authorization') ?? '' });
      const member = input.success ? await identity(input.data) : null;
      if (!member) throw new VoiceQuotaError('LOGIN_REQUIRED', 401);
      res.json(await (await load()).balance(member.memberId));
    } catch (error) { next(error); }
  });
  router.use(((error, _req, res, _next) => {
    const status = error instanceof VoiceQuotaError ? error.status : error?.type === 'entity.too.large' ? 413 : error?.type === 'entity.parse.failed' ? 400 : 503;
    const code = error instanceof VoiceQuotaError ? error.code : status === 413 ? 'REQUEST_TOO_LARGE' : status === 400 ? 'INVALID_REQUEST' : 'VOICE_UNAVAILABLE';
    res.status(status).json({ error: code });
  }) as ErrorRequestHandler);
  app.use('/api/voice', router);
}
