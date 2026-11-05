import express, { type Express, type ErrorRequestHandler, type RequestHandler } from 'express';
import { z } from 'zod';
import { VOICE_CONTRACT_VERSION, VoiceQuotaError, voiceMemberId } from '../shared/voiceQuota';
import { callerMatches } from './voiceQuotaRoutes';
import { createVoiceEmailService } from './voiceEmailService';

export function setupVoiceEmailRoutes(app: Express, deps: {
  getServiceToken?: () => string | undefined;
  service?: () => Promise<ReturnType<typeof createVoiceEmailService>>;
} = {}) {
  const token = deps.getServiceToken ?? (() => process.env.THINKWITHBLACK_VOICE_SERVICE_TOKEN);
  const load = deps.service ?? (async () => {
    const [{ db }, { users }, { eq }] = await Promise.all([import('./db'), import('../shared/schema'), import('drizzle-orm')]);
    return createVoiceEmailService({ getUser: async id => (await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, id)).limit(1))[0] });
  });
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store'); res.set('X-Voice-Contract', VOICE_CONTRACT_VERSION);
    if (!token()) { res.status(503).json({ error: 'VOICE_NOT_CONFIGURED' }); return; }
    if (!callerMatches(req.get('Authorization'), token())) { res.status(401).json({ error: 'UNAUTHORIZED_CALLER' }); return; }
    if (!req.is('application/json')) { res.status(415).json({ error: 'JSON_REQUIRED' }); return; }
    next();
  });
  router.use(express.json({ limit: '4kb', strict: true }));
  const job = z.object({ memberId: voiceMemberId, jobId: z.string().uuid(), recordId: z.string().uuid(), documentId: z.string().uuid(), recipient: z.string().max(320), createdAt: z.number().int().nonnegative().safe() }).strict();
  const handle = (schema: z.ZodTypeAny, action: (data: any) => Promise<unknown>): RequestHandler => async (req, res, next) => {
    try { const parsed = schema.safeParse(req.body); if (!parsed.success) throw new VoiceQuotaError('INVALID_REQUEST', 400); res.json(await action(parsed.data)); }
    catch (error) { next(error); }
  };
  router.post('/recipient', handle(z.object({ memberId: voiceMemberId }).strict(), async input => (await load()).recipient(input.memberId)));
  router.post('/verify', handle(job, async input => (await load()).verify(input)));
  router.post('/send', handle(job.extend({ resultUrl: z.string().max(1024) }).strict(), async input => (await load()).send(input)));
  router.use(((error, _req, res, _next) => {
    const status = error instanceof VoiceQuotaError ? error.status : error?.type === 'entity.too.large' ? 413 : error?.type === 'entity.parse.failed' ? 400 : 503;
    res.status(status).json({ error: error instanceof VoiceQuotaError ? error.code : status === 413 ? 'REQUEST_TOO_LARGE' : status === 400 ? 'INVALID_REQUEST' : 'EMAIL_UNAVAILABLE' });
  }) as ErrorRequestHandler);
  app.use('/api/voice/internal/email', router);
}
