import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express, { type Express } from "express";
import jwt from "jsonwebtoken";
import {
  createGscCredentialService,
  GSC_CREDENTIAL_FORMAT_VERSION,
} from "./gscCredentialService";
import { GscOAuthError, GSC_OPERATION_TIMEOUT_MS } from "./gscOAuth";
import type { GscQueryService } from "./gscQueryService";
import type {
  GscActiveCredentialRecord,
  GscConnectionState,
  GscRepository,
} from "./gscRepository";
import {
  createGscRouter,
  GSC_BROWSER_DISCONNECT_PATH,
  GSC_BROWSER_INTENT_PATH,
  GSC_BROWSER_START_PATH,
  GSC_BROWSER_STATUS_PATH,
  type GscRouteCore,
  type GscRouteDependencies,
  verifyGscBrowserJwt,
} from "./gscRoutes";

const ORIGIN = "https://eccal.thinkwithblack.com";
const CALLER = "caller-token-that-is-at-least-thirty-two-bytes-long";
const AUTH_A = "header.member-a.signature";
const AUTH_B = "header.member-b.signature";
const TICKET_A = "a".repeat(43);
const TICKET_B = "b".repeat(43);
const GOOGLE_CLIENT_ID = "synthetic-google-client-id";
const CONNECTION_A = "connection-a";
const CONNECTION_B = "connection-b";

type HarnessOptions = Readonly<{
  loadCore?: () => Promise<GscRouteCore>;
  getUser?: GscRouteDependencies["getUser"];
  getMembership?: GscRouteDependencies["getMembership"];
  now?: () => number;
  setTimer?: GscRouteDependencies["setTimer"];
  clearTimer?: GscRouteDependencies["clearTimer"];
  verifyBrowserJwt?: GscRouteDependencies["verifyBrowserJwt"];
  reportGscDiagnostic?: GscRouteDependencies["reportGscDiagnostic"];
}>;

