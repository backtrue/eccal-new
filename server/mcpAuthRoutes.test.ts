import assert from "node:assert/strict";
import { createHmac, hkdfSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import http, { type Server } from "node:http";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import express from "express";
import {
  createMcpAuthRouter,
  type McpAuthRouteDependencies,
  type MembershipReceiverDiagnostic,
} from "./mcpAuthRoutes";
import { MCP_AUDIENCE } from "./mcpAuthService";

const SERVICE_TOKEN = Buffer.from(
  Array.from({ length: 32 }, (_, index) => index),
).toString("base64url");
const AUTHORIZATION = `Bearer ${SERVICE_TOKEN}`;
const STATE_MAC_INFO = "thinkwithblack-mcp/eccal-state-mac/v1";
const LOGIN_ERROR_TEXT = "登入流程已過期，請回到 ChatGPT 重新連線。";

type CallCounts = {
  verifyJwt: number;
  getUser: number;
  createCode: number;
  consumeCode: number;
  getMembership: number;
};

function signedLoginState(ciphertextBytes = 48): string {
  const prefix = [
    "v1",
    Buffer.alloc(12, 1).toString("base64url"),
    Buffer.alloc(ciphertextBytes, 2).toString("base64url"),
  ].join(".");
  const macKey = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(SERVICE_TOKEN, "base64url"),
      Buffer.alloc(0),
      STATE_MAC_INFO,
      32,
    ),
  );
  const mac = createHmac("sha256", macKey)
    .update(prefix, "ascii")
    .digest("base64url");
  return `${prefix}.${mac}`;
}

function dependencies(overrides: Partial<McpAuthRouteDependencies> = {}): {
  dependencies: McpAuthRouteDependencies;
  calls: CallCounts;
} {
  const calls: CallCounts = {
    verifyJwt: 0,
    getUser: 0,
    createCode: 0,
    consumeCode: 0,
    getMembership: 0,
  };
  const defaults: McpAuthRouteDependencies = {
    getServiceToken: () => SERVICE_TOKEN,
    verifyJwt: async () => {
      calls.verifyJwt += 1;
      return { id: "opaque-user" };
    },
    getUser: async (userId) => {
      calls.getUser += 1;
      return { id: userId };
    },
    createCode: async () => {
      calls.createCode += 1;
      return {
        code: Buffer.alloc(32, 3).toString("base64url"),
        expiresAt: new Date("2026-08-12T00:02:00.000Z"),
      };
    },
    consumeCode: async ({ audience }) => {
      calls.consumeCode += 1;
      return audience === MCP_AUDIENCE ? "opaque-user" : null;
    },
    getMembership: async (userId) => {
      calls.getMembership += 1;
      return {
        user_id: userId,
        membership: "pro",
        membership_expires: null,
        credits: 9,
        checked_at: "2026-08-12T00:00:00.000Z",
      };
    },
  };
  return {
    dependencies: { ...defaults, ...overrides },
    calls,
  };
}

async function startServer(
  routeDependencies: McpAuthRouteDependencies,
): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use("/api/mcp", createMcpAuthRouter(routeDependencies));
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function withServer<T>(
  routeDependencies: McpAuthRouteDependencies,
  callback: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const { baseUrl, server } = await startServer(routeDependencies);
  try {
    return await callback(baseUrl);
  } finally {
    await closeServer(server);
  }
}

function jsonHeaders(authorization = AUTHORIZATION): HeadersInit {
  return {
    authorization,
    "content-type": "application/json",
  };
}

function membershipBodyOfSize(size: number): string {
  const prefix = '{"user_id":"';
  const suffix = '"}';
  assert.ok(size >= prefix.length + suffix.length);
  return `${prefix}${"a".repeat(size - prefix.length - suffix.length)}${suffix}`;
}

