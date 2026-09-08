import assert from "node:assert/strict";
import test from "node:test";
import {
  GSC_CREDENTIAL_FORMAT_VERSION,
  GscCredentialServiceError,
  createGscCredentialService,
  type GscCredentialBinding,
  type GscCredentialPlaintext,
  type GscEncryptedEnvelope,
  type GscPkceBinding,
} from "./gscCredentialService";

const CREDENTIAL_KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const ACCESS_TOKEN = "short-lived-access-token-must-not-persist";
const REFRESH_TOKEN = "synthetic-refresh-token";
const GOOGLE_SUBJECT = "synthetic-google-subject";
const DISPLAY_EMAIL = "synthetic@example.test";

const CREDENTIAL_BINDING: GscCredentialBinding = Object.freeze({
  userId: "member-a",
  connectionId: "connection-a",
  googleClientId: "google-client-a",
  generation: 4,
  formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
});

const CREDENTIAL: GscCredentialPlaintext = Object.freeze({
  refreshToken: REFRESH_TOKEN,
  googleSubject: GOOGLE_SUBJECT,
  displayEmail: DISPLAY_EMAIL,
  grantedScopes: Object.freeze([
    "openid",
    "https://www.googleapis.com/auth/webmasters.readonly",
  ]),
});

function sequentialRandomBytes() {
  let call = 0;
  return (length: number): Uint8Array => {
    call += 1;
    return Buffer.alloc(length, call);
  };
}

function service(key = CREDENTIAL_KEY) {
  return createGscCredentialService({
    credentialKey: key,
    randomBytes: sequentialRandomBytes(),
  });
}

function flipBase64Url(value: string): string {
  const bytes = Buffer.from(value, "base64url");
  bytes[0] ^= 1;
  return bytes.toString("base64url");
}

function assertGenericCredentialError(
  operation: () => unknown,
  sensitiveValues: readonly string[] = [],
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof GscCredentialServiceError);
    assert.equal(error.code, "GSC_CREDENTIAL_INVALID");
    for (const sensitive of sensitiveValues) {
      assert.doesNotMatch(error.message, new RegExp(sensitive, "u"));
    }
    return true;
  });
}

test("credential envelope round-trips only persistent GSC fields", () => {
  const credentialService = service();
  const input = {
    ...CREDENTIAL,
    accessToken: ACCESS_TOKEN,
  } as GscCredentialPlaintext & { accessToken: string };

  const envelope = credentialService.encryptCredentialEnvelope(
    CREDENTIAL_BINDING,
    input,
  );
  const opened = credentialService.decryptCredentialEnvelope(
    CREDENTIAL_BINDING,
    envelope,
  );

  assert.deepEqual(opened, CREDENTIAL);
  assert.deepEqual(Object.keys(opened).sort(), [
    "displayEmail",
    "googleSubject",
    "grantedScopes",
    "refreshToken",
  ]);
  assert.equal("accessToken" in opened, false);
  assert.deepEqual(Object.keys(envelope).sort(), [
    "authTag",
    "ciphertext",
    "formatVersion",
    "nonce",
  ]);
  const stored = JSON.stringify(envelope);
  for (const plaintext of [
    ACCESS_TOKEN,
    REFRESH_TOKEN,
    GOOGLE_SUBJECT,
    DISPLAY_EMAIL,
  ]) {
    assert.equal(stored.includes(plaintext), false);
  }
});

test("AES-256-GCM generates a new nonce and ciphertext for every envelope", () => {
  const credentialService = service();
  const first = credentialService.encryptCredentialEnvelope(
    CREDENTIAL_BINDING,
    CREDENTIAL,
  );
  const second = credentialService.encryptCredentialEnvelope(
    CREDENTIAL_BINDING,
    CREDENTIAL,
  );

  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(Buffer.from(first.nonce, "base64url").length, 12);
  assert.equal(Buffer.from(first.authTag, "base64url").length, 16);
});