function connection(userId: string, status: GscConnectionState["status"] = "disconnected"):
GscConnectionState {
  return Object.freeze({
    userId,
    connectionId: userId === "member-a" ? CONNECTION_A : CONNECTION_B,
    googleClientId: GOOGLE_CLIENT_ID,
    status,
    generation: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function cookieFrom(response: globalThis.Response, name: string): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`(?:^|,\\s*)${name}=([^;]*)`).exec(header);
  assert.ok(match, `missing ${name} cookie in ${header}`);
  return `${name}=${match[1]}`;
}

function safeJson(response: globalThis.Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

function wrappedTicket(
  credentialService: ReturnType<typeof createGscCredentialService>,
  ticket: string,
  userId: string,
): string {
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

async function listen(app: Express): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server: Server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

function makeHarness(options: HarnessOptions = {}) {
  const credentialService = createGscCredentialService({
    credentialKey: Buffer.alloc(32, 23),
  });
  const connections = new Map<string, GscConnectionState>([
    ["member-a", connection("member-a")],
    ["member-b", connection("member-b")],
  ]);
  const ticketOwners = new Map([[TICKET_A, "member-a"], [TICKET_B, "member-b"]]);
  const calls = {
    begin: [] as Array<Record<string, unknown>>,
    beginIntent: [] as Array<Record<string, unknown>>,
    start: [] as Array<Record<string, unknown>>,
    callback: [] as Array<Record<string, unknown>>,
    denied: [] as Array<Record<string, unknown>>,
    disconnect: [] as Array<Record<string, unknown>>,
    query: [] as Array<Record<string, unknown>>,
    loadCore: 0,
  };
  const handledStates = new Set<string>();
  const repository = {
    ensureConnection: async ({ userId }: { userId: string }) => {
      const value = connections.get(userId);
      if (!value) throw new Error("unknown synthetic member");
      return value;
    },
    getConnectionState: async (input: {
      userId: string;
      connectionId: string;
      generation: number;
      status: GscConnectionState["status"];
    }) => {
      const value = connections.get(input.userId);
      if (
        !value || value.connectionId !== input.connectionId ||
        value.generation !== input.generation || value.status !== input.status
      ) throw new Error("stale synthetic state");
      return value;
    },
    getActiveCredential: async (input: {
      userId: string;
      connectionId: string;
      generation: number;
    }) => {
      const value = connections.get(input.userId);
      if (!value || value.status !== "active") throw new Error("not active");
      const credentialEnvelope = credentialService.encryptCredentialEnvelope({
        userId: input.userId,
        connectionId: input.connectionId,
        googleClientId: GOOGLE_CLIENT_ID,
        generation: input.generation,
        formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
      }, {
        refreshToken: `refresh-${input.userId}`,
        googleSubject: `subject-${input.userId}`,
        displayEmail: `${input.userId}@example.invalid`,
        grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"],
      });
      return Object.freeze({
        ...value,
        status: "active" as const,
        googleSubjectHash: "opaque-subject-hash",
        credentialEnvelope,
      }) as GscActiveCredentialRecord;
    },
    beginConnectionIntent: async (input: Record<string, unknown>) => {
      calls.beginIntent.push(input);
      return Object.freeze({
        flowId: "flow-id",
        userId: String(input.userId),
        connectionId: String(input.connectionId),
        expectedGeneration: Number(input.generation),
        ticketHash: String(input.ticketHash),
        expiresAt: new Date("2026-01-01T00:10:00.000Z"),
      });
    },
  } as unknown as GscRepository;
  const oauth = {
    beginConnection: async (input: { userId: string }) => {
      calls.begin.push(input);
      const ownConnection = connections.get(input.userId)!;
      const ticket = input.userId === "member-a" ? TICKET_A : TICKET_B;
      return Object.freeze({
        connection: ownConnection,
        connectionUrl: `${ORIGIN}/settings?gsc_ticket=${ticket}`,
        expiresAt: new Date("2026-01-01T00:10:00.000Z"),
      });
    },
    startAuthorization: async (input: Record<string, unknown>) => {
      calls.start.push(input);
      if (ticketOwners.get(String(input.ticket)) !== input.userId) {
        throw new GscOAuthError("GSC_OAUTH_REJECTED");
      }
      return Object.freeze({
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque-state",
      });
    },
    handleCallback: async (input: Record<string, unknown>) => {
      const state = String(input.state);
      if (handledStates.has(state)) throw new GscOAuthError("GSC_OAUTH_REJECTED");
      handledStates.add(state);
      calls.callback.push(input);
      const active = connection(String(input.userId), "active") as GscActiveCredentialRecord;
      return Object.freeze({ connection: active, displayEmail: "member-a@example.invalid" });
    },
    handleAuthorizationDenied: async (input: Record<string, unknown>) => {
      const state = String(input.state);
      if (handledStates.has(state)) throw new GscOAuthError("GSC_OAUTH_REJECTED");
      handledStates.add(state);
      calls.denied.push(input);
      return Object.freeze({ cancelled: true as const });
    },
    disconnect: async (input: Record<string, unknown>) => {
      calls.disconnect.push(input);
      return Object.freeze({
        userId: String(input.userId),
        connectionId: String(input.connectionId),
        generation: Number(input.generation) + 1,
        localDisconnected: true as const,
        googleRevocation: "unconfirmed" as const,
      });
    },
  } as unknown as GscRouteCore["oauth"];
  const queryResult = (input: Record<string, unknown>, extra: Record<string, unknown>) =>
    Object.freeze({
      userId: String(input.userId),
      connectionId: String(input.connectionId),
      generation: Number(input.generation),
      ...extra,
    });
  const queryService = {
    listSites: async (input: Record<string, unknown>) => {
      calls.query.push(input);
      return queryResult(input, { sites: [], checkedAt: "2026-01-01T00:00:00.000Z" });
    },
    searchAnalytics: async (input: Record<string, unknown>) => {
      calls.query.push(input);
      return queryResult(input, { rows: [] });
    },
    comparePeriods: async (input: Record<string, unknown>) => {
      calls.query.push(input);
      return queryResult(input, { rows: [] });
    },
    inspectUrl: async (input: Record<string, unknown>) => {
      calls.query.push(input);
      return queryResult(input, { inspectionResult: {} });
    },
    listSitemaps: async (input: Record<string, unknown>) => {
      calls.query.push(input);
      return queryResult(input, { sitemaps: [] });
    },
  } as unknown as GscQueryService;
  const core: GscRouteCore = Object.freeze({
    googleClientId: GOOGLE_CLIENT_ID,
    oauth,
    repository,
    credentialService,
    queryService,
  });
  const dependencies: GscRouteDependencies = Object.freeze({
    getCallerToken: () => CALLER,
    verifyBrowserJwt: options.verifyBrowserJwt ?? (async (token) => token === AUTH_A
      ? { id: "member-a" }
      : token === AUTH_B ? { id: "member-b" } : null),
    getUser: options.getUser ?? (async (userId) => ({ id: userId })),
    getMembership: options.getMembership ?? (async (userId) => ({ user_id: userId })),
    loadCore: options.loadCore ?? (async () => {
      calls.loadCore += 1;
      return core;
    }),
    now: options.now ?? (() => Date.parse("2026-01-01T00:00:00.000Z")),
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
    reportGscDiagnostic: options.reportGscDiagnostic,
  });
  const app = express();
  app.use(createGscRouter(dependencies));
  return { app, calls, connections, core, credentialService };
}

function browserHeaders(token: string = AUTH_A): Record<string, string> {
  return { cookie: `auth_token=${token}`, origin: ORIGIN };
}

async function csrf(baseUrl: string, token: string = AUTH_A): Promise<string> {
  const response = await fetch(`${baseUrl}${GSC_BROWSER_STATUS_PATH}`, {
    headers: { cookie: `auth_token=${token}` },
  });
  assert.equal(response.status, 200);
  return String((await safeJson(response)).csrfProof);
}

async function startFlow(
  baseUrl: string,
  token = AUTH_A,
  pendingTicket?: string,
) {
  const proof = await csrf(baseUrl, token);
  let ticketCookie = pendingTicket === undefined ? undefined : `twb_gsc_ticket=${pendingTicket}`;
  if (ticketCookie === undefined) {
    const intent = await fetch(`${baseUrl}${GSC_BROWSER_INTENT_PATH}`, {
      method: "POST",
      headers: {
        ...browserHeaders(token),
        "content-type": "application/json",
        "x-gsc-csrf": proof,
      },
      body: JSON.stringify({ csrfProof: proof }),
    });
    assert.equal(intent.status, 201);
    ticketCookie = cookieFrom(intent, "twb_gsc_ticket");
  }
  const response = await fetch(`${baseUrl}${GSC_BROWSER_START_PATH}`, {
    method: "POST",
    headers: {
      ...browserHeaders(token),
      "content-type": "application/json",
      "x-gsc-csrf": proof,
      cookie: `auth_token=${token}; ${ticketCookie}`,
    },
    body: JSON.stringify({ csrfProof: proof }),
  });
  return { response, proof };
}

test("browser bearer credentials cannot replace the auth_token cookie", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const response = await fetch(`${server.baseUrl}${GSC_BROWSER_STATUS_PATH}`, {
      headers: { authorization: `Bearer ${AUTH_A}` },
    });
    assert.equal(response.status, 401);
    assert.equal(calls.loadCore, 0);
  } finally {
    await server.close();
  }
});

test("browser authentication requires a fresh exact user and membership", async () => {
  const { app, calls } = makeHarness({
    getUser: async () => ({ id: "different-member" }),
  });
  const server = await listen(app);
  try {
    const response = await fetch(`${server.baseUrl}${GSC_BROWSER_STATUS_PATH}`, {
      headers: { cookie: `auth_token=${AUTH_A}` },
    });
    assert.equal(response.status, 401);
    assert.equal(calls.loadCore, 0);
  } finally {
    await server.close();
  }
});

test("browser HTTP authentication uses silent HS256 verification and rejects wrong or expired signatures", async () => {
  const secret = "synthetic-hs256-secret-for-gsc-route-tests";
  const valid = jwt.sign({ id: "member-a" }, secret, {
    algorithm: "HS256",
    expiresIn: "5m",
  });
  const wrong = jwt.sign({ id: "member-a" }, "different-synthetic-secret", {
    algorithm: "HS256",
    expiresIn: "5m",
  });
  const expired = jwt.sign({ id: "member-a", exp: 1 }, secret, {
    algorithm: "HS256",
  });
  const { app } = makeHarness({
    verifyBrowserJwt: (token) => verifyGscBrowserJwt(token, secret),
  });
  const server = await listen(app);
  try {
    const validResponse = await fetch(`${server.baseUrl}${GSC_BROWSER_STATUS_PATH}`, {
      headers: { cookie: `auth_token=${valid}` },
    });
    assert.equal(validResponse.status, 200);
    for (const invalid of [wrong, expired]) {
      const response = await fetch(`${server.baseUrl}${GSC_BROWSER_STATUS_PATH}`, {
        headers: { cookie: `auth_token=${invalid}` },
      });
      assert.equal(response.status, 401);
      assert.doesNotMatch(await response.text(), /synthetic-hs256|different-synthetic/);
    }
  } finally {
    await server.close();
  }
});

test("settings ticket is removed before downstream logging and login returnTo is fixed", async () => {
  const observed: string[] = [];
  const { app, credentialService } = makeHarness();
  app.use((req, _res, next) => {
    observed.push(`${req.originalUrl}|${req.get("cookie") ?? ""}`);
    next();
  });
  const server = await listen(app);
  try {
    const ticket = wrappedTicket(credentialService, TICKET_A, "member-a");
    const response = await fetch(`${server.baseUrl}/settings?gsc_ticket=${ticket}`, {
      redirect: "manual",
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/api/auth/google?returnTo=%2Fsettings");
    assert.equal(observed.length, 0);
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /twb_gsc_ticket=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.doesNotMatch(response.headers.get("location") ?? "", /gsc_ticket|state|code/);
  } finally {
    await server.close();
  }
});

test("settings trailing slash uses the same early ticket and cookie redaction", async () => {
  const observed: string[] = [];
  const { app, credentialService } = makeHarness();
  app.use((req, _res, next) => {
    observed.push(`${req.originalUrl}|${req.get("cookie") ?? ""}`);
    next();
  });
  const server = await listen(app);
  try {
    const ticket = wrappedTicket(credentialService, TICKET_A, "member-a");
    const response = await fetch(`${server.baseUrl}/settings/?gsc_ticket=${ticket}`, {
      headers: { cookie: "unrelated_cookie=synthetic-cookie-value" },
      redirect: "manual",
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/api/auth/google?returnTo=%2Fsettings");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(observed.length, 0);
  } finally {
    await server.close();
  }
});

test("malformed settings ticket redirects cleanly without setting pending proof", async () => {
  const { app } = makeHarness();
  const server = await listen(app);
  try {
    const response = await fetch(`${server.baseUrl}/settings?gsc_ticket=short&extra=1`, {
      redirect: "manual",
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/settings");
    assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /twb_gsc_ticket=short/);
  } finally {
    await server.close();
  }
});

test("pending ticket status is bound to its initiating member", async () => {
  const { app, credentialService } = makeHarness();
  const server = await listen(app);
  try {
    const ticket = wrappedTicket(credentialService, TICKET_A, "member-a");
    const response = await fetch(`${server.baseUrl}${GSC_BROWSER_STATUS_PATH}`, {
      headers: { cookie: `auth_token=${AUTH_A}; twb_gsc_ticket=${ticket}` },
    });
    assert.equal(response.status, 200);
    const body = await safeJson(response);
    assert.deepEqual(Object.keys(body).sort(), ["csrfProof", "pendingIntent", "startPath"]);
    assert.equal(body.pendingIntent, true);
    assert.equal(body.startPath, GSC_BROWSER_START_PATH);
  } finally {
    await server.close();
  }
});

test("another member's ticket is rejected at start without revealing its owner", async () => {
  const { app, calls, credentialService } = makeHarness();
  const server = await listen(app);
  try {
    const foreignTicket = wrappedTicket(credentialService, TICKET_A, "member-a");
    const proof = await csrf(server.baseUrl, AUTH_B);
    const status = await fetch(`${server.baseUrl}${GSC_BROWSER_STATUS_PATH}`, {
      headers: { cookie: `auth_token=${AUTH_B}; twb_gsc_ticket=${foreignTicket}` },
    });
    assert.equal(status.status, 409);
    assert.equal((await safeJson(status)).message,
      "請切換回發起連線的會員帳號，或重新開始連線。");
    const response = await fetch(`${server.baseUrl}${GSC_BROWSER_START_PATH}`, {
      method: "POST",
      headers: {
        ...browserHeaders(AUTH_B),
        cookie: `auth_token=${AUTH_B}; twb_gsc_ticket=${foreignTicket}`,
        "content-type": "application/json",
        "x-gsc-csrf": proof,
      },
      body: JSON.stringify({ csrfProof: proof }),
    });
    assert.equal(response.status, 409);
    assert.equal(calls.start.length, 0);
    assert.equal((await safeJson(response)).message,
      "請切換回發起連線的會員帳號，或重新開始連線。");
  } finally {
    await server.close();
  }
});

test("active browser status returns only the safe member projection", async () => {
  const { app, connections } = makeHarness();
  connections.set("member-a", connection("member-a", "active"));
  const server = await listen(app);
  try {
    const response = await fetch(`${server.baseUrl}${GSC_BROWSER_STATUS_PATH}`, {
      headers: { cookie: `auth_token=${AUTH_A}` },
    });
    assert.equal(response.status, 200);
    const body = await safeJson(response);
    assert.equal(body.displayEmail, "member-a@example.invalid");
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /member-a"|refresh-|subject-|credentialEnvelope|googleSubject/i);
  } finally {
    await server.close();
  }
});

test("browser status discards decrypted email if active state changes before response", async () => {
  const harness = makeHarness();
  harness.connections.set("member-a", connection("member-a", "active"));
  const original = harness.core.repository.getActiveCredential;
  (harness.core.repository as { getActiveCredential: typeof original }).getActiveCredential = async (input) => {
    const value = await original(input);
    harness.connections.set("member-a", Object.freeze({
      ...connection("member-a", "disconnected"),
      generation: 1,
    }));
    return value;
  };
  const server = await listen(harness.app);
  try {
    const response = await fetch(`${server.baseUrl}${GSC_BROWSER_STATUS_PATH}`, {
      headers: { cookie: `auth_token=${AUTH_A}` },
    });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /member-a@example|refresh-|subject-/i);
  } finally {
    await server.close();
  }
});

test("same-origin and CSRF are checked before creating an intent", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const proof = await csrf(server.baseUrl);
    const response = await fetch(`${server.baseUrl}${GSC_BROWSER_INTENT_PATH}`, {
      method: "POST",
      headers: {
        cookie: `auth_token=${AUTH_A}`,
        origin: "https://example.invalid",
        "content-type": "application/json",
        "x-gsc-csrf": proof,
      },
      body: JSON.stringify({ csrfProof: proof }),
    });
    assert.equal(response.status, 403);
    assert.equal(calls.begin.length, 0);
  } finally {
    await server.close();
  }
});

test("intent creates an HttpOnly pending ticket without returning it in JSON", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const proof = await csrf(server.baseUrl);
    const response = await fetch(`${server.baseUrl}${GSC_BROWSER_INTENT_PATH}`, {
      method: "POST",
      headers: {
        ...browserHeaders(),
        "content-type": "application/json",
        "x-gsc-csrf": proof,
      },
      body: JSON.stringify({ csrfProof: proof }),
    });
    assert.equal(response.status, 201);
    assert.equal(calls.begin.length, 1);
    assert.doesNotMatch(JSON.stringify(await safeJson(response)), new RegExp(TICKET_A));
    assert.match(response.headers.get("set-cookie") ?? "", /twb_gsc_ticket=.*HttpOnly/i);
  } finally {
    await server.close();
  }
});

test("start binds the actual auth cookie and stores callback proof on callback path", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const { response } = await startFlow(server.baseUrl);
    assert.equal(response.status, 200);
    assert.equal(calls.start.length, 1);
    assert.equal(calls.start[0].browserSessionProof, AUTH_A);
    const cookies = response.headers.get("set-cookie") ?? "";
    assert.match(cookies, /twb_gsc_flow=/);
    assert.match(cookies, /Path=\/api\/gsc\/oauth\/callback/i);
    assert.match(cookies, /twb_gsc_ticket=;/);
  } finally {
    await server.close();
  }
});