test("scope path normalization rejects literal backslashes instead of aliasing an allowed path", () => {
  const modulePath = path.join(
    process.cwd(),
    "scripts",
    "verify-mcp-scope.mjs",
  );
  const moduleUrl = pathToFileURL(modulePath).href;
  const probe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const { normalizeSubmissionPath } = await import(${JSON.stringify(moduleUrl)});
let rejected = false;
try {
  normalizeSubmissionPath(process.argv[1]);
} catch {
  rejected = true;
}
if (!rejected) process.exit(1);
if (normalizeSubmissionPath(process.argv[2]) !== process.argv[2]) process.exit(2);`,
      "server\\mcpAuthRoutes.ts",
      "server/mcpAuthRoutes.ts",
    ],
    { encoding: "utf8" },
  );
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout, "");

  const matchingArgvImport = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(moduleUrl)});`,
      modulePath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(matchingArgvImport.status, 0, matchingArgvImport.stderr);
  assert.equal(matchingArgvImport.stdout, "");
});

test("login_state query is HMAC verified before the fixed secure cookie is set", async () => {
  const state = signedLoginState();
  const fixture = dependencies();
  await withServer(fixture.dependencies, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/mcp/login?login_state=${encodeURIComponent(state)}`,
      { redirect: "manual" },
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/api/mcp/login");
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /^twb_mcp_login_state=/u);
    assert.match(cookie, /Max-Age=600/iu);
    assert.match(cookie, /Path=\/api\/mcp/iu);
    assert.match(cookie, /HttpOnly/iu);
    assert.match(cookie, /Secure/iu);
    assert.match(cookie, /SameSite=Lax/iu);
    assert.deepEqual(fixture.calls, {
      verifyJwt: 0,
      getUser: 0,
      createCode: 0,
      consumeCode: 0,
      getMembership: 0,
    });
  });
});

test("exact auth_success=1 only redirects clean and the next request performs identity and code work", async () => {
  const state = signedLoginState();
  const fixture = dependencies();
  const cookie = `twb_mcp_login_state=${state}; auth_token=aaa.bbb.ccc`;
  await withServer(fixture.dependencies, async (baseUrl) => {
    const markerResponse = await fetch(
      `${baseUrl}/api/mcp/login?auth_success=1`,
      {
        headers: { cookie },
        redirect: "manual",
      },
    );
    assert.equal(markerResponse.status, 302);
    assert.equal(markerResponse.headers.get("location"), "/api/mcp/login");
    assert.equal(markerResponse.headers.get("set-cookie"), null);
    assert.deepEqual(fixture.calls, {
      verifyJwt: 0,
      getUser: 0,
      createCode: 0,
      consumeCode: 0,
      getMembership: 0,
    });

    const cleanResponse = await fetch(`${baseUrl}/api/mcp/login`, {
      headers: { cookie },
      redirect: "manual",
    });
    assert.equal(cleanResponse.status, 302);
    const callback = new URL(cleanResponse.headers.get("location") ?? "");
    assert.equal(callback.origin, "https://mcp.thinkwithblack.com");
    assert.equal(callback.pathname, "/oauth/eccal/callback");
    assert.equal(fixture.calls.verifyJwt, 1);
    assert.equal(fixture.calls.getUser, 1);
    assert.equal(fixture.calls.createCode, 1);
    assert.equal(fixture.calls.consumeCode, 0);
    assert.equal(fixture.calls.getMembership, 0);
  });
});

test("wrong, extra, repeated, and mixed auth_success queries fail and clear login state", async (context) => {
  const state = signedLoginState();
  const cases: readonly Readonly<{
    expectedCode: MembershipReceiverDiagnostic["code"];
    expectedRetryable: boolean;
    expectedStatus: number;
    authorization: string;
    body: Readonly<Record<string, string>>;
    getMembership?: McpAuthRouteDependencies["getMembership"];
  }>[] = [
    { label: "wrong marker", query: "auth_success=0" },
    { label: "extra query field", query: "auth_success=1&extra=1" },
    {
      label: "repeated marker",
      query: "auth_success=1&auth_success=1",
    },
    {
      label: "mixed login state and marker",
      query: `auth_success=1&login_state=${encodeURIComponent(state)}`,
    },
  ];
  for (const fixtureCase of cases) {
    await context.test(fixtureCase.label, async () => {
      const fixture = dependencies();
      await withServer(fixture.dependencies, async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/mcp/login?${fixtureCase.query}`,
          {
            headers: {
              cookie: `twb_mcp_login_state=${state}; auth_token=aaa.bbb.ccc`,
            },
            redirect: "manual",
          },
        );
        assert.equal(response.status, 400);
        assert.equal(await response.text(), LOGIN_ERROR_TEXT);
        assert.match(
          response.headers.get("set-cookie") ?? "",
          /Expires=Thu, 01 Jan 1970 00:00:00 GMT/iu,
        );
        assert.deepEqual(fixture.calls, {
          verifyJwt: 0,
          getUser: 0,
          createCode: 0,
          consumeCode: 0,
          getMembership: 0,
        });
      });
    });
  }
});

