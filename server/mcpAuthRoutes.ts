import {
  createHash,
  createHmac,
  hkdfSync,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cookieParser from "cookie-parser";
import {
  createMcpAuthCode,
  consumeMcpAuthCode,
  getMcpMembershipSnapshot,
  type McpMembershipSnapshot,
} from "./mcpAuthService";

const LOGIN_STATE_COOKIE = "twb_mcp_login_state";
const LOGIN_STATE_MAX_BYTES = 3000;
const AUTH_TOKEN_MAX_BYTES = 8192;
const INTERNAL_BODY_MAX_BYTES = 4096;
const STATE_MAC_INFO = "thinkwithblack-mcp/eccal-state-mac/v1";
const LOGIN_ERROR_TEXT = "登入流程已過期，請回到 ChatGPT 重新連線。";
const LOGIN_UNAVAILABLE_TEXT = "登入服務暫時無法使用，請稍後重新連線。";
const CLEAN_LOGIN_PATH = "/api/mcp/login";
const GOOGLE_LOGIN_PATH = "/api/auth/google?returnTo=%2Fapi%2Fmcp%2Flogin";
const CLOUDFLARE_CALLBACK =
  "https://mcp.thinkwithblack.com/oauth/eccal/callback";

const LOGIN_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/api/mcp",
});

type JwtIdentity = Readonly<{ id?: unknown }>;
type StoredUser = Readonly<{ id?: unknown }>;

export type McpAuthRouteDependencies = Readonly<{
  getServiceToken: () => string | undefined;
  verifyJwt: (
    token: string,
  ) => JwtIdentity | null | Promise<JwtIdentity | null>;
  getUser: (userId: string) => Promise<StoredUser | null>;
  createCode: (input: {
    userId: string;
    loginState: string;
  }) => Promise<{ code: string; expiresAt: Date }>;
  consumeCode: (input: {
    code: string;
    loginState: string;
    audience: string;
  }) => Promise<string | null>;
  getMembership: (userId: string) => Promise<McpMembershipSnapshot | null>;
  reportMembershipDiagnostic?: (
    diagnostic: MembershipReceiverDiagnostic,
  ) => void;
}>;

type InternalErrorCode =
  | "UNAUTHORIZED_CALLER"
  | "INVALID_REQUEST"
  | "LOGIN_CODE_INVALID"
  | "IDENTITY_EXCHANGE_UNAVAILABLE"
  | "MEMBERSHIP_UNAVAILABLE";

type MembershipReceiverDiagnosticCode =
  | "MCP_MEMBERSHIP_CALLER_REJECTED"
  | "MCP_MEMBERSHIP_REQUEST_INVALID"
  | "MCP_MEMBERSHIP_SNAPSHOT_UNAVAILABLE"
  | "MCP_MEMBERSHIP_SUCCESS";

export type MembershipReceiverDiagnostic = Readonly<{
  code: MembershipReceiverDiagnosticCode;
  retryable: boolean;
  correlation_id: string;
  version: "eccal-mcp-auth-v1";
  latency_ms: number;
  status: number;
}>;

function decodeCanonicalBase64url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : null;
}

function getServiceTokenBytes(value: string | undefined): Buffer | null {
  if (typeof value !== "string") {
    return null;
  }
  const decoded = decodeCanonicalBase64url(value);
  return decoded?.length === 32 ? decoded : null;
}

function fixedTimeCredentialMatches(
  authorization: string | undefined,
  expected: string | undefined,
): boolean {
  const match = /^(Bearer) ([^\s\u0000-\u001f\u007f]+)$/.exec(
    authorization ?? "",
  );
  const candidate = match?.[2] ?? "";
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256")
    .update(expected ?? "")
    .digest();
  const digestMatches = timingSafeEqual(candidateDigest, expectedDigest);
  return (
    digestMatches &&
    match?.[1] === "Bearer" &&
    getServiceTokenBytes(candidate) !== null &&
    getServiceTokenBytes(expected) !== null
  );
}