test("disconnect requires confirmation and never invents a browser deadline", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const proof = await csrf(server.baseUrl);
    const base = {
      method: "POST",
      headers: {
        ...browserHeaders(),
        "content-type": "application/json",
        "x-gsc-csrf": proof,
      },
    } as const;
    const rejected = await fetch(`${server.baseUrl}${GSC_BROWSER_DISCONNECT_PATH}`, {
      ...base,
      body: JSON.stringify({ confirmed: false, connectionId: CONNECTION_A, generation: 0, csrfProof: proof }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(calls.disconnect.length, 0);
    const accepted = await fetch(`${server.baseUrl}${GSC_BROWSER_DISCONNECT_PATH}`, {
      ...base,
      body: JSON.stringify({ confirmed: true, connectionId: CONNECTION_A, generation: 0, csrfProof: proof }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(calls.disconnect[0], {
      userId: "member-a", connectionId: CONNECTION_A, generation: 0,
    });
    assert.match(String((await safeJson(accepted)).message), /ThinkWithBlack/);
  } finally {
    await server.close();
  }
});

test("callback success uses the same session proof and a fixed clean redirect", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const started = await startFlow(server.baseUrl);
    const flowCookie = cookieFrom(started.response, "twb_gsc_flow");
    const response = await fetch(
      `${server.baseUrl}/api/gsc/oauth/callback?state=opaque-state&code=opaque-code`,
      { headers: { cookie: `auth_token=${AUTH_A}; ${flowCookie}` }, redirect: "manual" },
    );
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/settings");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("content-security-policy"), "default-src 'none'");
    assert.equal(calls.callback.length, 1);
    assert.equal(calls.callback[0].browserSessionProof, AUTH_A);
    assert.equal(calls.denied.length, 0);
  } finally {
    await server.close();
  }
});

test("a replayed callback gets only a fixed failure when the accepted OAuth layer rejects reuse", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const started = await startFlow(server.baseUrl);
    const flowCookie = cookieFrom(started.response, "twb_gsc_flow");
    const callbackUrl = `${server.baseUrl}/api/gsc/oauth/callback?state=opaque-state&code=opaque-code`;
    const request = () => fetch(callbackUrl, {
      headers: { cookie: `auth_token=${AUTH_A}; ${flowCookie}` },
      redirect: "manual",
    });
    const first = await request();
    const replay = await request();
    assert.equal(first.status, 303);
    assert.equal(replay.status, 303);
    assert.equal(calls.callback.length, 1);
    assert.match(replay.headers.get("set-cookie") ?? "", /twb_gsc_notice=callback_failed/);
    assert.doesNotMatch(await replay.text(), /opaque-state|opaque-code/);
  } finally {
    await server.close();
  }
});

