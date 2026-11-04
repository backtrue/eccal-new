import express, { type Express, type ErrorRequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { VoiceQuotaError, VOICE_CONTRACT_VERSION, voiceMemberId } from '../shared/voiceQuota';
import { callerMatches } from './voiceQuotaRoutes';
import { verifyVoiceLoginState, voiceAppOrigin, bindVoiceLoginContext, verifyVoiceLoginContext } from './voiceLoginState';
import type { VoiceLoginRepository } from './voiceLoginRepository';

export function setupVoiceLoginRoutes(app: Express, deps: {
  getKey?: () => string | undefined; getAppOrigin?: () => string | undefined;
  repository?: () => Promise<VoiceLoginRepository>;
  verifyJwt?: (token: string) => Promise<{ id: string; expiresAt: number } | null>;
} = {}) {
  const getKey = deps.getKey ?? (() => process.env.THINKWITHBLACK_VOICE_SERVICE_TOKEN);
  const getOrigin = () => voiceAppOrigin(deps.getAppOrigin?.() ?? process.env.VOICE_APP_ORIGIN);
  const repository = deps.repository ?? (async () => { const [{ pool }, { createVoiceLoginRepository }] = await Promise.all([import('./db'), import('./voiceLoginRepository')]); return createVoiceLoginRepository(pool); });
  const verifyJwt = deps.verifyJwt ?? (async token => {
    if (!process.env.JWT_SECRET) throw new VoiceQuotaError('VOICE_AUTH_NOT_CONFIGURED', 503);
    try {
      const value = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      return typeof value !== 'string' && voiceMemberId.safeParse(value.id).success && typeof value.exp === 'number' && value.exp * 1000 > Date.now() && (value.sub === undefined || value.sub === value.id) ? { id: value.id, expiresAt: value.exp * 1000 } : null;
    } catch { return null; }
  });
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); res.set('X-Voice-Contract', VOICE_CONTRACT_VERSION); next(); });
  const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production' || getOrigin().startsWith('https:'), sameSite: 'lax' as const, path: '/api/voice' });
  const readCookie = (header: string | undefined, name: string) => {
    const matches = (header ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
    if (matches.length !== 1) return undefined;
    try { return decodeURIComponent(matches[0].slice(name.length + 1)); } catch { return undefined; }
  };
  router.get('/login', async (req, res, next) => {
    try {
      const origin = getOrigin();
      if (req.query.state !== undefined) {
        if (Object.keys(req.query).length !== 1 || typeof req.query.state !== 'string' || !verifyVoiceLoginState(req.query.state, getKey(), origin)) throw new VoiceQuotaError('LOGIN_STATE_INVALID', 400);
        res.cookie('voice_login_state', req.query.state, { ...cookieOptions(), maxAge: 600000 });
        bindVoiceLoginContext(res, req.query.state, readCookie(req.get('Cookie'), 'auth_token') ?? '', getKey(), cookieOptions().secure);
        res.redirect(302, '/api/voice/login'); return;
      }
      if (Object.keys(req.query).some(key => key !== 'auth_success') || req.query.auth_success !== undefined && req.query.auth_success !== '1') throw new VoiceQuotaError('LOGIN_STATE_INVALID', 400);
      const state = readCookie(req.get('Cookie'), 'voice_login_state');
      if (!state || !verifyVoiceLoginState(state, getKey(), origin)) throw new VoiceQuotaError('LOGIN_STATE_INVALID', 400);
      const token = readCookie(req.get('Cookie'), 'auth_token');
      if (!verifyVoiceLoginContext(readCookie(req.get('Cookie'), 'voice_login_context'), state, token ?? '', getKey())) throw new VoiceQuotaError('LOGIN_STATE_INVALID', 400);
      const identity = token ? await verifyJwt(token) : null;
      if (!identity) { res.redirect(302, '/api/auth/google?returnTo=%2Fapi%2Fvoice%2Flogin'); return; }
      const code = await (await repository()).createCode(identity.id, state, origin, identity.expiresAt);
      const callback = new URL('/auth/callback', origin); callback.searchParams.set('code', code); callback.searchParams.set('state', state);
      res.clearCookie('voice_login_state', cookieOptions()); res.clearCookie('voice_login_context', { ...cookieOptions(), path: '/' }); res.redirect(302, callback.href);
    } catch (error) { next(error); }
  });
  router.use('/internal/login', (req, res, next) => {
    if (!getKey()) { next(new VoiceQuotaError('VOICE_NOT_CONFIGURED', 503)); return; }
    if (!callerMatches(req.get('Authorization'), getKey())) { next(new VoiceQuotaError('UNAUTHORIZED_CALLER', 401)); return; }
    if (!req.is('application/json')) { next(new VoiceQuotaError('JSON_REQUIRED', 415)); return; }
    next();
  });
  router.use('/internal/login', express.json({ limit: '16kb', strict: true }));
  router.post('/internal/login/exchange', async (req, res, next) => {
    try {
      const input = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/), state: z.string().max(2048) }).strict().safeParse(req.body);
      if (!input.success || !verifyVoiceLoginState(input.data.state, getKey(), getOrigin())) throw new VoiceQuotaError('LOGIN_STATE_INVALID', 400);
      res.json(await (await repository()).exchange(input.data.code, input.data.state, getOrigin()));
    } catch (error) { next(error); }
  });
  router.post('/internal/login/revoke', async (req, res, next) => {
    try {
      const input = z.object({ sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().safeParse(req.body);
      if (!input.success) throw new VoiceQuotaError('INVALID_REQUEST', 400);
      await (await repository()).revoke(input.data.sessionToken); res.json({ revoked: true });
    } catch (error) { next(error); }
  });
  router.post('/internal/login/mcp-identity', async (req, res, next) => {
    try {
      const input = z.object({ memberId: voiceMemberId, accountEmail: z.string().email().max(320) }).strict().safeParse(req.body);
      if (!input.success) throw new VoiceQuotaError('INVALID_REQUEST', 400);
      res.json({ memberId: input.data.memberId, matches: await (await repository()).matchesAccount(input.data.memberId, input.data.accountEmail) });
    } catch (error) { next(error); }
  });
  router.use(((error, _req, res, _next) => { res.status(error instanceof VoiceQuotaError ? error.status : error?.type === 'entity.too.large' ? 413 : error?.type === 'entity.parse.failed' ? 400 : 503).json({ error: error instanceof VoiceQuotaError ? error.code : 'VOICE_LOGIN_UNAVAILABLE' }); }) as ErrorRequestHandler);
  app.use('/api/voice', router);
}