function validateLoginState(
  loginState: string,
  serviceToken: string | undefined,
): boolean {
  if (
    loginState.length === 0 ||
    Buffer.byteLength(loginState, "utf8") > LOGIN_STATE_MAX_BYTES
  ) {
    return false;
  }
  const segments = loginState.split(".");
  if (segments.length !== 4 || segments[0] !== "v1") {
    return false;
  }
  const iv = decodeCanonicalBase64url(segments[1]);
  const ciphertext = decodeCanonicalBase64url(segments[2]);
  const suppliedMac = decodeCanonicalBase64url(segments[3]);
  const serviceTokenBytes = getServiceTokenBytes(serviceToken);
  if (
    iv?.length !== 12 ||
    ciphertext === null ||
    ciphertext.length < 17 ||
    suppliedMac?.length !== 32 ||
    serviceTokenBytes === null
  ) {
    return false;
  }
  const macKey = Buffer.from(
    hkdfSync("sha256", serviceTokenBytes, Buffer.alloc(0), STATE_MAC_INFO, 32),
  );
  const signedBytes = segments.slice(0, 3).join(".");
  const expectedMac = createHmac("sha256", macKey)
    .update(signedBytes, "ascii")
    .digest();
  return timingSafeEqual(expectedMac, suppliedMac);
}

function isJwtShaped(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value, "utf8") <= AUTH_TOKEN_MAX_BYTES &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  );
}

function clearLoginStateCookie(res: Response): void {
  res.clearCookie(LOGIN_STATE_COOKIE, LOGIN_COOKIE_OPTIONS);
}

function internalError(
  res: Response,
  status: number,
  code: InternalErrorCode,
  retryable: boolean,
): void {
  res.status(status).json({ ok: false, error: { code, retryable } });
}

function authenticateInternalCaller(dependencies: McpAuthRouteDependencies) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      !fixedTimeCredentialMatches(
        req.get("authorization"),
        dependencies.getServiceToken(),
      )
    ) {
      internalError(res, 401, "UNAUTHORIZED_CALLER", false);
      return;
    }
    next();
  };
}

function requireExactJson(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.get("content-type")?.trim().toLowerCase() !== "application/json") {
    internalError(res, 400, "INVALID_REQUEST", false);
    return;
  }
  next();
}

const rawJsonBody = express.raw({
  type: () => true,
  limit: INTERNAL_BODY_MAX_BYTES,
});