test("callback from another logged-in member never reaches OAuth processing", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const started = await startFlow(server.baseUrl);
    const flowCookie = cookieFrom(started.response, "twb_gsc_flow");
    const response = await fetch(
      `${server.baseUrl}/api/gsc/oauth/callback?state=opaque-state&code=opaque-code`,
      { headers: { cookie: `auth_token=${AUTH_B}; ${flowCookie}` }, redirect: "manual" },
    );
    assert.equal(response.status, 303);
    assert.equal(calls.callback.length, 0);
    assert.equal(calls.denied.length, 0);
    assert.match(response.headers.get("set-cookie") ?? "", /twb_gsc_notice=callback_failed/);
  } finally {
    await server.close();
  }
});

test("Google access_denied is consumed once without exchanging a code", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const started = await startFlow(server.baseUrl);
    const flowCookie = cookieFrom(started.response, "twb_gsc_flow");
    const response = await fetch(
      `${server.baseUrl}/api/gsc/oauth/callback?state=opaque-state&error=access_denied`,
      { headers: { cookie: `auth_token=${AUTH_A}; ${flowCookie}` }, redirect: "manual" },
    );
    assert.equal(response.status, 303);
    assert.equal(calls.denied.length, 1);
    assert.equal(calls.callback.length, 0);
    assert.match(response.headers.get("set-cookie") ?? "", /twb_gsc_notice=cancelled/);
  } finally {
    await server.close();
  }
});

