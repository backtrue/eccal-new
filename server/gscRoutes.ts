import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import cookieParser from "cookie-parser";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import jwt from "jsonwebtoken";
import {
  createGscCredentialService,
  GSC_CREDENTIAL_FORMAT_VERSION,
  GscCredentialServiceError,
  type GscCredentialService,
} from "./gscCredentialService";
import {
  createGscOAuthService,
  createGscUpstreamTransport,
  GSC_AUTHORIZATION_ENDPOINT,
  GSC_OPERATION_TIMEOUT_MS,
  GscOAuthError,
  type GscOAuthService,
  type GscOperationDeadline,
} from "./gscOAuth";
import {
  createGscQueryService,
  GscQueryError,
  type GscQueryService,
} from "./gscQueryService";
import {
  createGscRepository,
  GscRepositoryError,
  type GscConnectionState,
  type GscRepository,
} from "./gscRepository";

export const GSC_SETTINGS_PATH = "/settings";
export const GSC_BROWSER_STATUS_PATH = "/api/gsc/browser/status";
export const GSC_BROWSER_INTENT_PATH = "/api/gsc/browser/intent";
export const GSC_BROWSER_START_PATH = "/api/gsc/browser/start";
export const GSC_BROWSER_DISCONNECT_PATH = "/api/gsc/browser/disconnect";
export const GSC_CALLBACK_PATH = "/api/gsc/oauth/callback";
export const GSC_INTERNAL_PREFIX = "/api/gsc/internal";

const ECCAL_ORIGIN = "https://eccal.thinkwithblack.com";
const LOGIN_PATH = "/api/auth/google?returnTo=%2Fsettings";
const MANAGE_URL = `${ECCAL_ORIGIN}${GSC_SETTINGS_PATH}`;
const TICKET_COOKIE = "twb_gsc_ticket";
const FLOW_COOKIE = "twb_gsc_flow";
const NOTICE_COOKIE = "twb_gsc_notice";
const AUTH_TOKEN_MAX_BYTES = 8192;
const GSC_BODY_MAX_BYTES = "10mb";
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PENDING_TICKET_PATTERN = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;
const MAC_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const TICKET_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/api/gsc/browser",
});
const FLOW_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: GSC_CALLBACK_PATH,
});
const NOTICE_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/api/gsc/browser",
});

const BROWSER_MESSAGES = Object.freeze({
  unauthenticated: "請先登入，再繼續連接 Google Search Console。",
  invalidRequest: "這個連線要求無法使用，請重新整理頁面後再試一次。",
  wrongMember: "請切換回發起連線的會員帳號，或重新開始連線。",
  confirmationRequired: "請先確認要解除 Google Search Console 連線。",
  unavailable: "Google Search Console 目前無法使用，請稍後再試。",
  connected: "Google Search Console 已連接。",
  cancelled: "你已取消 Google Search Console 授權，連線沒有變更。",
  callbackFailed: "Google Search Console 連線失敗，請重新開始。",
  disconnectedConfirmed: "已解除連線，Google 授權也已撤銷。",
  disconnectedUnconfirmed:
    "ThinkWithBlack 的連線已解除，但尚未確認 Google 授權是否撤銷。請到 Google 帳號的權限管理頁檢查。",
  disconnectedLocal: "已解除 ThinkWithBlack 與 Google Search Console 的連線。",
});

type BrowserJwtIdentity = Readonly<{ id?: unknown }>;
type StoredUser = Readonly<{ id?: unknown }>;
type MembershipSnapshot = Readonly<{ user_id?: unknown }>;
type GscNotice = "connected" | "cancelled" | "callback_failed";

export type GscRouteCore = Readonly<{
  googleClientId: string;
  oauth: GscOAuthService;
  repository: GscRepository;
  credentialService: GscCredentialService;
  queryService: GscQueryService;
}>;

export type GscRouteDependencies = Readonly<{
  getCallerToken: () => string | undefined;
  verifyBrowserJwt: (
    token: string,
  ) => BrowserJwtIdentity | null | Promise<BrowserJwtIdentity | null>;
  getUser: (userId: string) => Promise<StoredUser | null | undefined>;
  getMembership: (
    userId: string,
  ) => Promise<MembershipSnapshot | null | undefined>;
  loadCore: () => Promise<GscRouteCore>;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}>;

type CapturedRequest = Readonly<{
  authToken?: string;
  authorization?: string;
  origin?: string;
  ticketCookie?: string;
  flowCookie?: string;
  noticeCookie?: string;
  settingsTicket?: string;
  settingsTicketValid: boolean;
  callbackQuery?: URLSearchParams;
}>;

type BrowserContext = Readonly<{
  userId: string;
  authToken: string;
}>;

class GscRouteFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly browserMessage: string,
  ) {
    super(code);
    this.name = "GscRouteFailure";
  }
}

function fail(
  status: number,
  code: string,
  browserMessage: string = BROWSER_MESSAGES.invalidRequest,
): never {
  throw new GscRouteFailure(status, code, browserMessage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function requiredString(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value
    : fail(400, "GSC_INVALID_REQUEST");
}

function requiredGeneration(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail(400, "GSC_INVALID_REQUEST");
}

function requiredObject(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value) || !exactKeys(value, expectedKeys)) {
    fail(400, "GSC_INVALID_REQUEST");
  }
  return value;
}

