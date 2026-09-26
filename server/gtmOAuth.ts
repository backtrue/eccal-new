import {
  createHash,
  createPublicKey,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import {
  GTM_CREDENTIAL_FORMAT_VERSION,
  type GtmCredentialPlaintext,
  type GtmCredentialService,
} from "./gtmCredentialService";
import {
  GTM_OAUTH_REDIRECT_URI,
  type GtmActiveCredentialRecord,
  type GtmConnectionState,
  type GtmRepository,
} from "./gtmRepository";

export const GTM_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GTM_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GTM_REVOCATION_ENDPOINT = "https://oauth2.googleapis.com/revoke";
export const GTM_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
export const GTM_CONNECTION_URL =
  "https://eccal.thinkwithblack.com/api/gtm/browser/claim";
export const GTM_READONLY_SCOPE =
  "https://www.googleapis.com/auth/tagmanager.readonly";
export const GTM_OPERATION_TIMEOUT_MS = 45_000;
export const GTM_UPSTREAM_REQUEST_TIMEOUT_MS = 10_000;
export const GTM_UPSTREAM_MAX_BODY_BYTES = 1_048_576;

const GOOGLE_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

export type GtmOAuthErrorCode =
  | "GTM_OAUTH_CONFIGURATION"
  | "GTM_OAUTH_REJECTED"
  | "GTM_OAUTH_SCOPE_REJECTED"
  | "GTM_OAUTH_ID_TOKEN_REJECTED"
  | "GTM_OAUTH_REAUTHORIZATION_REQUIRED"
  | "GTM_OPERATION_TIMEOUT"
  | "GTM_UPSTREAM_TIMEOUT"
  | "GTM_UPSTREAM_REDIRECT"
  | "GTM_UPSTREAM_RESPONSE_TOO_LARGE"
  | "GTM_UPSTREAM_INVALID_RESPONSE"
  | "GTM_UPSTREAM_REJECTED";

const ERROR_MESSAGES: Readonly<Record<GtmOAuthErrorCode, string>> =
  Object.freeze({
    GTM_OAUTH_CONFIGURATION: "GTM OAuth is not configured",
    GTM_OAUTH_REJECTED: "GTM OAuth operation rejected",
    GTM_OAUTH_SCOPE_REJECTED: "Required GTM permission was not granted",
    GTM_OAUTH_ID_TOKEN_REJECTED: "Google identity verification failed",
    GTM_OAUTH_REAUTHORIZATION_REQUIRED: "GTM reauthorization is required",
    GTM_OPERATION_TIMEOUT: "GTM operation timed out",
    GTM_UPSTREAM_TIMEOUT: "Google request timed out",
    GTM_UPSTREAM_REDIRECT: "Unexpected Google redirect",
    GTM_UPSTREAM_RESPONSE_TOO_LARGE: "Google response was too large",
    GTM_UPSTREAM_INVALID_RESPONSE: "Google returned an invalid response",
    GTM_UPSTREAM_REJECTED: "Google rejected the request",
  });

export class GtmOAuthError extends Error {
  constructor(readonly code: GtmOAuthErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "GtmOAuthError";
  }
}

export type GtmOperationDeadline = Readonly<{
  startedAtMs: number;
  deadlineAtMs: number;
}>;

export function createGtmOperationDeadline(
  nowMs = Date.now(),
): GtmOperationDeadline {
  if (!Number.isFinite(nowMs)) {
    throw new GtmOAuthError("GTM_OPERATION_TIMEOUT");
  }
  return Object.freeze({
    startedAtMs: nowMs,
    deadlineAtMs: nowMs + GTM_OPERATION_TIMEOUT_MS,
  });
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type TimerImplementation = (
  callback: () => void,
  delayMs: number,
) => unknown;

export type GtmUpstreamTransport = Readonly<{
  request: (input: {
    url: string;
    method: "GET" | "POST";
    headers?: Readonly<Record<string, string>>;
    body?: string;
    responseType: "json" | "empty";
    deadline?: GtmOperationDeadline;
  }) => Promise<Readonly<{ status: number; body: unknown }>>;
}>;

export type GtmUpstreamTransportDependencies = Readonly<{
  fetch?: FetchImplementation;
  now?: () => number;
  setTimer?: TimerImplementation;
  clearTimer?: (timer: unknown) => void;
}>;

function fail(code: GtmOAuthErrorCode): never {
  throw new GtmOAuthError(code);
}

function requireString(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value
    : fail("GTM_OAUTH_REJECTED");
}

function requireGeneration(value: unknown): number {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ? value
    : fail("GTM_OAUTH_REJECTED");
}

function requireUpstreamString(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value
    : fail("GTM_UPSTREAM_INVALID_RESPONSE");
}

function requireUnexpiredClaim(expiresAt: unknown, nowMs: number): void {
  if (
    !(expiresAt instanceof Date) ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= nowMs
  ) {
    fail("GTM_OAUTH_REJECTED");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameOpaqueValue(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const first = Buffer.from(left, "utf8");
  const second = Buffer.from(right, "utf8");
  return first.length === second.length && timingSafeEqual(first, second);
}

function requireDeadline(
  value: GtmOperationDeadline,
  nowMs: number,
): GtmOperationDeadline {
  if (
    !Number.isFinite(value.startedAtMs) ||
    !Number.isFinite(value.deadlineAtMs) ||
    value.deadlineAtMs - value.startedAtMs !== GTM_OPERATION_TIMEOUT_MS ||
    value.startedAtMs > nowMs ||
    nowMs >= value.deadlineAtMs
  ) {
    fail("GTM_OPERATION_TIMEOUT");
  }
  return value;
}

function requireOptionalDeadline(
  value: GtmOperationDeadline | undefined,
  nowMs: number,
): void {
  if (value !== undefined) requireDeadline(value, nowMs);
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 0 ||
      parsed > GTM_UPSTREAM_MAX_BODY_BYTES
    ) {
      fail("GTM_UPSTREAM_RESPONSE_TOO_LARGE");
    }
  }
  if (response.body === null) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > GTM_UPSTREAM_MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        fail("GTM_UPSTREAM_RESPONSE_TOO_LARGE");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength === 0) {
    fail("GTM_UPSTREAM_INVALID_RESPONSE");
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    fail("GTM_UPSTREAM_INVALID_RESPONSE");
  }
}

export function createGtmUpstreamTransport(
  dependencies: GtmUpstreamTransportDependencies = {},
): GtmUpstreamTransport {
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? Date.now;
  const setTimer = dependencies.setTimer ??
    ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = dependencies.clearTimer ??
    ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  if (typeof fetchImplementation !== "function") {
    fail("GTM_OAUTH_CONFIGURATION");
  }

  async function request(
    input: Parameters<GtmUpstreamTransport["request"]>[0],
  ): Promise<Readonly<{ status: number; body: unknown }>> {
    const startedAt = now();
    const deadline = input.deadline === undefined
      ? undefined
      : requireDeadline(input.deadline, startedAt);
    const timeoutMs = deadline === undefined
      ? GTM_UPSTREAM_REQUEST_TIMEOUT_MS
      : Math.min(
        GTM_UPSTREAM_REQUEST_TIMEOUT_MS,
        deadline.deadlineAtMs - startedAt,
      );
    const timeoutCode: GtmOAuthErrorCode =
      deadline !== undefined && timeoutMs < GTM_UPSTREAM_REQUEST_TIMEOUT_MS
        ? "GTM_OPERATION_TIMEOUT"
        : "GTM_UPSTREAM_TIMEOUT";
    const controller = new AbortController();
    let timeoutReject: ((error: GtmOAuthError) => void) | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutReject = reject;
    });
    const timer = setTimer(() => {
      controller.abort();
      timeoutReject?.(new GtmOAuthError(timeoutCode));
    }, timeoutMs);
    const perform = async () => {
      const response = await fetchImplementation(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        fail("GTM_UPSTREAM_REDIRECT");
      }
      const bytes = await readBoundedBody(response);
      return Object.freeze({
        status: response.status,
        body: input.responseType === "json" ? parseJson(bytes) : undefined,
      });
    };
    try {
      return await Promise.race([perform(), timeout]);
    } catch (error) {
      if (error instanceof GtmOAuthError) throw error;
      fail(controller.signal.aborted
        ? timeoutCode
        : "GTM_UPSTREAM_INVALID_RESPONSE");
    } finally {
      clearTimer(timer);
    }
  }

  return Object.freeze({ request });
}