test("non-cancellation Google callback errors are not described as user cancellation", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const started = await startFlow(server.baseUrl);
    const flowCookie = cookieFrom(started.response, "twb_gsc_flow");
    const response = await fetch(
      `${server.baseUrl}/api/gsc/oauth/callback?state=opaque-state&error=server_error`,
      { headers: { cookie: `auth_token=${AUTH_A}; ${flowCookie}` }, redirect: "manual" },
    );
    assert.equal(response.status, 303);
    assert.equal(calls.denied.length, 1);
    assert.match(response.headers.get("set-cookie") ?? "", /twb_gsc_notice=callback_failed/);
  } finally {
    await server.close();
  }
});

test("mixed-case callback always returns a fixed safe failure instead of hanging", async () => {
  const { app } = makeHarness();
  const server = await listen(app);
  try {
    const response = await fetch(
      `${server.baseUrl}/API/GSC/oauth/callback?state=sensitive-state&code=sensitive-code`,
      { redirect: "manual" },
    );
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/settings");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.doesNotMatch(await response.text(), /sensitive-state|sensitive-code/);
  } finally {
    await server.close();
  }
});

test("internal caller credential is mandatory and browser JWT cannot substitute", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const deadline = { startedAtMs: Date.parse("2026-01-01T00:00:00.000Z"), deadlineAtMs: Date.parse("2026-01-01T00:00:45.000Z") };
    const response = await fetch(`${server.baseUrl}/api/gsc/internal/begin-connection`, {
      method: "POST",
      headers: { authorization: `Bearer ${AUTH_A}`, "content-type": "application/json" },
      body: JSON.stringify({ userId: "member-a", deadline }),
    });
    assert.equal(response.status, 401);
    assert.equal(calls.loadCore, 0);
  } finally {
    await server.close();
  }
});