function parseJsonObject(req: Request): Record<string, unknown> | null {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return null;
  }
  try {
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(req.body);
    const value: unknown = JSON.parse(text);
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

function classifyMembershipStatus(status: number): Readonly<{
  code: MembershipReceiverDiagnosticCode;
  retryable: boolean;
}> {
  if (status === 200) {
    return { code: "MCP_MEMBERSHIP_SUCCESS", retryable: false };
  }
  if (status === 401) {
    return { code: "MCP_MEMBERSHIP_CALLER_REJECTED", retryable: false };
  }
  if (status === 400) {
    return { code: "MCP_MEMBERSHIP_REQUEST_INVALID", retryable: false };
  }
  return { code: "MCP_MEMBERSHIP_SNAPSHOT_UNAVAILABLE", retryable: true };
}

function installMembershipReceiverDiagnostic(
  req: Request,
  res: Response,
  reporter: McpAuthRouteDependencies["reportMembershipDiagnostic"],
): void {
  if (
    reporter === undefined ||
    req.method !== "POST" ||
    req.path !== "/internal/membership"
  ) {
    return;
  }
  const startedAt = performance.now();
  const correlationId = randomUUID();
  res.once("finish", () => {
    const classification = classifyMembershipStatus(res.statusCode);
    const diagnostic = Object.freeze({
      ...classification,
      correlation_id: correlationId,
      version: "eccal-mcp-auth-v1" as const,
      latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      status: res.statusCode,
    });
    try {
      reporter(diagnostic);
    } catch {
      // Receiver diagnostics must never alter the HTTP response boundary.
    }
  });
}

export function createMcpAuthRouter(
  dependencies: McpAuthRouteDependencies,
): express.Router {
  const router = express.Router();
  router.use(cookieParser());
  router.use((req, res, next) => {
    installMembershipReceiverDiagnostic(
      req,
      res,
      dependencies.reportMembershipDiagnostic,
    );
    next();
  });

  router.get("/login", async (req, res) => {
    const queryKeys = Object.keys(req.query);
    if (queryKeys.length > 0) {
      if (
        queryKeys.length === 1 &&
        queryKeys[0] === "auth_success" &&
        req.query.auth_success === "1"
      ) {
        res.redirect(302, CLEAN_LOGIN_PATH);
        return;
      }
      const loginState = req.query.login_state;
      if (
        queryKeys.length !== 1 ||
        typeof loginState !== "string" ||
        !validateLoginState(loginState, dependencies.getServiceToken())
      ) {
        clearLoginStateCookie(res);
        res.status(400).send(LOGIN_ERROR_TEXT);
        return;
      }
      res.cookie(LOGIN_STATE_COOKIE, loginState, {
        ...LOGIN_COOKIE_OPTIONS,
        maxAge: 600_000,
      });
      res.redirect(302, CLEAN_LOGIN_PATH);
      return;
    }

    const loginState = req.cookies?.[LOGIN_STATE_COOKIE];
    if (
      typeof loginState !== "string" ||
      !validateLoginState(loginState, dependencies.getServiceToken())
    ) {
      clearLoginStateCookie(res);
      res.status(400).send(LOGIN_ERROR_TEXT);
      return;
    }

    const authToken = req.cookies?.auth_token;
    if (!isJwtShaped(authToken)) {
      res.redirect(302, GOOGLE_LOGIN_PATH);
      return;
    }

    try {
      const identity = await dependencies.verifyJwt(authToken);
      if (typeof identity?.id !== "string" || identity.id.length === 0) {
        res.redirect(302, GOOGLE_LOGIN_PATH);
        return;
      }
      const user = await dependencies.getUser(identity.id);
      if (user?.id !== identity.id) {
        res.redirect(302, GOOGLE_LOGIN_PATH);
        return;
      }
      const { code } = await dependencies.createCode({
        userId: identity.id,
        loginState,
      });
      const callback = new URL(CLOUDFLARE_CALLBACK);
      callback.searchParams.set("code", code);
      callback.searchParams.set("login_state", loginState);
      clearLoginStateCookie(res);
      res.redirect(302, callback.toString());
    } catch {
      clearLoginStateCookie(res);
      res.status(503).send(LOGIN_UNAVAILABLE_TEXT);
    }
  });

  const internalGuards = [
    authenticateInternalCaller(dependencies),
    requireExactJson,
    rawJsonBody,
  ] as const;

  router.post("/internal/exchange", ...internalGuards, async (req, res) => {
    const body = parseJsonObject(req);
    if (
      body === null ||
      !hasExactKeys(body, ["audience", "code", "login_state"]) ||
      typeof body.code !== "string" ||
      typeof body.login_state !== "string" ||
      typeof body.audience !== "string"
    ) {
      internalError(res, 400, "INVALID_REQUEST", false);
      return;
    }
    try {
      const userId = await dependencies.consumeCode({
        code: body.code,
        loginState: body.login_state,
        audience: body.audience,
      });
      if (userId === null) {
        internalError(res, 400, "LOGIN_CODE_INVALID", false);
        return;
      }
      res.status(200).json({ ok: true, user_id: userId });
    } catch {
      internalError(res, 503, "IDENTITY_EXCHANGE_UNAVAILABLE", true);
    }
  });

  router.post("/internal/membership", ...internalGuards, async (req, res) => {
    const body = parseJsonObject(req);
    if (
      body === null ||
      !hasExactKeys(body, ["user_id"]) ||
      typeof body.user_id !== "string" ||
      body.user_id.length === 0
    ) {
      internalError(res, 400, "INVALID_REQUEST", false);
      return;
    }
    try {
      const snapshot = await dependencies.getMembership(body.user_id);
      if (snapshot === null || snapshot.user_id !== body.user_id) {
        internalError(res, 503, "MEMBERSHIP_UNAVAILABLE", true);
        return;
      }
      res.status(200).json({
        ok: true,
        user_id: snapshot.user_id,
        membership: snapshot.membership,
        membership_expires: snapshot.membership_expires,
        credits: snapshot.credits,
        checked_at: snapshot.checked_at,
      });
    } catch {
      internalError(res, 503, "MEMBERSHIP_UNAVAILABLE", true);
    }
  });

  router.use(
    (error: unknown, req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/internal/")) {
        internalError(res, 400, "INVALID_REQUEST", false);
        return;
      }
      next(error);
    },
  );

  return router;
}

const defaultDependencies: McpAuthRouteDependencies = {
  getServiceToken: () => process.env.THINKWITHBLACK_MCP_SERVICE_TOKEN,
  verifyJwt: async (token) => {
    const { jwtUtils } = await import("./jwtAuth");
    return jwtUtils.verifyToken(token);
  },
  getUser: async (userId) => {
    const { storage } = await import("./storage");
    return (await storage.getUser(userId)) ?? null;
  },
  createCode: createMcpAuthCode,
  consumeCode: consumeMcpAuthCode,
  getMembership: getMcpMembershipSnapshot,
  reportMembershipDiagnostic: (diagnostic) => {
    process.stdout.write(
      `MCP_MEMBERSHIP_DIAGNOSTIC ${JSON.stringify(diagnostic)}\n`,
    );
  },
};

export function setupMcpAuthRoutes(app: Express): void {
  app.use("/api/mcp", createMcpAuthRouter(defaultDependencies));
}