function fixedTimeEqual(left: string, right: string): boolean {
  const first = createHash("sha256").update(left, "utf8").digest();
  const second = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(first, second);
}

export function verifyGscBrowserJwt(
  token: string,
  secret: string | undefined,
): BrowserJwtIdentity | null {
  if (typeof secret !== "string" || secret.length === 0) return null;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    return isRecord(decoded) ? { id: decoded.id } : null;
  } catch {
    return null;
  }
}

function validCaller(
  authorization: string | undefined,
  expected: string | undefined,
): boolean {
  if (typeof expected !== "string" || expected.length < 32) return false;
  const match = /^Bearer ([^\s\u0000-\u001f\u007f]+)$/.exec(authorization ?? "");
  return match !== null && fixedTimeEqual(match[1], expected);
}

function deadlineFrom(value: unknown, nowMs: number): GscOperationDeadline {
  if (!isRecord(value) || !exactKeys(value, ["deadlineAtMs", "startedAtMs"])) {
    throw new GscOAuthError("GSC_OPERATION_TIMEOUT");
  }
  const startedAtMs = value.startedAtMs;
  const deadlineAtMs = value.deadlineAtMs;
  if (
    typeof startedAtMs !== "number" ||
    typeof deadlineAtMs !== "number" ||
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(deadlineAtMs) ||
    deadlineAtMs - startedAtMs !== GSC_OPERATION_TIMEOUT_MS ||
    startedAtMs > nowMs ||
    nowMs >= deadlineAtMs
  ) {
    throw new GscOAuthError("GSC_OPERATION_TIMEOUT");
  }
  return Object.freeze({ startedAtMs, deadlineAtMs });
}

function assertDeadline(deadline: GscOperationDeadline, nowMs: number): void {
  if (nowMs >= deadline.deadlineAtMs) {
    throw new GscOAuthError("GSC_OPERATION_TIMEOUT");
  }
}

async function withDeadline<T>(
  operation: () => Promise<T>,
  deadline: GscOperationDeadline,
  now: () => number,
  setTimer: (callback: () => void, delayMs: number) => unknown,
  clearTimer: (timer: unknown) => void,
): Promise<T> {
  const remainingMs = deadline.deadlineAtMs - now();
  if (remainingMs <= 0) {
    throw new GscOAuthError("GSC_OPERATION_TIMEOUT");
  }
  let rejectTimeout: ((error: GscOAuthError) => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimer(() => {
    rejectTimeout?.(new GscOAuthError("GSC_OPERATION_TIMEOUT"));
  }, remainingMs);
  try {
    const result = await Promise.race([operation(), timeout]);
    assertDeadline(deadline, now());
    return result;
  } finally {
    clearTimer(timer);
  }
}

function publicError(error: unknown): GscRouteFailure {
  if (error instanceof GscRouteFailure) return error;
  if (error instanceof GscOAuthError) {
    if (error.code === "GSC_OAUTH_CONFIGURATION") {
      return new GscRouteFailure(503, error.code, BROWSER_MESSAGES.unavailable);
    }
    if (error.code.includes("TIMEOUT")) {
      return new GscRouteFailure(504, error.code, BROWSER_MESSAGES.unavailable);
    }
    if (
      error.code === "GSC_OAUTH_REJECTED" ||
      error.code === "GSC_OAUTH_REAUTHORIZATION_REQUIRED"
    ) {
      return new GscRouteFailure(409, error.code, BROWSER_MESSAGES.wrongMember);
    }
    return new GscRouteFailure(502, error.code, BROWSER_MESSAGES.unavailable);
  }
  if (error instanceof GscQueryError) {
    if (error.code === "GSC_QUERY_INVALID_INPUT") {
      return new GscRouteFailure(400, error.code, BROWSER_MESSAGES.invalidRequest);
    }
    if (error.code === "GSC_QUERY_REJECTED") {
      return new GscRouteFailure(404, error.code, BROWSER_MESSAGES.wrongMember);
    }
    return new GscRouteFailure(502, error.code, BROWSER_MESSAGES.unavailable);
  }
  if (
    error instanceof GscRepositoryError ||
    error instanceof GscCredentialServiceError
  ) {
    return new GscRouteFailure(404, "GSC_CONNECTION_REJECTED", BROWSER_MESSAGES.wrongMember);
  }
  return new GscRouteFailure(503, "GSC_UNAVAILABLE", BROWSER_MESSAGES.unavailable);
}

function internalError(res: Response, error: unknown): void {
  const safe = publicError(error);
  res.status(safe.status).json({
    success: false,
    error: safe.code,
    retryable: safe.status >= 500,
  });
}

function browserError(res: Response, error: unknown): void {
  const safe = publicError(error);
  res.status(safe.status).json({
    success: false,
    error: safe.code,
    message: safe.browserMessage,
  });
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
  onError: (res: Response, error: unknown) => void,
): (req: Request, res: Response) => void {
  return (req, res) => {
    void handler(req, res).catch((error: unknown) => {
      if (!res.headersSent) onError(res, error);
    });
  };
}

function setTicketCookie(res: Response, ticket: string): void {
  res.cookie(TICKET_COOKIE, ticket, { ...TICKET_COOKIE_OPTIONS, maxAge: 600_000 });
}

function clearTicketCookie(res: Response): void {
  res.clearCookie(TICKET_COOKIE, TICKET_COOKIE_OPTIONS);
}

function clearFlowCookie(res: Response): void {
  res.clearCookie(FLOW_COOKIE, FLOW_COOKIE_OPTIONS);
}

function clearNoticeCookie(res: Response): void {
  res.clearCookie(NOTICE_COOKIE, NOTICE_COOKIE_OPTIONS);
}

function noticeMessage(notice: string | undefined): string | undefined {
  if (notice === "connected") return BROWSER_MESSAGES.connected;
  if (notice === "cancelled") return BROWSER_MESSAGES.cancelled;
  if (notice === "callback_failed") return BROWSER_MESSAGES.callbackFailed;
  return undefined;
}

function setNoticeCookie(res: Response, notice: GscNotice): void {
  res.cookie(NOTICE_COOKIE, notice, { ...NOTICE_COOKIE_OPTIONS, maxAge: 300_000 });
}

function finishCallback(res: Response, notice: GscNotice): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  clearFlowCookie(res);
  setNoticeCookie(res, notice);
  res.redirect(303, GSC_SETTINGS_PATH);
}