test("internal begin returns identity for the caller to compare", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
    const response = await fetch(`${server.baseUrl}/api/gsc/internal/begin-connection`, {
      method: "POST",
      headers: { authorization: `Bearer ${CALLER}`, "content-type": "application/json" },
      body: JSON.stringify({
        userId: "member-a",
        deadline: { startedAtMs, deadlineAtMs: startedAtMs + GSC_OPERATION_TIMEOUT_MS },
      }),
    });
    assert.equal(response.status, 200);
    const body = await safeJson(response);
    assert.equal(body.userId, "member-a");
    assert.equal(body.connectionId, CONNECTION_A);
    assert.equal(body.generation, 0);
    assert.equal(calls.beginIntent.length, 1);
  } finally {
    await server.close();
  }
});

test("internal query forwards the identical inherited deadline and exact owner identity", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
    const deadline = { startedAtMs, deadlineAtMs: startedAtMs + GSC_OPERATION_TIMEOUT_MS };
    const response = await fetch(`${server.baseUrl}/api/gsc/internal/list-sites`, {
      method: "POST",
      headers: { authorization: `Bearer ${CALLER}`, "content-type": "application/json" },
      body: JSON.stringify({ userId: "member-a", connectionId: CONNECTION_A, generation: 0, deadline }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls.query.length, 1);
    assert.deepEqual(calls.query[0].deadline, deadline);
    const body = await safeJson(response);
    assert.equal(body.userId, "member-a");
    assert.equal(body.connectionId, CONNECTION_A);
    assert.equal(body.generation, 0);
  } finally {
    await server.close();
  }
});

test("all five fixed data operations use exact routes and return caller-checkable identity", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
  const base = {
    userId: "member-a",
    connectionId: CONNECTION_A,
    generation: 0,
    deadline: { startedAtMs, deadlineAtMs: startedAtMs + GSC_OPERATION_TIMEOUT_MS },
  };
  const cases = [
    ["list-sites", {}],
    ["search-analytics", {
      siteUrl: "sc-domain:example.com", startDate: "2026-01-01", endDate: "2026-01-07",
      dimensions: ["query"], rowLimit: 100,
    }],
    ["compare-periods", {
      siteUrl: "sc-domain:example.com",
      periodA: { startDate: "2025-12-18", endDate: "2025-12-24" },
      periodB: { startDate: "2026-01-01", endDate: "2026-01-07" },
    }],
    ["inspect-url", {
      siteUrl: "https://example.com/", inspectionUrl: "https://example.com/page",
    }],
    ["list-sitemaps", { siteUrl: "https://example.com/" }],
  ] as const;
  try {
    for (const [path, extra] of cases) {
      const response = await fetch(`${server.baseUrl}/api/gsc/internal/${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${CALLER}`, "content-type": "application/json" },
        body: JSON.stringify({ ...base, ...extra }),
      });
      assert.equal(response.status, 200, path);
      const body = await safeJson(response);
      assert.equal(body.userId, "member-a", path);
      assert.equal(body.connectionId, CONNECTION_A, path);
      assert.equal(body.generation, 0, path);
    }
    assert.equal(calls.query.length, 5);
  } finally {
    await server.close();
  }
});