export type GtmOAuthServiceDependencies = Readonly<{
  googleClientId: string;
  googleClientSecret: string;
  repository: GtmRepository;
  credentialService: GtmCredentialService;
  transport: GtmUpstreamTransport;
  randomBytes?: (length: number) => Uint8Array;
  now?: () => number;
}>;

export type GtmOAuthService = Readonly<{
  beginConnection: (input: {
    userId: string;
  }) => Promise<Readonly<{
    connection: GtmConnectionState;
    connectionUrl: string;
    expiresAt: Date;
  }>>;
  startAuthorization: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    ticket: string;
    browserSessionProof: string;
  }) => Promise<Readonly<{ authorizationUrl: string }>>;
  handleCallback: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    state: string;
    browserSessionProof: string;
    code: string;
    deadline?: GtmOperationDeadline;
  }) => Promise<Readonly<{
    connection: GtmActiveCredentialRecord;
    displayEmail: string;
  }>>;
  handleAuthorizationDenied: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    state: string;
    browserSessionProof: string;
  }) => Promise<Readonly<{ cancelled: true }>>;
  refreshCredential: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    deadline?: GtmOperationDeadline;
  }) => Promise<Readonly<{
    connection: GtmActiveCredentialRecord;
    accessToken: string;
    grantedScopes: readonly string[];
  }>>;
  disconnect: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    deadline?: GtmOperationDeadline;
  }) => Promise<Readonly<{
    userId: string;
    connectionId: string;
    generation: number;
    localDisconnected: true;
    googleRevocation: "confirmed" | "unconfirmed" | "not_applicable";
  }>>;
}>;

