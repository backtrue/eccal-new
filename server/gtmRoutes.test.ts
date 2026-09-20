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
  const core = { repository, credentialService, read, oauth: {} } as never;
  const app = express();
  app.use(createGtmRouter({
    getCallerToken: () => "x".repeat(40),
    loadCore: async () => core,
    getUser: async id => ({ id }),
    getMembership: async id => ({ user_id: id }),
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
    const denied = await fetch(`${base}/api/gtm/internal/tags/delete`, {
      method: "POST", headers: { authorization: "Bearer " + "x".repeat(40), "content-type": "application/json" }, body: "{}",
    });
    assert.equal(denied.status, 404);
  } finally {
    server.close();
  }
});