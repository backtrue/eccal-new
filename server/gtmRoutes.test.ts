import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import { createGtmCredentialService } from "./gtmCredentialService";
import { createGtmRouter } from "./gtmRoutes";

test("GTM routes expose only fixed readonly internal operations", async () => {
  const credentialService = createGtmCredentialService({ credentialKey: Buffer.alloc(32, 7) });
  const calls: string[] = [];
  const read = new Proxy({}, {
    get: (_target, property: string) => async (input: unknown) => {
      calls.push(property);
      return { userId: "member", connectionId: "c", generation: 0, data: { input },
        source: "google_tag_manager", fetchedAt: new Date(0).toISOString(),
        queryScope: { operation: property }, pagination: { nextPageToken: null, complete: true, automatic: false } };
    },
  }) as never;
  const repository = {
    ensureConnection: async () => ({ userId: "member", connectionId: "c", googleClientId: "client", status: "disconnected", generation: 0, createdAt: new Date(0), updatedAt: new Date(0) }),
  } as never;
  const ticket = "a".repeat(43);
  const oauth = {
    beginConnection: async () => ({
      connection: await repository.ensureConnection(),
      connectionUrl: `https://eccal.thinkwithblack.com/api/gtm/browser/claim?gtm_ticket=${ticket}`,
      expiresAt: new Date(60_000),
    }),
    startAuthorization: async (input: { ticket: string }) => {
      assert.equal(input.ticket, ticket);
      return { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=state" };
    },
  };
  const core = { repository, credentialService, read, oauth } as never;
  const app = express();
  app.use(createGtmRouter({
    getCallerToken: () => "x".repeat(40),
    loadCore: async () => core,
    getUser: async id => id === "member" ? { id } : null,
    getMembership: async id => id === "member" ? { user_id: id } : null,
    verifyBrowserJwt: token => token === "auth" ? { id: "member" } : null,
  }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const paths = [
      ["accounts/list", {}], ["containers/list", { accountId: "a" }],
      ["workspaces/list", { accountId: "a", containerId: "c" }],
      ["workspaces/status", { accountId: "a", containerId: "c", workspaceId: "w" }],
      ["tags/list", { accountId: "a", containerId: "c", workspaceId: "w" }],
      ["tags/get", { accountId: "a", containerId: "c", workspaceId: "w", objectId: "t" }],
      ["triggers/list", { accountId: "a", containerId: "c", workspaceId: "w" }],
      ["triggers/get", { accountId: "a", containerId: "c", workspaceId: "w", objectId: "t" }],
      ["variables/list", { accountId: "a", containerId: "c", workspaceId: "w" }],
      ["variables/get", { accountId: "a", containerId: "c", workspaceId: "w", objectId: "v" }],
      ["container-version-headers/list", { accountId: "a", containerId: "c" }],
    ] as const;
    for (const [path, scope] of paths) {
      const response = await fetch(`${base}/api/gtm/internal/${path}`, {
        method: "POST", headers: { authorization: "Bearer " + "x".repeat(40), "content-type": "application/json" },
        body: JSON.stringify({ userId: "member", connectionId: "c", generation: 0, ...scope }),
      });
      assert.equal(response.status, 200, path);
    }
    assert.equal(calls.length, 11);
    const connectionBegin = await fetch(`${base}/api/gtm/internal/connection/begin`, {
      method: "POST",
      headers: { authorization: "Bearer " + "x".repeat(40), "content-type": "application/json" },
      body: JSON.stringify({ userId: "member" }),
    });
    assert.equal(connectionBegin.status, 200);
    const begun = await connectionBegin.json() as Record<string, unknown>;
    assert.equal(begun.connectionUrl, `https://eccal.thinkwithblack.com/api/gtm/browser/claim?gtm_ticket=${ticket}`);
    assert.equal(begun.connectionId, "c");

    const connectionStatus = await fetch(`${base}/api/gtm/internal/connection/status`, {
      method: "POST",
      headers: { authorization: "Bearer " + "x".repeat(40), "content-type": "application/json" },
      body: JSON.stringify({ userId: "member" }),
    });
    assert.equal(connectionStatus.status, 200);
    assert.deepEqual(await connectionStatus.json(), {
      status: "disconnected", connectionId: "c", generation: 0,
    });
    const deniedConnection = await fetch(`${base}/api/gtm/internal/connection/status`, {
      method: "POST",
      headers: { authorization: "Bearer " + "x".repeat(40), "content-type": "application/json" },
      body: JSON.stringify({ userId: "other" }),
    });
    assert.equal(deniedConnection.status, 401);

    const claimed = await fetch(`${base}/api/gtm/browser/claim?gtm_ticket=${ticket}`, {
      method: "GET",
      headers: { cookie: "auth_token=auth" },
      redirect: "manual",
    });
    assert.equal(claimed.status, 303);
    assert.equal(claimed.headers.get("location"), "/settings?gtm_connect=1");
    const pendingCookie = claimed.headers.get("set-cookie")?.split(";")[0];
    assert.ok(pendingCookie?.startsWith("twb_gtm_pending="));
    const browserCookies = `auth_token=auth; ${pendingCookie}`;
    const browserStatus = await fetch(`${base}/api/gtm/browser/status`, {
      headers: { cookie: browserCookies },
    });
    assert.equal(browserStatus.status, 200);
    const browserState = await browserStatus.json() as Record<string, unknown>;
    const started = await fetch(`${base}/api/gtm/browser/start`, {
      method: "POST",
      headers: {
        origin: "https://eccal.thinkwithblack.com",
        cookie: browserCookies,
        "content-type": "application/json",
        "x-gtm-csrf": String(browserState.csrfProof),
      },
      body: JSON.stringify({ connectionId: "c", generation: 0 }),
    });
    assert.equal(started.status, 200);
    assert.equal(
      (await started.json() as Record<string, unknown>).authorizationUrl,
      "https://accounts.google.com/o/oauth2/v2/auth?state=state",
    );

    const denied = await fetch(`${base}/api/gtm/internal/tags/delete`, {
      method: "POST", headers: { authorization: "Bearer " + "x".repeat(40), "content-type": "application/json" }, body: "{}",
    });
    assert.equal(denied.status, 404);
  } finally {
    server.close();
  }
});