test("invalid, extra, and oversized login_state queries fail before identity or database access", async (context) => {
  const cases = [
    {
      label: "tampered query state",
      query: `login_state=${encodeURIComponent(`${signedLoginState()}x`)}`,
    },
    {
      label: "extra query field",
      query: `login_state=${encodeURIComponent(signedLoginState())}&extra=1`,
    },
    {
      label: "oversized query state",
      query: `login_state=${"a".repeat(3001)}`,
    },
  ];
  for (const fixtureCase of cases) {
    await context.test(fixtureCase.label, async () => {
      const fixture = dependencies();
      await withServer(fixture.dependencies, async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/mcp/login?${fixtureCase.query}`,
          {
            redirect: "manual",
          },
        );
        assert.equal(response.status, 400);
        assert.equal(fixture.calls.verifyJwt, 0);
        assert.equal(fixture.calls.getUser, 0);
        assert.equal(fixture.calls.createCode, 0);
        assert.match(
          response.headers.get("set-cookie") ?? "",
          /Expires=Thu, 01 Jan 1970 00:00:00 GMT/iu,
        );
      });
    });
  }
});

test("tampered state cookies and unavailable service credentials fail before JWT or database access", async (context) => {
  const cases = [
    {
      label: "tampered cookie",
      cookieState: `${signedLoginState()}x`,
      getServiceToken: () => SERVICE_TOKEN,
    },
    {
      label: "missing service credential",
      cookieState: signedLoginState(),
      getServiceToken: () => undefined,
    },
    {
      label: "malformed service credential",
      cookieState: signedLoginState(),
      getServiceToken: () => "not-canonical-base64url",
    },
  ];
  for (const fixtureCase of cases) {
    await context.test(fixtureCase.label, async () => {
      const fixture = dependencies({
        getServiceToken: fixtureCase.getServiceToken,
      });
      await withServer(fixture.dependencies, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/mcp/login`, {
          headers: {
            cookie: `twb_mcp_login_state=${fixtureCase.cookieState}; auth_token=aaa.bbb.ccc`,
          },
          redirect: "manual",
        });
        assert.equal(response.status, 400);
        assert.equal(fixture.calls.verifyJwt, 0);
        assert.equal(fixture.calls.getUser, 0);
        assert.equal(fixture.calls.createCode, 0);
        assert.match(
          response.headers.get("set-cookie") ?? "",
          /Expires=Thu, 01 Jan 1970 00:00:00 GMT/iu,
        );
      });
    });
  }
});