test("production randomBytes creates distinct decryptable nonces", () => {
  const credentialService = createGscCredentialService({
    credentialKey: CREDENTIAL_KEY,
  });
  const first = credentialService.encryptCredentialEnvelope(
    CREDENTIAL_BINDING,
    CREDENTIAL,
  );
  const second = credentialService.encryptCredentialEnvelope(
    CREDENTIAL_BINDING,
    CREDENTIAL,
  );

  assert.notEqual(first.nonce, second.nonce);
  assert.deepEqual(
    credentialService.decryptCredentialEnvelope(CREDENTIAL_BINDING, first),
    CREDENTIAL,
  );
  assert.deepEqual(
    credentialService.decryptCredentialEnvelope(CREDENTIAL_BINDING, second),
    CREDENTIAL,
  );
});

test("credential AAD rejects owner, connection, client, generation, and version relocation", () => {
  const credentialService = service();
  const envelope = credentialService.encryptCredentialEnvelope(
    CREDENTIAL_BINDING,
    CREDENTIAL,
  );
  const relocatedBindings = [
    { ...CREDENTIAL_BINDING, userId: "member-b" },
    { ...CREDENTIAL_BINDING, connectionId: "connection-b" },
    { ...CREDENTIAL_BINDING, googleClientId: "google-client-b" },
    { ...CREDENTIAL_BINDING, generation: 5 },
  ];

  for (const binding of relocatedBindings) {
    assertGenericCredentialError(
      () => credentialService.decryptCredentialEnvelope(binding, envelope),
      [REFRESH_TOKEN, GOOGLE_SUBJECT, DISPLAY_EMAIL],
    );
  }
  assertGenericCredentialError(() =>
    credentialService.decryptCredentialEnvelope(CREDENTIAL_BINDING, {
      ...envelope,
      formatVersion: 2,
    } as unknown as GscEncryptedEnvelope),
  );
});

test("credential decryption rejects nonce, ciphertext, tag, shape, and key changes", () => {
  const credentialService = service();
  const envelope = credentialService.encryptCredentialEnvelope(
    CREDENTIAL_BINDING,
    CREDENTIAL,
  );
  const changedEnvelopes = [
    { ...envelope, nonce: flipBase64Url(envelope.nonce) },
    { ...envelope, ciphertext: flipBase64Url(envelope.ciphertext) },
    { ...envelope, authTag: flipBase64Url(envelope.authTag) },
    { ...envelope, nonce: "not+base64url" },
    { ...envelope, extra: "field" },
  ];

  for (const changed of changedEnvelopes) {
    assertGenericCredentialError(() =>
      credentialService.decryptCredentialEnvelope(
        CREDENTIAL_BINDING,
        changed as GscEncryptedEnvelope,
      ),
    );
  }
  assertGenericCredentialError(() =>
    service(OTHER_KEY).decryptCredentialEnvelope(CREDENTIAL_BINDING, envelope),
  );
});

test("encrypted PKCE verifier is bound to the OAuth flow context", () => {
  const credentialService = service();
  const stateHash = credentialService.hashOpaqueProof(
    "state",
    "synthetic-state",
  );
  const sessionHash = credentialService.hashOpaqueProof(
    "browser_session",
    "synthetic-session-proof",
  );
  const binding: GscPkceBinding = Object.freeze({
    ...CREDENTIAL_BINDING,
    redirectUri: "https://eccal.thinkwithblack.com/api/gsc/oauth/callback",
    browserSessionHash: sessionHash,
    stateHash,
  });
  const verifier = "v".repeat(64);
  const envelope = credentialService.encryptPkceVerifier(binding, verifier);

  assert.equal(credentialService.decryptPkceVerifier(binding, envelope), verifier);
  for (const changed of [
    { ...binding, userId: "member-b" },
    { ...binding, connectionId: "connection-b" },
    { ...binding, googleClientId: "google-client-b" },
    { ...binding, redirectUri: "https://attacker.example/callback" },
    { ...binding, generation: 5 },
    { ...binding, browserSessionHash: flipBase64Url(sessionHash) },
    { ...binding, stateHash: flipBase64Url(stateHash) },
  ]) {
    assertGenericCredentialError(() =>
      credentialService.decryptPkceVerifier(changed, envelope),
    );
  }
});