function createFlowCookie(
  credentialService: GscCredentialService,
  value: { userId: string; connectionId: string; generation: number },
): string {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const mac = credentialService.hashOpaqueProof(
    "browser_session",
    `gsc-flow-cookie:${payload}`,
  );
  return `${payload}.${mac}`;
}

function readFlowCookie(
  credentialService: GscCredentialService,
  value: string | undefined,
): Readonly<{ userId: string; connectionId: string; generation: number }> {
  if (typeof value !== "string" || value.length > 1024) {
    fail(409, "GSC_OAUTH_REJECTED", BROWSER_MESSAGES.wrongMember);
  }
  const parts = value.split(".");
  if (parts.length !== 2 || !MAC_PATTERN.test(parts[1])) {
    fail(409, "GSC_OAUTH_REJECTED", BROWSER_MESSAGES.wrongMember);
  }
  const expected = credentialService.hashOpaqueProof(
    "browser_session",
    `gsc-flow-cookie:${parts[0]}`,
  );
  if (!fixedTimeEqual(parts[1], expected)) {
    fail(409, "GSC_OAUTH_REJECTED", BROWSER_MESSAGES.wrongMember);
  }
  let decoded: unknown;
  try {
    const bytes = Buffer.from(parts[0], "base64url");
    if (bytes.toString("base64url") !== parts[0]) throw new Error("invalid");
    decoded = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(409, "GSC_OAUTH_REJECTED", BROWSER_MESSAGES.wrongMember);
  }
  const body = requiredObject(decoded, ["connectionId", "generation", "userId"]);
  return Object.freeze({
    userId: requiredString(body.userId),
    connectionId: requiredString(body.connectionId),
    generation: requiredGeneration(body.generation),
  });
}

function csrfProof(
  credentialService: GscCredentialService,
  authToken: string,
): string {
  return credentialService.hashOpaqueProof(
    "browser_session",
    `gsc-csrf:${authToken}`,
  );
}

function requireCsrf(
  req: Request,
  credentialService: GscCredentialService,
  authToken: string,
): void {
  const proof = req.get("x-gsc-csrf");
  if (
    typeof proof !== "string" ||
    !MAC_PATTERN.test(proof) ||
    !fixedTimeEqual(proof, csrfProof(credentialService, authToken))
  ) {
    fail(403, "GSC_CSRF_REJECTED");
  }
}

function requireSameOrigin(captured: CapturedRequest): void {
  if (captured.origin !== ECCAL_ORIGIN) {
    fail(403, "GSC_ORIGIN_REJECTED");
  }
}

function assertConnectionIdentity(
  value: GscConnectionState,
  expected: { userId: string; connectionId?: string; generation?: number },
): void {
  if (
    value.userId !== expected.userId ||
    (expected.connectionId !== undefined && value.connectionId !== expected.connectionId) ||
    (expected.generation !== undefined && value.generation !== expected.generation)
  ) {
    fail(404, "GSC_CONNECTION_REJECTED", BROWSER_MESSAGES.wrongMember);
  }
}

function assertResultIdentity(
  value: unknown,
  expected: { userId: string; connectionId: string; generation: number },
): void {
  if (
    !isRecord(value) ||
    value.userId !== expected.userId ||
    value.connectionId !== expected.connectionId ||
    value.generation !== expected.generation
  ) {
    fail(404, "GSC_CONNECTION_REJECTED", BROWSER_MESSAGES.wrongMember);
  }
}

function wrapTicket(
  credentialService: GscCredentialService,
  ticket: string,
  userId: string,
): string {
  if (!TICKET_PATTERN.test(ticket)) {
    fail(503, "GSC_UNAVAILABLE", BROWSER_MESSAGES.unavailable);
  }
  const ownerTag = credentialService.hashOpaqueProof(
    "browser_session",
    `gsc-ticket-owner:${userId}`,
  );
  const mac = credentialService.hashOpaqueProof(
    "browser_session",
    `gsc-ticket-binding:${ticket}.${ownerTag}`,
  );
  return `${ticket}.${ownerTag}.${mac}`;
}