function encodeRandom(
  randomBytes: (length: number) => Uint8Array,
  length: number,
): string {
  const bytes = Buffer.from(randomBytes(length));
  if (bytes.length !== length) fail("GTM_OAUTH_REJECTED");
  return bytes.toString("base64url");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function parseScopes(value: unknown): readonly string[] {
  if (typeof value !== "string") fail("GTM_OAUTH_SCOPE_REJECTED");
  const scopes = value.split(/\s+/).filter(Boolean);
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length) {
    fail("GTM_OAUTH_SCOPE_REJECTED");
  }
  if (
    !scopes.includes("openid") ||
    !scopes.includes(GTM_READONLY_SCOPE)
  ) {
    fail("GTM_OAUTH_SCOPE_REJECTED");
  }
  return Object.freeze(scopes);
}

function decodeBase64Url(value: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) {
    fail("GTM_OAUTH_ID_TOKEN_REJECTED");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) {
    fail("GTM_OAUTH_ID_TOKEN_REJECTED");
  }
  return decoded;
}

function parseJwtPart(value: string): Record<string, unknown> {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      decodeBase64Url(value),
    );
    const parsed: unknown = JSON.parse(decoded);
    return isRecord(parsed)
      ? parsed
      : fail("GTM_OAUTH_ID_TOKEN_REJECTED");
  } catch {
    fail("GTM_OAUTH_ID_TOKEN_REJECTED");
  }
}