test("credential and PKCE envelopes cannot be used across purposes", () => {
  const credentialService = service();
  const pkceBinding: GscPkceBinding = {
    ...CREDENTIAL_BINDING,
    redirectUri: "https://eccal.thinkwithblack.com/api/gsc/oauth/callback",
    browserSessionHash: credentialService.hashOpaqueProof(
      "browser_session",
      "session-proof",
    ),
    stateHash: credentialService.hashOpaqueProof("state", "oauth-state"),
  };
  const credentialEnvelope = credentialService.encryptCredentialEnvelope(
    CREDENTIAL_BINDING,
    CREDENTIAL,
  );
  const pkceEnvelope = credentialService.encryptPkceVerifier(
    pkceBinding,
    "p".repeat(64),
  );

  assertGenericCredentialError(() =>
    credentialService.decryptPkceVerifier(pkceBinding, credentialEnvelope),
  );
  assertGenericCredentialError(() =>
    credentialService.decryptCredentialEnvelope(
      CREDENTIAL_BINDING,
      pkceEnvelope,
    ),
  );
});

test("Google subject HMAC is keyed, client-bound, and purpose-separated", () => {
  const firstService = service();
  const secondService = service(OTHER_KEY);
  const first = firstService.hashGoogleSubject(
    "google-client-a",
    GOOGLE_SUBJECT,
  );

  assert.equal(
    first,
    firstService.hashGoogleSubject("google-client-a", GOOGLE_SUBJECT),
  );
  assert.notEqual(
    first,
    firstService.hashGoogleSubject("google-client-b", GOOGLE_SUBJECT),
  );
  assert.notEqual(
    first,
    firstService.hashGoogleSubject("google-client-a", "other-subject"),
  );
  assert.notEqual(
    first,
    secondService.hashGoogleSubject("google-client-a", GOOGLE_SUBJECT),
  );
  assert.notEqual(
    first,
    firstService.hashOpaqueProof("state", GOOGLE_SUBJECT),
  );
  assert.equal(first.includes(GOOGLE_SUBJECT), false);
  assert.equal(first.length, 43);
});

test("ticket, state, session, and OIDC nonce hashes are purpose-separated", () => {
  const credentialService = service();
  const value = "same-high-entropy-proof";
  const hashes = [
    credentialService.hashOpaqueProof("ticket", value),
    credentialService.hashOpaqueProof("state", value),
    credentialService.hashOpaqueProof("browser_session", value),
    credentialService.hashOpaqueProof("oidc_nonce", value),
  ];

  assert.equal(new Set(hashes).size, 4);
  assert.ok(hashes.every((hash) => hash.length === 43));
  assert.ok(hashes.every((hash) => !hash.includes(value)));
  assert.equal(
    credentialService.hashOpaqueProof("ticket", value),
    hashes[0],
  );
});

test("all rejected operations use a fixed non-sensitive error", () => {
  const credentialService = service();
  const sensitiveBinding = {
    ...CREDENTIAL_BINDING,
    userId: "private-member-id",
  };
  const envelope = credentialService.encryptCredentialEnvelope(
    sensitiveBinding,
    CREDENTIAL,
  );

  assertGenericCredentialError(
    () =>
      credentialService.decryptCredentialEnvelope(
        { ...sensitiveBinding, connectionId: "wrong-connection" },
        envelope,
      ),
    [
      "private-member-id",
      "wrong-connection",
      REFRESH_TOKEN,
      GOOGLE_SUBJECT,
      DISPLAY_EMAIL,
    ],
  );
  assertGenericCredentialError(() =>
    createGscCredentialService({ credentialKey: Buffer.alloc(31) }),
  );
  assertGenericCredentialError(() =>
    credentialService.hashGoogleSubject("", GOOGLE_SUBJECT),
  );
  assertGenericCredentialError(() =>
    credentialService.hashOpaqueProof("state", ""),
  );
});