function unwrapTicket(
  credentialService: GscCredentialService,
  wrapped: string,
  userId: string,
): string {
  if (!PENDING_TICKET_PATTERN.test(wrapped)) {
    fail(409, "GSC_OAUTH_REJECTED", BROWSER_MESSAGES.wrongMember);
  }
  const [ticket, ownerTag, mac] = wrapped.split(".");
  const expectedOwnerTag = credentialService.hashOpaqueProof(
    "browser_session",
    `gsc-ticket-owner:${userId}`,
  );
  const expectedMac = credentialService.hashOpaqueProof(
    "browser_session",
    `gsc-ticket-binding:${ticket}.${ownerTag}`,
  );
  if (!fixedTimeEqual(ownerTag, expectedOwnerTag) || !fixedTimeEqual(mac, expectedMac)) {
    fail(409, "GSC_OAUTH_REJECTED", BROWSER_MESSAGES.wrongMember);
  }
  return ticket;
}

function parseConnectionUrl(
  value: string,
  credentialService: GscCredentialService,
  userId: string,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(503, "GSC_UNAVAILABLE", BROWSER_MESSAGES.unavailable);
  }
  const keys = Array.from(url.searchParams.keys());
  if (
    url.origin !== ECCAL_ORIGIN ||
    url.pathname !== GSC_SETTINGS_PATH ||
    keys.length !== 1 ||
    keys[0] !== "gsc_ticket" ||
    !TICKET_PATTERN.test(url.searchParams.get("gsc_ticket") ?? "")
  ) {
    fail(503, "GSC_UNAVAILABLE", BROWSER_MESSAGES.unavailable);
  }
  url.searchParams.set(
    "gsc_ticket",
    wrapTicket(credentialService, url.searchParams.get("gsc_ticket") ?? "", userId),
  );
  return url.toString();
}

function capturedFor(
  captures: WeakMap<Request, CapturedRequest>,
  req: Request,
): CapturedRequest {
  return captures.get(req) ?? fail(400, "GSC_INVALID_REQUEST");
}

async function browserContext(
  dependencies: GscRouteDependencies,
  captured: CapturedRequest,
): Promise<BrowserContext> {
  const authToken = captured.authToken;
  if (
    typeof authToken !== "string" ||
    Buffer.byteLength(authToken, "utf8") > AUTH_TOKEN_MAX_BYTES ||
    !/^[^.\s]+\.[^.\s]+\.[^.\s]+$/.test(authToken)
  ) {
    fail(401, "GSC_BROWSER_UNAUTHENTICATED", BROWSER_MESSAGES.unauthenticated);
  }
  let identity: BrowserJwtIdentity | null;
  try {
    identity = await dependencies.verifyBrowserJwt(authToken);
  } catch {
    identity = null;
  }
  const userId = identity?.id;
  if (typeof userId !== "string" || userId.length === 0) {
    fail(401, "GSC_BROWSER_UNAUTHENTICATED", BROWSER_MESSAGES.unauthenticated);
  }
  let user: StoredUser | null | undefined;
  let membership: MembershipSnapshot | null | undefined;
  try {
    [user, membership] = await Promise.all([
      dependencies.getUser(userId),
      dependencies.getMembership(userId),
    ]);
  } catch {
    fail(503, "GSC_UNAVAILABLE", BROWSER_MESSAGES.unavailable);
  }
  if (user?.id !== userId || membership?.user_id !== userId) {
    fail(401, "GSC_BROWSER_UNAUTHENTICATED", BROWSER_MESSAGES.unauthenticated);
  }
  return Object.freeze({ userId, authToken });
}

async function internalMember(
  dependencies: GscRouteDependencies,
  userId: string,
): Promise<void> {
  const [user, membership] = await Promise.all([
    dependencies.getUser(userId),
    dependencies.getMembership(userId),
  ]);
  if (user?.id !== userId || membership?.user_id !== userId) {
    fail(404, "GSC_CONNECTION_REJECTED", BROWSER_MESSAGES.wrongMember);
  }
}

function browserStatusProjection(
  connection: GscConnectionState,
  checkedAt: string,
  csrf: string,
  displayEmail?: string,
  notice?: string,
) {
  return Object.freeze({
    status: connection.status,
    connectionId: connection.connectionId,
    generation: connection.generation,
    checkedAt,
    manageUrl: MANAGE_URL,
    ...(displayEmail === undefined ? {} : { displayEmail }),
    csrfProof: csrf,
    ...(notice === undefined ? {} : { notice }),
  });
}

function internalBody(
  req: Request,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(req.body)) fail(400, "GSC_INVALID_REQUEST");
  const allowed = [...requiredKeys, ...optionalKeys];
  if (
    !requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(req.body, key)) ||
    !Object.keys(req.body).every((key) => allowed.includes(key))
  ) {
    fail(400, "GSC_INVALID_REQUEST");
  }
  return req.body;
}

function baseInput(body: Record<string, unknown>) {
  return Object.freeze({
    userId: requiredString(body.userId),
    connectionId: requiredString(body.connectionId),
    generation: requiredGeneration(body.generation),
  });
}