test("clean login path prechecks JWT shape then redirects unauthenticated users to the fixed internal return path", async () => {
  const state = signedLoginState();
  const fixture = dependencies();
  await withServer(fixture.dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mcp/login`, {
      headers: {
        cookie: `twb_mcp_login_state=${state}; auth_token=not-a-jwt`,
      },
      redirect: "manual",
    });
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "/api/auth/google?returnTo=%2Fapi%2Fmcp%2Flogin",
    );
    assert.equal(fixture.calls.verifyJwt, 0);
    assert.equal(fixture.calls.getUser, 0);
    assert.equal(fixture.calls.createCode, 0);
  });
});

test("oversized JWT-shaped cookies are rejected before jwtUtils verification", async () => {
  const state = signedLoginState();
  const fixture = dependencies();
  await withServer(fixture.dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mcp/login`, {
      headers: {
        cookie: `twb_mcp_login_state=${state}; auth_token=${"a".repeat(8189)}.b.c`,
      },
      redirect: "manual",
    });
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "/api/auth/google?returnTo=%2Fapi%2Fmcp%2Flogin",
    );
    assert.equal(fixture.calls.verifyJwt, 0);
    assert.equal(fixture.calls.getUser, 0);
    assert.equal(fixture.calls.createCode, 0);
  });
});

test("authenticated clean login creates one code and redirects only to the fixed callback", async () => {
  const state = signedLoginState();
  const code = Buffer.alloc(32, 4).toString("base64url");
  let createInput: unknown;
  const fixture = dependencies({
    createCode: async (input) => {
      fixture.calls.createCode += 1;
      createInput = input;
      return { code, expiresAt: new Date("2026-08-12T00:02:00.000Z") };
    },
  });
  await withServer(fixture.dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mcp/login`, {
      headers: {
        cookie: `twb_mcp_login_state=${state}; auth_token=aaa.bbb.ccc`,
      },
      redirect: "manual",
    });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.origin, "https://mcp.thinkwithblack.com");
    assert.equal(location.pathname, "/oauth/eccal/callback");
    assert.deepEqual([...location.searchParams.keys()].sort(), [
      "code",
      "login_state",
    ]);
    assert.equal(location.searchParams.get("code"), code);
    assert.equal(location.searchParams.get("login_state"), state);
    assert.deepEqual(createInput, {
      userId: "opaque-user",
      loginState: state,
    });
    assert.equal(fixture.calls.verifyJwt, 1);
    assert.equal(fixture.calls.getUser, 1);
    assert.equal(fixture.calls.createCode, 1);
    assert.match(
      response.headers.get("set-cookie") ?? "",
      /Expires=Thu, 01 Jan 1970 00:00:00 GMT/iu,
    );
  });
});

test("wrong caller credential is a fixed 401 and never enters code or membership services", async () => {
  const fixture = dependencies();
  await withServer(fixture.dependencies, async (baseUrl) => {
    for (const authorization of [
      undefined,
      "bearer malformed",
      `Bearer ${Buffer.alloc(32, 9).toString("base64url")}`,
    ]) {
      for (const path of ["exchange", "membership"]) {
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (authorization !== undefined) {
          headers.authorization = authorization;
        }
        const response = await fetch(`${baseUrl}/api/mcp/internal/${path}`, {
          method: "POST",
          headers,
          body: "{}",
        });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
          ok: false,
          error: { code: "UNAUTHORIZED_CALLER", retryable: false },
        });
      }
    }
    assert.equal(fixture.calls.consumeCode, 0);
    assert.equal(fixture.calls.getMembership, 0);
  });
});

test("internal routes require exact JSON and reject empty, invalid, additional, and oversized bodies", async (context) => {
  const cases = [
    { headers: { authorization: AUTHORIZATION }, body: "{}" },
    {
      headers: {
        authorization: AUTHORIZATION,
        "content-type": "application/json; charset=utf-8",
      },
      body: '{"user_id":"opaque-user"}',
    },
    { headers: jsonHeaders(), body: "" },
    { headers: jsonHeaders(), body: "{" },
    { headers: jsonHeaders(), body: '{"user_id":"u","extra":true}' },
    { headers: jsonHeaders(), body: membershipBodyOfSize(4097) },
  ];
  for (const fixtureCase of cases) {
    await context.test(String(fixtureCase.body.length), async () => {
      const fixture = dependencies();
      await withServer(fixture.dependencies, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/mcp/internal/membership`, {
          method: "POST",
          headers: fixtureCase.headers,
          body: fixtureCase.body,
        });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          ok: false,
          error: { code: "INVALID_REQUEST", retryable: false },
        });
        assert.equal(fixture.calls.getMembership, 0);
      });
    });
  }
});

