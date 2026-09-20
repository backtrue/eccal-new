import express, { type Express, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { createGtmCredentialService, type GtmCredentialService } from "./gtmCredentialService";
import { createGtmOAuthService, type GtmOAuthError } from "./gtmOAuth";
import { createGtmReadService, GtmReadError, type GtmReadInput } from "./gtmReadService";
import { createGtmRepository, type GtmRepository } from "./gtmRepository";

export const GTM_BROWSER_STATUS_PATH = "/api/gtm/browser/status";
export const GTM_BROWSER_BEGIN_PATH = "/api/gtm/browser/begin";
export const GTM_BROWSER_START_PATH = "/api/gtm/browser/start";
export const GTM_BROWSER_DISCONNECT_PATH = "/api/gtm/browser/disconnect";
export const GTM_CALLBACK_PATH = "/api/gtm/oauth/callback";
export const GTM_INTERNAL_PREFIX = "/api/gtm/internal";
const ORIGIN = "https://eccal.thinkwithblack.com";
const PENDING_COOKIE = "twb_gtm_pending";
const FLOW_COOKIE = "twb_gtm_flow";
const COOKIE_OPTIONS = Object.freeze({ httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600_000 });
const callbackHeaders = (res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
};
function envelopeCookie(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
function parseEnvelopeCookie(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.length > 4096) throw new GtmRouteError("GTM_CALLER_REJECTED");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new GtmRouteError("GTM_CALLER_REJECTED"); }
}

export type GtmRouteCore = Readonly<{ oauth: ReturnType<typeof createGtmOAuthService>; read: ReturnType<typeof createGtmReadService>; repository: GtmRepository; credentialService: GtmCredentialService }>;
export type GtmRouteDependencies = Readonly<{
  getCallerToken: () => string | undefined;
  loadCore: () => Promise<GtmRouteCore>;
  getUser: (id: string) => Promise<{ id?: unknown } | null | undefined>;
  getMembership: (id: string) => Promise<{ user_id?: unknown } | null | undefined>;
  verifyBrowserJwt: (token: string) => { id?: unknown } | null | Promise<{ id?: unknown } | null>;
}>;
class GtmRouteError extends Error {
  constructor(readonly code: string) { super(code); }
}
const PUBLIC_ERROR_CODES = new Set([
  "GTM_INVALID_INPUT", "GTM_CONNECTION_REJECTED", "GTM_RESOURCE_NOT_FOUND",
  "GTM_RESOURCE_IDENTITY_MISMATCH", "GTM_CALLER_REJECTED", "GTM_CSRF_REJECTED",
  "GTM_OAUTH_CONFIGURATION", "GTM_OAUTH_REAUTHORIZATION_REQUIRED",
  "GTM_UPSTREAM_TIMEOUT", "GTM_OPERATION_TIMEOUT", "GTM_UPSTREAM_REDIRECT",
  "GTM_UPSTREAM_RESPONSE_TOO_LARGE", "GTM_UPSTREAM_INVALID_RESPONSE",
  "GTM_UPSTREAM_REJECTED",
]);