function redactSensitiveRequest(
  captures: WeakMap<Request, CapturedRequest>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    let url: URL;
    try {
      url = new URL(req.originalUrl, ECCAL_ORIGIN);
    } catch {
      next();
      return;
    }
    const normalizedPath = url.pathname.toLowerCase();
    const isGscApi = normalizedPath === "/api/gsc" || normalizedPath.startsWith("/api/gsc/");
    const isSettingsPath = normalizedPath === GSC_SETTINGS_PATH ||
      normalizedPath === `${GSC_SETTINGS_PATH}/`;
    const hasSettingsTicket =
      isSettingsPath && url.searchParams.has("gsc_ticket");
    if (!isGscApi && !hasSettingsTicket) {
      next();
      return;
    }
    const cookies = isRecord(req.cookies) ? req.cookies : {};
    const ticketValues = url.searchParams.getAll("gsc_ticket");
    const settingsTicketValid =
      hasSettingsTicket &&
      Array.from(url.searchParams.keys()).length === 1 &&
      ticketValues.length === 1 &&
      PENDING_TICKET_PATTERN.test(ticketValues[0]);
    captures.set(req, Object.freeze({
      authToken: typeof cookies.auth_token === "string" ? cookies.auth_token : undefined,
      authorization: req.get("authorization"),
      origin: req.get("origin"),
      ticketCookie: typeof cookies[TICKET_COOKIE] === "string" ? cookies[TICKET_COOKIE] : undefined,
      flowCookie: typeof cookies[FLOW_COOKIE] === "string" ? cookies[FLOW_COOKIE] : undefined,
      noticeCookie: typeof cookies[NOTICE_COOKIE] === "string" ? cookies[NOTICE_COOKIE] : undefined,
      settingsTicket: settingsTicketValid ? ticketValues[0] : undefined,
      settingsTicketValid,
      callbackQuery: normalizedPath === GSC_CALLBACK_PATH ? url.searchParams : undefined,
    }));
    req.url = url.pathname;
    req.originalUrl = url.pathname;
    delete req.headers.cookie;
    delete req.headers.authorization;
    req.cookies = {};
    res.setHeader("Cache-Control", "no-store");
    if (normalizedPath === GSC_CALLBACK_PATH || hasSettingsTicket) {
      res.setHeader("Referrer-Policy", "no-referrer");
    }
    next();
  };
}