test("membership receiver diagnostics classify one request without private data or response changes", async () => {
  const diagnostics: MembershipReceiverDiagnostic[] = [];
  const cases = [
    {
      expectedCode: "MCP_MEMBERSHIP_CALLER_REJECTED",
      expectedRetryable: false,
      expectedStatus: 401,
      authorization: `Bearer ${Buffer.alloc(32, 9).toString("base64url")}`,
      body: { user_id: "opaque-user" },
    },
    {
      expectedCode: "MCP_MEMBERSHIP_REQUEST_INVALID",
      expectedRetryable: false,
      expectedStatus: 400,
      authorization: AUTHORIZATION,
      body: { user_id: "opaque-user", private_field: "must-not-log" },
    },
    {
      expectedCode: "MCP_MEMBERSHIP_SNAPSHOT_UNAVAILABLE",
      expectedRetryable: true,
      expectedStatus: 503,
      authorization: AUTHORIZATION,
      body: { user_id: "opaque-user" },
      getMembership: async () => null,
    },
    {
      expectedCode: "MCP_MEMBERSHIP_SUCCESS",
      expectedRetryable: false,
      expectedStatus: 200,
      authorization: AUTHORIZATION,
      body: { user_id: "opaque-user" },
    },
  ];

  for (const fixtureCase of cases) {
    const fixture = dependencies({
      ...(fixtureCase.getMembership === undefined
        ? {}
        : { getMembership: fixtureCase.getMembership }),
      reportMembershipDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    await withServer(fixture.dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mcp/internal/membership`, {
        method: "POST",
        headers: jsonHeaders(fixtureCase.authorization),
        body: JSON.stringify(fixtureCase.body),
      });
      assert.equal(response.status, fixtureCase.expectedStatus);
      await response.arrayBuffer();
    });
  }

  assert.equal(diagnostics.length, cases.length);
  for (const [index, diagnostic] of diagnostics.entries()) {
    const fixtureCase = cases[index];
    assert.deepEqual(Object.keys(diagnostic).sort(), [
      "code",
      "correlation_id",
      "latency_ms",
      "retryable",
      "status",
      "version",
    ]);
    assert.equal(diagnostic.code, fixtureCase.expectedCode);
    assert.equal(diagnostic.retryable, fixtureCase.expectedRetryable);
    assert.equal(diagnostic.status, fixtureCase.expectedStatus);
    assert.equal(diagnostic.version, "eccal-mcp-auth-v1");
    assert.match(
      diagnostic.correlation_id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    assert.ok(Number.isSafeInteger(diagnostic.latency_ms));
    assert.ok(diagnostic.latency_ms >= 0);
  }
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /opaque-user|must-not-log|Bearer|authorization|cookie|email|secret|token|body/iu,
  );
});

test("membership diagnostic reporter failure cannot alter the success response", async () => {
  const fixture = dependencies({
    reportMembershipDiagnostic: () => {
      throw new Error("private reporter detail");
    },
  });
  await withServer(fixture.dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mcp/internal/membership`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ user_id: "opaque-user" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      user_id: "opaque-user",
      membership: "pro",
      membership_expires: null,
      credits: 9,
      checked_at: "2026-08-12T00:00:00.000Z",
    });
  });
  assert.equal(fixture.calls.getMembership, 1);
});