test("HTTP parsing preserves a valid filter expression larger than the former 32 KiB draft limit", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const expression = "q".repeat(40 * 1024);
    const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
    const response = await fetch(`${server.baseUrl}/api/gsc/internal/search-analytics`, {
      method: "POST",
      headers: { authorization: `Bearer ${CALLER}`, "content-type": "application/json" },
      body: JSON.stringify({
        userId: "member-a",
        connectionId: CONNECTION_A,
        generation: 0,
        deadline: { startedAtMs, deadlineAtMs: startedAtMs + GSC_OPERATION_TIMEOUT_MS },
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-07",
        filters: [{ dimension: "query", operator: "contains", expression }],
      }),
    });
    assert.equal(response.status, 200);
    const filters = calls.query[0].filters as Array<Record<string, unknown>>;
    assert.equal(filters[0].expression, expression);
  } finally {
    await server.close();
  }
});

test("query result identity mismatch is rejected before serialization", async () => {
  const harness = makeHarness();
  (harness.core.queryService as unknown as {
    listSites: GscQueryService["listSites"];
  }).listSites = async (input) => ({
    userId: "member-b",
    connectionId: input.connectionId,
    generation: input.generation,
    sites: [],
    checkedAt: "2026-01-01T00:00:00.000Z",
  });
  const server = await listen(harness.app);
  try {
    const response = await fetch(`${server.baseUrl}/api/gsc/internal/list-sites`, {
      method: "POST",
      headers: { authorization: `Bearer ${CALLER}`, "content-type": "application/json" },
      body: JSON.stringify({
        userId: "member-a", connectionId: CONNECTION_A, generation: 0,
        deadline: { startedAtMs: Date.parse("2026-01-01T00:00:00.000Z"), deadlineAtMs: Date.parse("2026-01-01T00:00:45.000Z") },
      }),
    });
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /member-b/);
  } finally {
    await server.close();
  }
});