function error(res: Response, value: unknown) {
  const candidate = value instanceof Error ? value as Error & { code?: string } : undefined;
  const candidateCode = candidate?.code ?? candidate?.message;
  const code = candidateCode && PUBLIC_ERROR_CODES.has(candidateCode) ? candidateCode : "GTM_UNAVAILABLE";
  const status = code === "GTM_INVALID_INPUT" ? 400
    : code === "GTM_CSRF_REJECTED" ? 403
    : code === "GTM_CALLER_REJECTED" ? 401
    : code === "GTM_OAUTH_CONFIGURATION" ? 503
    : code === "GTM_CONNECTION_REJECTED" || code === "GTM_OAUTH_REAUTHORIZATION_REQUIRED" ? 409
    : code === "GTM_UPSTREAM_TIMEOUT" || code === "GTM_OPERATION_TIMEOUT" ? 504
    : code === "GTM_RESOURCE_NOT_FOUND" ? 404 : 502;
  res.status(status).json({ success: false, error: code, retryable: status >= 500 });
}
function bearer(req: Request, expected: string | undefined) {
  return typeof expected === "string" && expected.length >= 32 && req.get("authorization") === `Bearer ${expected}`;
}
function csrfProof(core: GtmRouteCore, req: Request): string {
  return core.credentialService.hashOpaqueProof("browser_session", `gtm-csrf:${req.cookies?.auth_token ?? ""}`);
}
function sameOrigin(req: Request): boolean {
  return req.get("origin") === ORIGIN;
}
async function protectMutation(d: GtmRouteDependencies, req: Request): Promise<string> {
  if (!sameOrigin(req)) throw new GtmRouteError("GTM_CSRF_REJECTED");
  const userId = await member(d, req);
  const core = await d.loadCore();
  if (req.get("x-gtm-csrf") !== csrfProof(core, req)) throw new GtmRouteError("GTM_CSRF_REJECTED");
  return userId;
}
async function member(d: GtmRouteDependencies, req: Request): Promise<string> {
  const token = req.cookies?.auth_token;
  const identity = typeof token === "string" ? await d.verifyBrowserJwt(token) : null;
  const id = identity?.id;
  if (typeof id !== "string" || (await d.getUser(id))?.id !== id || (await d.getMembership(id))?.user_id !== id) throw new GtmRouteError("GTM_CALLER_REJECTED");
  return id;
}
export function createGtmRouter(d: GtmRouteDependencies) {
  const router = express.Router();
  router.use(cookieParser());
  router.use(express.json({ limit: "1mb", strict: true }));
  router.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use((req, res, next) => {
    // Remove OAuth query/cookie headers before any downstream logger can observe them.
    if (req.path === GTM_CALLBACK_PATH) {
      (req as any).gtmCallbackQuery = new URL(req.originalUrl, ORIGIN).searchParams;
      req.url = GTM_CALLBACK_PATH;
      req.originalUrl = GTM_CALLBACK_PATH;
      delete req.headers.cookie;
      delete req.headers.authorization;
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Content-Security-Policy", "default-src 'none'");
      res.setHeader("X-Content-Type-Options", "nosniff");
    }
    next();
  });
  router.get(GTM_BROWSER_STATUS_PATH, async (req, res) => {
    try { const userId = await member(d, req); const core = await d.loadCore(); const c = await core.repository.ensureConnection({ userId, googleClientId: process.env.GOOGLE_GTM_CLIENT_ID ?? "" }); res.json({ status: c.status, connectionId: c.connectionId, generation: c.generation, csrfProof: core.credentialService.hashOpaqueProof("browser_session", `gtm-csrf:${req.cookies.auth_token}`) }); } catch (e) { error(res, e); }
  });
  router.post(GTM_BROWSER_BEGIN_PATH, async (req, res) => {
     try {
       const userId = await protectMutation(d, req);
       const core = await d.loadCore();
       const c = await core.oauth.beginConnection({ userId });
       const ticket = new URL(c.connectionUrl).searchParams.get("gtm_ticket");
       if (!ticket) throw new Error("GTM_OAUTH_REJECTED");
       const handoff = core.credentialService.encryptBrowserHandoff(userId, JSON.stringify({
         ticket, connectionId: c.connection.connectionId, generation: c.connection.generation,
       }));
       res.cookie(PENDING_COOKIE, envelopeCookie(handoff), { ...COOKIE_OPTIONS, path: "/api/gtm/browser" });
       res.status(201).json({ connectionId: c.connection.connectionId, generation: c.connection.generation, expiresAt: c.expiresAt });
     } catch (e) { error(res, e); }
  });
  router.post(GTM_BROWSER_START_PATH, async (req, res) => {
     try {
       const userId = await protectMutation(d, req);
       const core = await d.loadCore();
       const pending = JSON.parse(core.credentialService.decryptBrowserHandoff(userId, parseEnvelopeCookie(req.cookies?.[PENDING_COOKIE]) as never)) as Record<string, unknown>;
       if (pending.connectionId !== req.body.connectionId || Number(pending.generation) !== Number(req.body.generation)) throw new Error("GTM_OAUTH_REJECTED");
       const r = await core.oauth.startAuthorization({ userId, connectionId: String(pending.connectionId), generation: Number(pending.generation), ticket: String(pending.ticket), browserSessionProof: req.cookies.auth_token });
       const state = new URL(r.authorizationUrl).searchParams.get("state");
       if (!state) throw new Error("GTM_OAUTH_REJECTED");
       const flow = core.credentialService.encryptBrowserHandoff(userId, JSON.stringify({ connectionId: pending.connectionId, generation: pending.generation, state }));
       res.cookie(FLOW_COOKIE, envelopeCookie(flow), { ...COOKIE_OPTIONS, path: GTM_CALLBACK_PATH });
       res.clearCookie(PENDING_COOKIE, { ...COOKIE_OPTIONS, path: "/api/gtm/browser" });
       res.json({ authorizationUrl: r.authorizationUrl });
     } catch (e) { error(res, e); }
  });
  router.post(GTM_BROWSER_DISCONNECT_PATH, async (req, res) => {
     try { const userId = await protectMutation(d, req); const r = await (await d.loadCore()).oauth.disconnect({ userId, connectionId: String(req.body.connectionId), generation: Number(req.body.generation) }); res.json(r); } catch (e) { error(res, e); }
  });
   router.get(GTM_CALLBACK_PATH, async (req, res) => {
     callbackHeaders(res);
     let terminal = false;
      try {
        const authToken = typeof req.cookies?.auth_token === "string" ? req.cookies.auth_token : "";
        const flowCookie = req.cookies?.[FLOW_COOKIE];
        const userId = await member(d, req);
        delete req.headers.cookie;
        delete req.headers.authorization;
        req.cookies = {};
        const query = (req as any).gtmCallbackQuery as URLSearchParams | undefined;
        (req as any).gtmCallbackQuery = undefined;
        const c = await d.loadCore();
        const flow = JSON.parse(c.credentialService.decryptBrowserHandoff(userId, parseEnvelopeCookie(flowCookie) as never)) as Record<string, unknown>;
        if (!query || Array.from(query.keys()).some(key => !["state", "code", "error", "error_description"].includes(key))) throw new Error("GTM_OAUTH_REJECTED");
        const stateValues = query.getAll("state");
        const state = stateValues.length === 1 ? stateValues[0] : "";
        if (!state || state !== flow.state || query.getAll("code").length > 1 || query.getAll("error").length > 1) throw new Error("GTM_OAUTH_REJECTED");
        const code = query.get("code");
        const oauthError = query.get("error");
        const hasCode = typeof code === "string" && code.length > 0;
        const hasError = typeof oauthError === "string" && oauthError.length > 0;
        if (hasCode === hasError) throw new Error("GTM_OAUTH_REJECTED");
        if (hasError) {
          await c.oauth.handleAuthorizationDenied({ userId, connectionId: String(flow.connectionId), generation: Number(flow.generation), state, browserSessionProof: authToken });
          res.clearCookie(FLOW_COOKIE, { ...COOKIE_OPTIONS, path: GTM_CALLBACK_PATH });
          terminal = true;
          return res.redirect(303, "/settings");
        }
        await c.oauth.handleCallback({
          userId,
          connectionId: String(flow.connectionId),
          generation: Number(flow.generation),
          state,
          browserSessionProof: authToken,
          code: code!,
        });
        res.clearCookie(FLOW_COOKIE, { ...COOKIE_OPTIONS, path: GTM_CALLBACK_PATH });
        terminal = true;
        res.redirect(303, "/settings");
      } catch { res.redirect(303, "/settings"); }
      finally {
        if (!terminal) res.clearCookie(FLOW_COOKIE, { ...COOKIE_OPTIONS, path: GTM_CALLBACK_PATH });
      }
  });
  const operations: Record<string, keyof GtmRouteCore["read"]> = {
    "accounts/list": "listAccounts", "containers/list": "listContainers", "workspaces/list": "listWorkspaces",
    "workspaces/status": "getWorkspaceStatus", "tags/list": "listTags", "tags/get": "getTag",
    "triggers/list": "listTriggers", "triggers/get": "getTrigger", "variables/list": "listVariables",
    "variables/get": "getVariable", "container-version-headers/list": "listContainerVersionHeaders",
  };
  router.use(GTM_INTERNAL_PREFIX, (req, res, next) => {
    if (!bearer(req, d.getCallerToken())) { error(res, new Error("GTM_CALLER_REJECTED")); return; } next();
  });
  for (const [path, method] of Object.entries(operations)) router.post(`${GTM_INTERNAL_PREFIX}/${path}`, async (req, res) => {
    try { const input = req.body as GtmReadInput; const r = await (await d.loadCore()).read[method](input as never); res.json(r); } catch (e) { error(res, e); }
  });
  return router;
}
export function setupGtmRoutes(app: Express, d: GtmRouteDependencies) { app.use(createGtmRouter(d)); }
export function verifyGtmBrowserJwt(token: string, secret: string | undefined) {
  if (!secret) return null; try { const value = jwt.verify(token, secret, { algorithms: ["HS256"] }); return typeof value === "object" && value !== null ? value as { id?: unknown } : null; } catch { return null; }
}