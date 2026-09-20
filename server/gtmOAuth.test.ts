import assert from "node:assert/strict";
import test from "node:test";
import { createGtmCredentialService, GTM_READONLY_SCOPE } from "./gtmCredentialService";
import { createGtmOAuthService } from "./gtmOAuth";
import { createGtmRepository } from "./gtmRepository";

test("GTM OAuth authorization requests only readonly scope", async () => {
  const credentialService = createGtmCredentialService({ credentialKey: Buffer.alloc(32, 1) });
  const repository = createGtmRepository();
  const oauth = createGtmOAuthService({ googleClientId: "client", googleClientSecret: "secret", repository, credentialService, transport: { request: async () => ({ status: 200, body: {} }) }, randomBytes: n => Buffer.alloc(n, 2) });
  const begun = await oauth.beginConnection({ userId: "u" });
  const started = await oauth.startAuthorization({ userId: "u", connectionId: begun.connection.connectionId, generation: 0, ticket: new URL(begun.connectionUrl).searchParams.get("gtm_ticket")!, browserSessionProof: "session" });
  assert.equal(new URL(started.authorizationUrl).searchParams.get("scope"), `openid ${GTM_READONLY_SCOPE}`);
});