test("unknown fields and user spoofing shapes are rejected before a query", async () => {
  const { app, calls } = makeHarness();
  const server = await listen(app);
  try {
    const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
    const response = await fetch(`${server.baseUrl}/api/gsc/internal/list-sites`, {
      method: "POST",
      headers: { authorization: `Bearer ${CALLER}`, "content-type": "application/json" },
      body: JSON.stringify({
        userId: "member-a", connectionId: CONNECTION_A, generation: 0,
        deadline: { startedAtMs, deadlineAtMs: startedAtMs + GSC_OPERATION_TIMEOUT_MS },
        claimedUserId: "member-b",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(calls.query.length, 0);
  } finally {
    await server.close();
  }
});

test("deadline expiry after membership prevents any later core or operation from starting", async () => {
  const membership = deferred<{ user_id: string }>();
  const entered = deferred<void>();
  let nowMs = 0;
  let timerCallback: (() => void) | undefined;
  let loadCoreCalls = 0;
  const baseline = makeHarness();
  const { app, calls } = makeHarness({
    now: () => nowMs,
    getMembership: async () => {
      entered.resolve();
      return membership.promise;
    },
    loadCore: async () => {
      loadCoreCalls += 1;
      return baseline.core;
    },
    setTimer: (callback) => {
      timerCallback = callback;
      return 1;
    },
    clearTimer: () => undefined,
  });
  const server = await listen(app);
  try {
    const request = fetch(`${server.baseUrl}/api/gsc/internal/begin-connection`, {
      method: "POST",
      headers: { authorization: `Bearer ${CALLER}`, "content-type": "application/json" },
      body: JSON.stringify({
        userId: "member-a",
        deadline: { startedAtMs: 0, deadlineAtMs: GSC_OPERATION_TIMEOUT_MS },
      }),
    });
    await entered.promise;
    nowMs = GSC_OPERATION_TIMEOUT_MS;
    assert.ok(timerCallback);
    timerCallback();
    const response = await request;
    assert.equal(response.status, 504);
    membership.resolve({ user_id: "member-a" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(loadCoreCalls, 0);
    assert.equal(calls.begin.length, 0);
  } finally {
    await server.close();
  }
});

test("connection status does not start a state read after ensure returns past the deadline", async () => {
  let nowMs = 0;
  let timerCallback: (() => void) | undefined;
  let stateReads = 0;
  const waiting = deferred<void>();
  const release = deferred<void>();
  const harness = makeHarness({
    now: () => nowMs,
    setTimer: (callback) => {
      timerCallback = callback;
      return 1;
    },
    clearTimer: () => undefined,
  });
  const originalEnsure = harness.core.repository.ensureConnection;
  const originalState = harness.core.repository.getConnectionState;
  (harness.core.repository as { ensureConnection: typeof originalEnsure }).ensureConnection = async (input) => {
    waiting.resolve();
    await release.promise;
    return originalEnsure(input);
  };
  (harness.core.repository as { getConnectionState: typeof originalState }).getConnectionState = async (input) => {
    stateReads += 1;
    return originalState(input);
  };
  const server = await listen(harness.app);
  try {
    const request = fetch(`${server.baseUrl}/api/gsc/internal/connection-status`, {
      method: "POST",
      headers: { authorization: `Bearer ${CALLER}`, "content-type": "application/json" },
      body: JSON.stringify({
        userId: "member-a",
        deadline: { startedAtMs: 0, deadlineAtMs: GSC_OPERATION_TIMEOUT_MS },
      }),
    });
    await waiting.promise;
    nowMs = GSC_OPERATION_TIMEOUT_MS;
    assert.ok(timerCallback);
    timerCallback();
    assert.equal((await request).status, 504);
    release.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stateReads, 0);
  } finally {
    await server.close();
  }
});

test("internal begin does not create an intent after ensure returns past the deadline", async () => {
  let nowMs = 0;
  let timerCallback: (() => void) | undefined;
  const waiting = deferred<void>();
  const release = deferred<void>();
  const harness = makeHarness({
    now: () => nowMs,
    setTimer: (callback) => {
      timerCallback = callback;
      return 1;
    },
    clearTimer: () => undefined,
  });
  const originalEnsure = harness.core.repository.ensureConnection;
  (harness.core.repository as { ensureConnection: typeof originalEnsure }).ensureConnection = async (input) => {
    waiting.resolve();
    await release.promise;
    return originalEnsure(input);
  };
  const server = await listen(harness.app);
  try {
    const request = fetch(`${server.baseUrl}/api/gsc/internal/begin-connection`, {
      method: "POST",
      headers: { authorization: `Bearer ${CALLER}`, "content-type": "application/json" },
      body: JSON.stringify({
        userId: "member-a",
        deadline: { startedAtMs: 0, deadlineAtMs: GSC_OPERATION_TIMEOUT_MS },
      }),
    });
    await waiting.promise;
    nowMs = GSC_OPERATION_TIMEOUT_MS;
    assert.ok(timerCallback);
    timerCallback();
    assert.equal((await request).status, 504);
    release.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.calls.beginIntent.length, 0);
  } finally {
    await server.close();
  }
});

test("malformed JSON and unknown GSC routes have fixed safe responses", async () => {
  const observed: string[] = [];
  const { app } = makeHarness();
  app.use((req, _res, next) => {
    observed.push(req.originalUrl);
    next();
  });
  const server = await listen(app);
  try {
    const malformed = await fetch(`${server.baseUrl}/api/gsc/browser/intent`, {
      method: "POST",
      headers: { ...browserHeaders(), "content-type": "application/json" },
      body: "{secret-cookie-state",
    });
    assert.equal(malformed.status, 400);
    assert.doesNotMatch(await malformed.text(), /secret-cookie-state/);
    const unknown = await fetch(`${server.baseUrl}/api/gsc/unknown?code=sensitive-code`);
    assert.equal(unknown.status, 404);
    assert.doesNotMatch(await unknown.text(), /sensitive-code/);
    assert.equal(observed.length, 0);
  } finally {
    await server.close();
  }
});

test("lazy core failure affects only GSC routes and ordinary app routes still work", async () => {
  const { app } = makeHarness({
    loadCore: async () => { throw new Error("synthetic missing GSC configuration"); },
  });
  app.get("/ordinary", (_req, res) => res.json({ ok: true }));
  const server = await listen(app);
  try {
    const ordinary = await fetch(`${server.baseUrl}/ordinary`);
    assert.deepEqual(await safeJson(ordinary), { ok: true });
    const gsc = await fetch(`${server.baseUrl}${GSC_BROWSER_STATUS_PATH}`, {
      headers: { cookie: `auth_token=${AUTH_A}` },
    });
    assert.equal(gsc.status, 503);
    assert.doesNotMatch(await gsc.text(), /synthetic missing GSC configuration/);
  } finally {
    await server.close();
  }
});

test("internal core failures emit only the fixed GSC diagnostic contract", async () => {
  const diagnostics: Array<Record<string, unknown>> = [];
  const { app } = makeHarness({
    loadCore: async () => { throw new Error("synthetic secret value"); },
    reportGscDiagnostic: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
  });
  const server = await listen(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/gsc/internal/connection-status`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CALLER}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: "member-a",
        deadline: {
          startedAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
          deadlineAtMs: Date.parse("2026-01-01T00:00:00.000Z") + GSC_OPERATION_TIMEOUT_MS,
        },
      }),
    });
    assert.equal(response.status, 503);
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(Object.keys(diagnostics[0]).sort(), [
      "code",
      "correlation_id",
      "latency_ms",
      "phase",
      "retryable",
      "route",
      "status",
      "version",
    ]);
    assert.equal(diagnostics[0].code, "GSC_UNAVAILABLE");
    assert.equal(diagnostics[0].retryable, true);
    assert.equal(diagnostics[0].phase, "load_core");
    assert.equal(diagnostics[0].route, "/internal/connection-status");
    assert.equal(diagnostics[0].version, "eccal-gsc-v1");
    assert.doesNotMatch(JSON.stringify(diagnostics[0]), /synthetic secret value|member-a|caller-token/);
  } finally {
    await server.close();
  }
});
