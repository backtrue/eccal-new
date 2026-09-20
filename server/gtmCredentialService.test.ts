import assert from "node:assert/strict";
import test from "node:test";
import { createGtmCredentialService, GTM_CREDENTIAL_FORMAT_VERSION } from "./gtmCredentialService";

test("GTM credentials are encrypted and bound to GTM context", () => {
  const s = createGtmCredentialService({ credentialKey: Buffer.alloc(32, 7) });
  const binding = { userId: "u", connectionId: "c", googleClientId: "client", generation: 1, formatVersion: GTM_CREDENTIAL_FORMAT_VERSION as const };
  const value = { refreshToken: "refresh", googleSubject: "subject", displayEmail: "a@example.test", grantedScopes: ["https://www.googleapis.com/auth/tagmanager.readonly"] };
  const envelope = s.encryptCredentialEnvelope(binding, value);
  assert.deepEqual(s.decryptCredentialEnvelope(binding, envelope), value);
  assert.throws(() => s.decryptCredentialEnvelope({ ...binding, generation: 2 }, envelope));
  assert.doesNotMatch(JSON.stringify(envelope), /refresh|subject|a@example/);
});