export function createGscRouter(
  dependencies: GscRouteDependencies,
): express.Router {
  const router = express.Router();
  const captures = new WeakMap<Request, CapturedRequest>();
  const now = dependencies.now ?? Date.now;
  const setTimer = dependencies.setTimer ??
    ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = dependencies.clearTimer ??
    ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));

  router.use(cookieParser());
  router.use(redactSensitiveRequest(captures));

  router.get(GSC_SETTINGS_PATH, (req, res, next) => {
    const captured = captures.get(req);
    if (captured === undefined) {
      next();
      return;
    }
    void (async () => {
      if (!captured.settingsTicketValid || captured.settingsTicket === undefined) {
        res.redirect(303, GSC_SETTINGS_PATH);
        return;
      }
      setTicketCookie(res, captured.settingsTicket);
      try {
        await browserContext(dependencies, captured);
        res.redirect(303, GSC_SETTINGS_PATH);
      } catch {
        res.redirect(303, LOGIN_PATH);
      }
    })().catch(() => res.redirect(303, GSC_SETTINGS_PATH));
  });

  const api = express.Router();
  api.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  api.use("/internal", (req, res, next) => {
    const captured = capturedFor(captures, req);
    if (!validCaller(captured.authorization, dependencies.getCallerToken())) {
      internalError(res, new GscRouteFailure(401, "GSC_CALLER_REJECTED", ""));
      return;
    }
    next();
  });
  api.use(express.json({ limit: GSC_BODY_MAX_BYTES, strict: true }));
  api.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (error === undefined) {
      next();
      return;
    }
    if (req.path.startsWith("/internal")) {
      internalError(res, new GscRouteFailure(400, "GSC_INVALID_REQUEST", ""));
    } else {
      browserError(res, new GscRouteFailure(400, "GSC_INVALID_REQUEST", BROWSER_MESSAGES.invalidRequest));
    }
  });

  api.get("/browser/status", asyncRoute(async (req, res) => {
    const captured = capturedFor(captures, req);
    const browser = await browserContext(dependencies, captured);
    const core = await dependencies.loadCore();
    const csrf = csrfProof(core.credentialService, browser.authToken);
    if (captured.ticketCookie !== undefined) {
      try {
        unwrapTicket(core.credentialService, captured.ticketCookie, browser.userId);
      } catch (error) {
        clearTicketCookie(res);
        throw error;
      }
      res.json(Object.freeze({
        pendingIntent: true,
        startPath: GSC_BROWSER_START_PATH,
        csrfProof: csrf,
      }));
      return;
    }
    const connection = await core.repository.ensureConnection({
      userId: browser.userId,
      googleClientId: core.googleClientId,
    });
    assertConnectionIdentity(connection, { userId: browser.userId });
    let displayEmail: string | undefined;
    if (connection.status === "active") {
      const active = await core.repository.getActiveCredential({
        userId: browser.userId,
        connectionId: connection.connectionId,
        generation: connection.generation,
      });
      assertConnectionIdentity(active, {
        userId: browser.userId,
        connectionId: connection.connectionId,
        generation: connection.generation,
      });
      const credential = core.credentialService.decryptCredentialEnvelope({
        userId: browser.userId,
        connectionId: active.connectionId,
        googleClientId: active.googleClientId,
        generation: active.generation,
        formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
      }, active.credentialEnvelope);
      const finalState = await core.repository.getConnectionState({
        userId: browser.userId,
        connectionId: active.connectionId,
        generation: active.generation,
        status: "active",
      });
      assertConnectionIdentity(finalState, {
        userId: browser.userId,
        connectionId: active.connectionId,
        generation: active.generation,
      });
      displayEmail = credential.displayEmail;
    }
    const notice = noticeMessage(captured.noticeCookie);
    clearNoticeCookie(res);
    res.json(browserStatusProjection(
      connection,
      new Date(now()).toISOString(),
      csrf,
      displayEmail,
      notice,
    ));
  }, browserError));

  api.post("/browser/intent", asyncRoute(async (req, res) => {
    const captured = capturedFor(captures, req);
    requireSameOrigin(captured);
    const browser = await browserContext(dependencies, captured);
    const body = internalBody(req, ["csrfProof"]);
    const core = await dependencies.loadCore();
    requireCsrf(req, core.credentialService, browser.authToken);
    if (body.csrfProof !== req.get("x-gsc-csrf")) {
      fail(403, "GSC_CSRF_REJECTED");
    }
    const result = await core.oauth.beginConnection({ userId: browser.userId });
    assertConnectionIdentity(result.connection, { userId: browser.userId });
    const connectionUrl = parseConnectionUrl(
      result.connectionUrl,
      core.credentialService,
      browser.userId,
    );
    const ticket = new URL(connectionUrl).searchParams.get("gsc_ticket") ?? "";
    setTicketCookie(res, ticket);
    res.status(201).json({
      connectionId: result.connection.connectionId,
      generation: result.connection.generation,
      expiresAt: result.expiresAt.toISOString(),
      startPath: GSC_BROWSER_START_PATH,
    });
  }, browserError));

  api.post("/browser/start", asyncRoute(async (req, res) => {
    const captured = capturedFor(captures, req);
    requireSameOrigin(captured);
    const browser = await browserContext(dependencies, captured);
    const body = internalBody(req, ["csrfProof"]);
    const core = await dependencies.loadCore();
    requireCsrf(req, core.credentialService, browser.authToken);
    if (body.csrfProof !== req.get("x-gsc-csrf")) {
      fail(403, "GSC_CSRF_REJECTED");
    }
    const ticket = captured.ticketCookie;
    if (typeof ticket !== "string") {
      fail(409, "GSC_OAUTH_REJECTED", BROWSER_MESSAGES.wrongMember);
    }
    const rawTicket = unwrapTicket(core.credentialService, ticket, browser.userId);
    const connection = await core.repository.ensureConnection({
      userId: browser.userId,
      googleClientId: core.googleClientId,
    });
    assertConnectionIdentity(connection, { userId: browser.userId });
    const result = await core.oauth.startAuthorization({
      userId: browser.userId,
      connectionId: connection.connectionId,
      generation: connection.generation,
      ticket: rawTicket,
      browserSessionProof: browser.authToken,
    });
    const authorizationUrl = new URL(result.authorizationUrl);
    if (
      authorizationUrl.origin + authorizationUrl.pathname !==
        GSC_AUTHORIZATION_ENDPOINT
    ) {
      fail(503, "GSC_UNAVAILABLE", BROWSER_MESSAGES.unavailable);
    }
    res.cookie(FLOW_COOKIE, createFlowCookie(core.credentialService, {
      userId: browser.userId,
      connectionId: connection.connectionId,
      generation: connection.generation,
    }), { ...FLOW_COOKIE_OPTIONS, maxAge: 600_000 });
    clearTicketCookie(res);
    res.json({ authorizationUrl: authorizationUrl.toString() });
  }, browserError));

  api.post("/browser/disconnect", asyncRoute(async (req, res) => {
    const captured = capturedFor(captures, req);
    requireSameOrigin(captured);
    const browser = await browserContext(dependencies, captured);
    const body = internalBody(req, ["confirmed", "connectionId", "csrfProof", "generation"]);
    const core = await dependencies.loadCore();
    requireCsrf(req, core.credentialService, browser.authToken);
    if (body.csrfProof !== req.get("x-gsc-csrf")) {
      fail(403, "GSC_CSRF_REJECTED");
    }
    if (body.confirmed !== true) {
      fail(400, "GSC_DISCONNECT_CONFIRMATION_REQUIRED", BROWSER_MESSAGES.confirmationRequired);
    }
    const connectionId = requiredString(body.connectionId);
    const generation = requiredGeneration(body.generation);
    const result = await core.oauth.disconnect({
      userId: browser.userId,
      connectionId,
      generation,
    });
    if (
      result.userId !== browser.userId ||
      result.connectionId !== connectionId ||
      result.generation !== generation + 1 ||
      result.localDisconnected !== true
    ) {
      fail(404, "GSC_CONNECTION_REJECTED", BROWSER_MESSAGES.wrongMember);
    }
    const message = result.googleRevocation === "confirmed"
      ? BROWSER_MESSAGES.disconnectedConfirmed
      : result.googleRevocation === "unconfirmed"
        ? BROWSER_MESSAGES.disconnectedUnconfirmed
        : BROWSER_MESSAGES.disconnectedLocal;
    res.json({
      status: "disconnected",
      connectionId,
      generation: result.generation,
      localDisconnected: true,
      googleRevocation: result.googleRevocation,
      message,
    });
  }, browserError));

  api.get("/oauth/callback", asyncRoute(async (req, res) => {
    const captured = capturedFor(captures, req);
    let notice: GscNotice = "callback_failed";
    try {
      const browser = await browserContext(dependencies, captured);
      const core = await dependencies.loadCore();
      const flow = readFlowCookie(core.credentialService, captured.flowCookie);
      if (flow.userId !== browser.userId) {
        fail(409, "GSC_OAUTH_REJECTED", BROWSER_MESSAGES.wrongMember);
      }
      const query = captured.callbackQuery ?? new URLSearchParams();
      const stateValues = query.getAll("state");
      const codeValues = query.getAll("code");
      const errorValues = query.getAll("error");
      if (stateValues.length !== 1 || stateValues[0].length === 0) {
        fail(400, "GSC_OAUTH_REJECTED");
      }
      if (codeValues.length === 1 && codeValues[0].length > 0 && errorValues.length === 0) {
        const result = await core.oauth.handleCallback({
          userId: browser.userId,
          connectionId: flow.connectionId,
          generation: flow.generation,
          state: stateValues[0],
          browserSessionProof: browser.authToken,
          code: codeValues[0],
        });
        assertConnectionIdentity(result.connection, {
          userId: browser.userId,
          connectionId: flow.connectionId,
          generation: flow.generation,
        });
        notice = "connected";
      } else if (
        errorValues.length === 1 &&
        errorValues[0].length > 0 &&
        codeValues.length === 0
      ) {
        await core.oauth.handleAuthorizationDenied({
          userId: browser.userId,
          connectionId: flow.connectionId,
          generation: flow.generation,
          state: stateValues[0],
          browserSessionProof: browser.authToken,
        });
        notice = errorValues[0] === "access_denied"
          ? "cancelled"
          : "callback_failed";
      } else {
        fail(400, "GSC_OAUTH_REJECTED");
      }
    } catch {
      notice = "callback_failed";
    }
    finishCallback(res, notice);
  }, (res) => finishCallback(res, "callback_failed")));

  function internalOperation(
    requiredKeys: readonly string[],
    operation: (
      body: Record<string, unknown>,
      core: GscRouteCore,
      deadline: GscOperationDeadline,
    ) => Promise<unknown>,
    optionalKeys: readonly string[] = [],
  ) {
    return asyncRoute(async (req, res) => {
      const body = internalBody(req, requiredKeys, optionalKeys);
      const userId = requiredString(body.userId);
      const deadline = deadlineFrom(body.deadline, now());
      const result = await withDeadline(async () => {
        await internalMember(dependencies, userId);
        assertDeadline(deadline, now());
        const core = await dependencies.loadCore();
        assertDeadline(deadline, now());
        const operationResult = await operation(body, core, deadline);
        assertDeadline(deadline, now());
        return operationResult;
      }, deadline, now, setTimer, clearTimer);
      res.json(result);
    }, internalError);
  }

  api.post("/internal/begin-connection", internalOperation(
    ["deadline", "userId"],
    async (body, core, deadline) => {
      const userId = requiredString(body.userId);
      const connection = await core.repository.ensureConnection({
        userId,
        googleClientId: core.googleClientId,
      });
      assertConnectionIdentity(connection, { userId });
      assertDeadline(deadline, now());
      const ticket = randomBytes(32).toString("base64url");
      const intent = await core.repository.beginConnectionIntent({
        userId,
        connectionId: connection.connectionId,
        generation: connection.generation,
        googleClientId: core.googleClientId,
        ticketHash: core.credentialService.hashOpaqueProof("ticket", ticket),
      });
      assertDeadline(deadline, now());
      if (
        intent.userId !== userId ||
        intent.connectionId !== connection.connectionId ||
        intent.expectedGeneration !== connection.generation
      ) {
        fail(404, "GSC_CONNECTION_REJECTED", BROWSER_MESSAGES.wrongMember);
      }
      const connectionUrl = new URL(`${ECCAL_ORIGIN}${GSC_SETTINGS_PATH}`);
      connectionUrl.searchParams.set("gsc_ticket", ticket);
      return Object.freeze({
        userId,
        connectionId: connection.connectionId,
        generation: connection.generation,
        connectionUrl: parseConnectionUrl(
          connectionUrl.toString(),
          core.credentialService,
          userId,
        ),
        expiresAt: intent.expiresAt.toISOString(),
      });
    },
  ));

  api.post("/internal/connection-status", internalOperation(
    ["deadline", "userId"],
    async (body, core, deadline) => {
      const userId = requiredString(body.userId);
      const connection = await core.repository.ensureConnection({
        userId,
        googleClientId: core.googleClientId,
      });
      assertConnectionIdentity(connection, { userId });
      assertDeadline(deadline, now());
      const current = await core.repository.getConnectionState({
        userId,
        connectionId: connection.connectionId,
        generation: connection.generation,
        status: connection.status,
      });
      assertConnectionIdentity(current, {
        userId,
        connectionId: connection.connectionId,
        generation: connection.generation,
      });
      return Object.freeze({
        userId,
        connectionId: current.connectionId,
        generation: current.generation,
        status: current.status,
        checkedAt: new Date(now()).toISOString(),
        manageUrl: MANAGE_URL,
      });
    },
  ));

  const queryBaseKeys = ["connectionId", "deadline", "generation", "userId"] as const;

  api.post("/internal/list-sites", internalOperation(
    queryBaseKeys,
    async (body, core, deadline) => {
      const input = { ...baseInput(body), deadline };
      const result = await core.queryService.listSites(input);
      assertResultIdentity(result, input);
      return result;
    },
  ));

  api.post("/internal/search-analytics", internalOperation(
    [...queryBaseKeys, "endDate", "siteUrl", "startDate"],
    async (body, core, deadline) => {
      const input = { ...body, ...baseInput(body), deadline } as Parameters<GscQueryService["searchAnalytics"]>[0];
      const result = await core.queryService.searchAnalytics(input);
      assertResultIdentity(result, input);
      return result;
    },
    ["dataState", "dimensions", "filters", "rowLimit", "searchType", "startRow"],
  ));

  api.post("/internal/compare-periods", internalOperation(
    [...queryBaseKeys, "periodA", "periodB", "siteUrl"],
    async (body, core, deadline) => {
      const input = { ...body, ...baseInput(body), deadline } as Parameters<GscQueryService["comparePeriods"]>[0];
      const result = await core.queryService.comparePeriods(input);
      assertResultIdentity(result, input);
      return result;
    },
    ["dataState", "dimensions", "filters", "rowLimit", "searchType", "startRow"],
  ));

  api.post("/internal/inspect-url", internalOperation(
    [...queryBaseKeys, "inspectionUrl", "siteUrl"],
    async (body, core, deadline) => {
      const input = { ...body, ...baseInput(body), deadline } as Parameters<GscQueryService["inspectUrl"]>[0];
      const result = await core.queryService.inspectUrl(input);
      assertResultIdentity(result, input);
      return result;
    },
  ));

  api.post("/internal/list-sitemaps", internalOperation(
    [...queryBaseKeys, "siteUrl"],
    async (body, core, deadline) => {
      const input = { ...body, ...baseInput(body), deadline } as Parameters<GscQueryService["listSitemaps"]>[0];
      const result = await core.queryService.listSitemaps(input);
      assertResultIdentity(result, input);
      return result;
    },
  ));

  api.use((req, res) => {
    if (req.path.startsWith("/internal")) {
      internalError(res, new GscRouteFailure(404, "GSC_ROUTE_NOT_FOUND", ""));
    } else {
      browserError(res, new GscRouteFailure(404, "GSC_ROUTE_NOT_FOUND", BROWSER_MESSAGES.invalidRequest));
    }
  });

  router.use("/api/gsc", api);
  return router;
}