test("exchange rejects missing, extra, and wrongly typed fields before code consumption", async (context) => {
  const bodies = [
    {
      label: "missing audience",
      body: { code: "code", login_state: "state" },
    },
    {
      label: "extra field",
      body: {
        code: "code",
        login_state: "state",
        audience: MCP_AUDIENCE,
        extra: true,
      },
    },
    {
      label: "wrong code type",
      body: { code: 1, login_state: "state", audience: MCP_AUDIENCE },
    },
    {
      label: "wrong state type",
      body: { code: "code", login_state: null, audience: MCP_AUDIENCE },
    },
    {
      label: "wrong audience type",
      body: { code: "code", login_state: "state", audience: true },
    },
  ];
  for (const fixtureCase of bodies) {
    await context.test(fixtureCase.label, async () => {
      const fixture = dependencies();
      await withServer(fixture.dependencies, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/mcp/internal/exchange`, {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify(fixtureCase.body),
        });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          ok: false,
          error: { code: "INVALID_REQUEST", retryable: false },
        });
        assert.equal(fixture.calls.consumeCode, 0);
      });
    });
  }
});

test("4096-byte membership JSON is accepted and returns only the fixed safe snapshot", async () => {
  const fixture = dependencies({
    getMembership: async (userId) => {
      fixture.calls.getMembership += 1;
      return {
        user_id: userId,
        membership: "pro",
        membership_expires: null,
        credits: 9,
        checked_at: "2026-08-12T00:00:00.000Z",
        email: "must-not-leave-eccal@example.invalid",
      };
    },
  });
  const body = membershipBodyOfSize(4096);
  assert.equal(Buffer.byteLength(body), 4096);
  await withServer(fixture.dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mcp/internal/membership`, {
      method: "POST",
      headers: jsonHeaders(),
      body,
    });
    assert.equal(response.status, 200);
    const result = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(result).sort(), [
      "checked_at",
      "credits",
      "membership",
      "membership_expires",
      "ok",
      "user_id",
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.user_id, "a".repeat(4082));
    assert.equal(fixture.calls.getMembership, 1);
  });
});

test("exchange keeps all binding mismatches indistinguishable and maps storage failure", async () => {
  const fixture = dependencies();
  await withServer(fixture.dependencies, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/mcp/internal/exchange`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        code: "wrong",
        login_state: "wrong",
        audience: "https://wrong.example/mcp",
      }),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), {
      ok: false,
      error: { code: "LOGIN_CODE_INVALID", retryable: false },
    });
  });

  const unavailable = dependencies({
    consumeCode: async () => {
      unavailable.calls.consumeCode += 1;
      throw new Error("private database detail");
    },
  });
  await withServer(unavailable.dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mcp/internal/exchange`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        code: "code",
        login_state: "state",
        audience: MCP_AUDIENCE,
      }),
    });
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), {
      ok: false,
      error: { code: "IDENTITY_EXCHANGE_UNAVAILABLE", retryable: true },
    });
    assert.doesNotMatch(text, /private database detail/u);
  });
});

test("exchange success returns only the opaque user ID", async () => {
  const fixture = dependencies();
  await withServer(fixture.dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mcp/internal/exchange`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        code: "code",
        login_state: "state",
        audience: MCP_AUDIENCE,
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      user_id: "opaque-user",
    });
    assert.equal(fixture.calls.consumeCode, 1);
  });
});

test("missing or failed membership is one retryable unavailable response without private detail", async (context) => {
  for (const fixtureCase of [
    { label: "missing snapshot", getMembership: async () => null },
    {
      label: "mismatched user ID",
      getMembership: async () => ({
        user_id: "different-user",
        membership: "pro" as const,
        membership_expires: null,
        credits: 9,
        checked_at: "2026-08-12T00:00:00.000Z",
      }),
    },
    {
      label: "snapshot source failure",
      getMembership: async () => {
        throw new Error("private snapshot detail");
      },
    },
  ]) {
    await context.test(fixtureCase.label, async () => {
      const fixture = dependencies({
        getMembership: fixtureCase.getMembership,
      });
      await withServer(fixture.dependencies, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/mcp/internal/membership`, {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ user_id: "opaque-user" }),
        });
        assert.equal(response.status, 503);
        const text = await response.text();
        assert.deepEqual(JSON.parse(text), {
          ok: false,
          error: { code: "MEMBERSHIP_UNAVAILABLE", retryable: true },
        });
        assert.doesNotMatch(text, /private snapshot detail/u);
      });
    });
  }
});