function verifyGoogleIdToken(input: {
  token: string;
  jwks: unknown;
  googleClientId: string;
  expectedNonceHash: string;
  credentialService: GtmCredentialService;
  nowMs: number;
}): Readonly<{ googleSubject: string; displayEmail: string }> {
  try {
    const parts = input.token.split(".");
    if (parts.length !== 3) fail("GTM_OAUTH_ID_TOKEN_REJECTED");
    const header = parseJwtPart(parts[0]);
    const claims = parseJwtPart(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") {
      fail("GTM_OAUTH_ID_TOKEN_REJECTED");
    }
    if (!isRecord(input.jwks) || !Array.isArray(input.jwks.keys)) {
      fail("GTM_OAUTH_ID_TOKEN_REJECTED");
    }
    const jwk = input.jwks.keys.find((candidate) =>
      isRecord(candidate) &&
      candidate.kid === header.kid &&
      candidate.kty === "RSA" &&
      (candidate.use === undefined || candidate.use === "sig") &&
      (candidate.alg === undefined || candidate.alg === "RS256")
    );
    if (!isRecord(jwk)) fail("GTM_OAUTH_ID_TOKEN_REJECTED");
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const signatureValid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`, "ascii"),
      key,
      decodeBase64Url(parts[2]),
    );
    if (!signatureValid) fail("GTM_OAUTH_ID_TOKEN_REJECTED");
    if (
      typeof claims.iss !== "string" ||
      !GOOGLE_ISSUERS.has(claims.iss) ||
      claims.aud !== input.googleClientId ||
      typeof claims.exp !== "number" ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= Math.floor(input.nowMs / 1000) ||
      typeof claims.nonce !== "string" ||
      typeof claims.sub !== "string" ||
      claims.sub.length === 0
    ) {
      fail("GTM_OAUTH_ID_TOKEN_REJECTED");
    }
    const nonceHash = input.credentialService.hashOpaqueProof(
      "oidc_nonce",
      claims.nonce,
    );
    if (!sameOpaqueValue(nonceHash, input.expectedNonceHash)) {
      fail("GTM_OAUTH_ID_TOKEN_REJECTED");
    }
    return Object.freeze({
      googleSubject: claims.sub,
      displayEmail: typeof claims.email === "string" && claims.email.length > 0
        ? claims.email
        : "connected",
    });
  } catch (error) {
    if (error instanceof GtmOAuthError) throw error;
    fail("GTM_OAUTH_ID_TOKEN_REJECTED");
  }
}

function tokenResponseBody(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : fail("GTM_UPSTREAM_INVALID_RESPONSE");
}

function assertSuccessfulStatus(status: number): void {
  if (status < 200 || status >= 300) fail("GTM_UPSTREAM_REJECTED");
}

export function createGtmOAuthService(
  dependencies: GtmOAuthServiceDependencies,
): GtmOAuthService {
  const googleClientId = typeof dependencies.googleClientId === "string" &&
      dependencies.googleClientId.length > 0
    ? dependencies.googleClientId
    : fail("GTM_OAUTH_CONFIGURATION");
  const googleClientSecret =
    typeof dependencies.googleClientSecret === "string" &&
      dependencies.googleClientSecret.length > 0
      ? dependencies.googleClientSecret
      : fail("GTM_OAUTH_CONFIGURATION");
  const repository = dependencies.repository;
  const credentialService = dependencies.credentialService;
  const transport = dependencies.transport;
  const randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  const now = dependencies.now ?? Date.now;
  if (
    !repository ||
    !credentialService ||
    !transport ||
    typeof transport.request !== "function"
  ) {
    fail("GTM_OAUTH_CONFIGURATION");
  }

  function deadline(
    value?: GtmOperationDeadline,
  ): GtmOperationDeadline | undefined {
    return value === undefined ? undefined : requireDeadline(value, now());
  }

  async function beginConnection(input: { userId: string }) {
    const userId = requireString(input.userId);
    const connection = await repository.ensureConnection({
      userId,
      googleClientId,
    });
    const ticket = encodeRandom(randomBytes, 32);
    const intent = await repository.beginConnectionIntent({
      userId,
      connectionId: connection.connectionId,
      generation: connection.generation,
      googleClientId,
      ticketHash: credentialService.hashOpaqueProof("ticket", ticket),
    });
    const connectionUrl = new URL(GTM_CONNECTION_URL);
    connectionUrl.searchParams.set("gtm_ticket", ticket);
    return Object.freeze({
      connection,
      connectionUrl: connectionUrl.toString(),
      expiresAt: intent.expiresAt,
    });
  }

  async function startAuthorization(input: {
    userId: string;
    connectionId: string;
    generation: number;
    ticket: string;
    browserSessionProof: string;
  }) {
    const userId = requireString(input.userId);
    const connectionId = requireString(input.connectionId);
    const generation = requireGeneration(input.generation);
    const ticket = requireString(input.ticket);
    const browserSessionProof = requireString(input.browserSessionProof);
    const state = encodeRandom(randomBytes, 32);
    const nonce = encodeRandom(randomBytes, 32);
    const verifier = encodeRandom(randomBytes, 64);
    const stateHash = credentialService.hashOpaqueProof("state", state);
    const sessionProofHash = credentialService.hashOpaqueProof(
      "browser_session",
      browserSessionProof,
    );
    const encryptedPkceVerifier = credentialService.encryptPkceVerifier(
      {
        userId,
        connectionId,
        googleClientId,
        redirectUri: GTM_OAUTH_REDIRECT_URI,
        generation,
        browserSessionHash: sessionProofHash,
        stateHash,
        formatVersion: GTM_CREDENTIAL_FORMAT_VERSION,
      },
      verifier,
    );
    await repository.startOAuthFromIntent({
      userId,
      connectionId,
      generation,
      googleClientId,
      ticketHash: credentialService.hashOpaqueProof("ticket", ticket),
      stateHash,
      sessionProofHash,
      oidcNonceHash: credentialService.hashOpaqueProof("oidc_nonce", nonce),
      encryptedPkceVerifier,
    });
    const authorizationUrl = new URL(GTM_AUTHORIZATION_ENDPOINT);
    authorizationUrl.searchParams.set("client_id", googleClientId);
    authorizationUrl.searchParams.set("redirect_uri", GTM_OAUTH_REDIRECT_URI);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set(
      "scope",
      `openid ${GTM_READONLY_SCOPE}`,
    );
    authorizationUrl.searchParams.set("access_type", "offline");
    authorizationUrl.searchParams.set("prompt", "consent");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("code_challenge", pkceChallenge(verifier));
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    return Object.freeze({ authorizationUrl: authorizationUrl.toString() });
  }

  async function handleCallback(input: {
    userId: string;
    connectionId: string;
    generation: number;
    state: string;
    browserSessionProof: string;
    code: string;
    deadline?: GtmOperationDeadline;
  }) {
    const operationDeadline = deadline(input.deadline);
    const userId = requireString(input.userId);
    const connectionId = requireString(input.connectionId);
    const generation = requireGeneration(input.generation);
    const code = requireString(input.code);
    const stateHash = credentialService.hashOpaqueProof(
      "state",
      requireString(input.state),
    );
    const sessionProofHash = credentialService.hashOpaqueProof(
      "browser_session",
      requireString(input.browserSessionProof),
    );
    const claimed = await repository.acquireOAuthProcessing({
      userId,
      connectionId,
      generation,
      googleClientId,
      stateHash,
      sessionProofHash,
    });
    if (
      claimed.userId !== userId ||
      claimed.connectionId !== connectionId ||
      claimed.expectedGeneration !== generation ||
      claimed.googleClientId !== googleClientId ||
      claimed.redirectUri !== GTM_OAUTH_REDIRECT_URI ||
      !sameOpaqueValue(claimed.stateHash, stateHash) ||
      !sameOpaqueValue(claimed.sessionProofHash, sessionProofHash)
    ) {
      fail("GTM_OAUTH_REJECTED");
    }
    requireUnexpiredClaim(claimed.expiresAt, now());
    const verifier = credentialService.decryptPkceVerifier(
      {
        userId,
        connectionId,
        googleClientId,
        redirectUri: GTM_OAUTH_REDIRECT_URI,
        generation,
        browserSessionHash: sessionProofHash,
        stateHash,
        formatVersion: GTM_CREDENTIAL_FORMAT_VERSION,
      },
      claimed.encryptedPkceVerifier,
    );
    requireOptionalDeadline(operationDeadline, now());
    const tokenResponse = await transport.request({
      url: GTM_TOKEN_ENDPOINT,
      method: "POST",
      headers: { "content-type": FORM_CONTENT_TYPE },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: GTM_OAUTH_REDIRECT_URI,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }).toString(),
      responseType: "json",
      deadline: operationDeadline,
    });
    assertSuccessfulStatus(tokenResponse.status);
    const tokenBody = tokenResponseBody(tokenResponse.body);
    const refreshToken = requireUpstreamString(tokenBody.refresh_token);
    requireUpstreamString(tokenBody.access_token);
    const grantedScopes = parseScopes(tokenBody.scope);
    const idToken = requireUpstreamString(tokenBody.id_token);
    requireOptionalDeadline(operationDeadline, now());
    const jwksResponse = await transport.request({
      url: GTM_JWKS_ENDPOINT,
      method: "GET",
      responseType: "json",
      deadline: operationDeadline,
    });
    assertSuccessfulStatus(jwksResponse.status);
    const identity = verifyGoogleIdToken({
      token: idToken,
      jwks: jwksResponse.body,
      googleClientId,
      expectedNonceHash: claimed.oidcNonceHash,
      credentialService,
      nowMs: now(),
    });
    const credential: GtmCredentialPlaintext = Object.freeze({
      refreshToken,
      googleSubject: identity.googleSubject,
      displayEmail: identity.displayEmail,
      grantedScopes,
    });
    const credentialEnvelope = credentialService.encryptCredentialEnvelope(
      {
        userId,
        connectionId,
        googleClientId,
        generation,
        formatVersion: GTM_CREDENTIAL_FORMAT_VERSION,
      },
      credential,
    );
    requireOptionalDeadline(operationDeadline, now());
    const connection = await repository.completeOAuthBinding({
      userId,
      connectionId,
      generation,
      flowId: claimed.flowId,
      googleClientId,
      googleSubjectHash: credentialService.hashGoogleSubject(
        googleClientId,
        identity.googleSubject,
      ),
      credentialEnvelope,
    });
    requireOptionalDeadline(operationDeadline, now());
    return Object.freeze({ connection, displayEmail: identity.displayEmail });
  }

  async function handleAuthorizationDenied(input: {
    userId: string;
    connectionId: string;
    generation: number;
    state: string;
    browserSessionProof: string;
  }) {
    const userId = requireString(input.userId);
    const connectionId = requireString(input.connectionId);
    const generation = requireGeneration(input.generation);
    const stateHash = credentialService.hashOpaqueProof(
      "state",
      requireString(input.state),
    );
    const sessionProofHash = credentialService.hashOpaqueProof(
      "browser_session",
      requireString(input.browserSessionProof),
    );
    const claimed = await repository.acquireOAuthProcessing({
      userId,
      connectionId,
      generation,
      googleClientId,
      stateHash,
      sessionProofHash,
    });
    if (
      claimed.userId !== userId ||
      claimed.connectionId !== connectionId ||
      claimed.expectedGeneration !== generation ||
      claimed.googleClientId !== googleClientId ||
      claimed.redirectUri !== GTM_OAUTH_REDIRECT_URI ||
      !sameOpaqueValue(claimed.stateHash, stateHash) ||
      !sameOpaqueValue(claimed.sessionProofHash, sessionProofHash)
    ) {
      fail("GTM_OAUTH_REJECTED");
    }
    requireUnexpiredClaim(claimed.expiresAt, now());
    await repository.cancelOAuthFlow({
      userId,
      connectionId,
      generation,
      flowId: claimed.flowId,
    });
    return Object.freeze({ cancelled: true as const });
  }

  async function refreshCredential(input: {
    userId: string;
    connectionId: string;
    generation: number;
    deadline?: GtmOperationDeadline;
  }) {
    const operationDeadline = deadline(input.deadline);
    const userId = requireString(input.userId);
    const connectionId = requireString(input.connectionId);
    const generation = requireGeneration(input.generation);
    let refreshFailure: GtmOAuthError | undefined;
    try {
      const result = await repository.withRefreshLock(
        { userId, connectionId, generation },
        async (session) => {
          try {
            requireOptionalDeadline(operationDeadline, now());
            const credential = credentialService.decryptCredentialEnvelope(
              {
                userId,
                connectionId,
                googleClientId,
                generation,
                formatVersion: GTM_CREDENTIAL_FORMAT_VERSION,
              },
              session.connection.credentialEnvelope,
            );
            const response = await transport.request({
              url: GTM_TOKEN_ENDPOINT,
              method: "POST",
              headers: { "content-type": FORM_CONTENT_TYPE },
              body: new URLSearchParams({
                client_id: googleClientId,
                client_secret: googleClientSecret,
                refresh_token: credential.refreshToken,
                grant_type: "refresh_token",
              }).toString(),
              responseType: "json",
              deadline: operationDeadline,
            });
            const body = tokenResponseBody(response.body);
            if (response.status < 200 || response.status >= 300) {
              if (body.error === "invalid_grant") {
                await session.markReauthorizationRequired();
                fail("GTM_OAUTH_REAUTHORIZATION_REQUIRED");
              }
              fail("GTM_UPSTREAM_REJECTED");
            }
            const accessToken = requireUpstreamString(body.access_token);
            let grantedScopes = credential.grantedScopes;
            if (body.scope !== undefined) {
              try {
                grantedScopes = parseScopes(body.scope);
              } catch {
                await session.markReauthorizationRequired();
                fail("GTM_OAUTH_REAUTHORIZATION_REQUIRED");
              }
            } else {
              try {
                parseScopes(credential.grantedScopes.join(" "));
              } catch {
                await session.markReauthorizationRequired();
                fail("GTM_OAUTH_REAUTHORIZATION_REQUIRED");
              }
            }
            const refreshToken = body.refresh_token === undefined
              ? credential.refreshToken
              : requireUpstreamString(body.refresh_token);
            const credentialEnvelope =
              credentialService.encryptCredentialEnvelope(
                {
                  userId,
                  connectionId,
                  googleClientId,
                  generation,
                  formatVersion: GTM_CREDENTIAL_FORMAT_VERSION,
                },
                {
                  ...credential,
                  refreshToken,
                  grantedScopes,
                },
              );
            requireOptionalDeadline(operationDeadline, now());
            const connection = await session.replaceCredentialEnvelope(
              credentialEnvelope,
            );
            return Object.freeze({
              connection,
              accessToken,
              grantedScopes,
            });
          } catch (error) {
            refreshFailure = error instanceof GtmOAuthError
              ? error
              : new GtmOAuthError("GTM_OAUTH_REJECTED");
            throw error;
          }
        },
      );
      requireOptionalDeadline(operationDeadline, now());
      return result;
    } catch (error) {
      if (refreshFailure !== undefined) {
        throw refreshFailure;
      }
      if (error instanceof GtmOAuthError) {
        throw error;
      }
      fail("GTM_OAUTH_REJECTED");
    }
  }

  async function disconnect(input: {
    userId: string;
    connectionId: string;
    generation: number;
    deadline?: GtmOperationDeadline;
  }) {
    const operationDeadline = deadline(input.deadline);
    const userId = requireString(input.userId);
    const connectionId = requireString(input.connectionId);
    const generation = requireGeneration(input.generation);
    const disconnected = await repository.disconnectConnection({
      userId,
      connectionId,
      generation,
    });
    let googleRevocation: "confirmed" | "unconfirmed" | "not_applicable" =
      "not_applicable";
    if (disconnected.credentialEnvelope !== null) {
      googleRevocation = "unconfirmed";
      try {
        const credential = credentialService.decryptCredentialEnvelope(
          {
            userId,
            connectionId,
            googleClientId,
            generation: disconnected.previousGeneration,
            formatVersion: GTM_CREDENTIAL_FORMAT_VERSION,
          },
          disconnected.credentialEnvelope,
        );
        requireOptionalDeadline(operationDeadline, now());
        const response = await transport.request({
          url: GTM_REVOCATION_ENDPOINT,
          method: "POST",
          headers: { "content-type": FORM_CONTENT_TYPE },
          body: new URLSearchParams({ token: credential.refreshToken }).toString(),
          responseType: "empty",
          deadline: operationDeadline,
        });
        googleRevocation = response.status >= 200 && response.status < 300
          ? "confirmed"
          : "unconfirmed";
      } catch {
        googleRevocation = "unconfirmed";
      }
    }
    return Object.freeze({
      userId,
      connectionId,
      generation: disconnected.generation,
      localDisconnected: true as const,
      googleRevocation,
    });
  }

  return Object.freeze({
    beginConnection,
    startAuthorization,
    handleCallback,
    handleAuthorizationDenied,
    refreshCredential,
    disconnect,
  });
}