function decodeCredentialKey(value: string | undefined): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new GscOAuthError("GSC_OAUTH_CONFIGURATION");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    throw new GscOAuthError("GSC_OAUTH_CONFIGURATION");
  }
  return decoded;
}

function configured(value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GscOAuthError("GSC_OAUTH_CONFIGURATION");
  }
  return value;
}

let defaultCorePromise: Promise<GscRouteCore> | undefined;

async function loadDefaultCore(): Promise<GscRouteCore> {
  if (defaultCorePromise !== undefined) return defaultCorePromise;
  defaultCorePromise = (async () => {
    const googleClientId = configured(process.env.GOOGLE_GSC_CLIENT_ID);
    const googleClientSecret = configured(process.env.GOOGLE_GSC_CLIENT_SECRET);
    const credentialKey = decodeCredentialKey(process.env.GSC_CREDENTIAL_KEY);
    const { pool } = await import("./db");
    const repository = createGscRepository(pool);
    const credentialService = createGscCredentialService({ credentialKey });
    const transport = createGscUpstreamTransport();
    const oauth = createGscOAuthService({
      googleClientId,
      googleClientSecret,
      repository,
      credentialService,
      transport,
    });
    const queryService = createGscQueryService({ oauth, repository, transport });
    return Object.freeze({
      googleClientId,
      oauth,
      repository,
      credentialService,
      queryService,
    });
  })().catch((error: unknown) => {
    defaultCorePromise = undefined;
    throw error;
  });
  return defaultCorePromise;
}

const defaultDependencies: GscRouteDependencies = Object.freeze({
  getCallerToken: () => process.env.THINKWITHBLACK_GSC_SERVICE_TOKEN,
  verifyBrowserJwt: (token: string) =>
    verifyGscBrowserJwt(token, process.env.JWT_SECRET),
  getUser: async (userId: string) => {
    const { storage } = await import("./storage");
    return storage.getUser(userId);
  },
  getMembership: async (userId: string) => {
    const { getMcpMembershipSnapshot } = await import("./mcpAuthService");
    return getMcpMembershipSnapshot(userId);
  },
  loadCore: loadDefaultCore,
});

export function setupGscRoutes(
  app: Express,
  dependencies: GscRouteDependencies = defaultDependencies,
): void {
  app.use(createGscRouter(dependencies));
}
