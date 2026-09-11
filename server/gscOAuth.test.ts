import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import test from "node:test";
import {
  GSC_CREDENTIAL_FORMAT_VERSION,
  createGscCredentialService,
  type GscCredentialService,
  type GscEncryptedEnvelope,
} from "./gscCredentialService";
import {
  GSC_OAUTH_REDIRECT_URI,
  GscRepositoryError,
  type GscActiveCredentialRecord,
  type GscClaimedOAuthFlow,
  type GscConnectionState,
  type GscRepository,
} from "./gscRepository";
import {
  GSC_AUTHORIZATION_ENDPOINT,
  GSC_CONNECTION_URL,
  GSC_EMAIL_SCOPE,
  GSC_JWKS_ENDPOINT,
  GSC_OPERATION_TIMEOUT_MS,
  GSC_READONLY_SCOPE,
  GSC_REVOCATION_ENDPOINT,
  GSC_TOKEN_ENDPOINT,
  GSC_UPSTREAM_MAX_BODY_BYTES,
  GSC_UPSTREAM_REQUEST_TIMEOUT_MS,
  GscOAuthError,
  createGscOAuthService,
  createGscOperationDeadline,
  createGscUpstreamTransport,
  type GscOAuthErrorCode,
  type GscOAuthServiceDependencies,
  type GscOperationDeadline,
  type GscUpstreamTransport,
} from "./gscOAuth";

const NOW_MS = 1_800_000_000_000;
const GOOGLE_CLIENT_ID = "synthetic-gsc-client.apps.example.test";
const GOOGLE_CLIENT_SECRET = "synthetic-client-secret-never-log";
const USER_ID = "member-a";
const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
const FLOW_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION = 3;
const BROWSER_SESSION = "synthetic-browser-session-proof";
const STATE = "synthetic-oauth-state";
const NONCE = "synthetic-oidc-nonce";
const VERIFIER = "p".repeat(64);
const AUTHORIZATION_CODE = "synthetic-authorization-code";
const ACCESS_TOKEN = "synthetic-short-lived-access-token";
const REFRESH_TOKEN = "synthetic-refresh-token";
const GOOGLE_SUBJECT = "synthetic-google-subject";
const DISPLAY_EMAIL = "member@example.test";

function sequentialRandomBytes() {
  let value = 0;
  return (length: number): Uint8Array => {
    value += 1;
    return Buffer.alloc(length, value);
  };
}

function credentialService(): GscCredentialService {
  return createGscCredentialService({
    credentialKey: Buffer.alloc(32, 7),
    randomBytes: sequentialRandomBytes(),
  });
}

function connection(
  status: GscConnectionState["status"] = "disconnected",
): GscConnectionState {
  return Object.freeze({
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    googleClientId: GOOGLE_CLIENT_ID,
    status,
    generation: GENERATION,
    createdAt: new Date(NOW_MS - 1000),
    updatedAt: new Date(NOW_MS - 1000),
  });
}

function activeConnection(
  service: GscCredentialService,
  credentialEnvelope?: GscEncryptedEnvelope,
): GscActiveCredentialRecord {
  const base = connection("active");
  return Object.freeze({
    ...base,
    status: "active",
    googleSubjectHash: service.hashGoogleSubject(
      GOOGLE_CLIENT_ID,
      GOOGLE_SUBJECT,
    ),
    credentialEnvelope: credentialEnvelope ?? service.encryptCredentialEnvelope(
      {
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        googleClientId: GOOGLE_CLIENT_ID,
        generation: GENERATION,
        formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
      },
      {
        refreshToken: REFRESH_TOKEN,
        googleSubject: GOOGLE_SUBJECT,
        displayEmail: DISPLAY_EMAIL,
        grantedScopes: ["openid", GSC_EMAIL_SCOPE, GSC_READONLY_SCOPE],
      },
    ),
  });
}

function rejected(): never {
  throw new GscRepositoryError();
}

function repository(
  overrides: Partial<GscRepository> = {},
): GscRepository {
  return {
    ensureConnection: async () => rejected(),
    getConnectionState: async () => rejected(),
    getActiveCredential: async () => rejected(),
    beginConnectionIntent: async () => rejected(),
    startOAuthFromIntent: async () => rejected(),
    acquireOAuthProcessing: async () => rejected(),
    completeOAuthBinding: async () => rejected(),
    cancelOAuthFlow: async () => rejected(),
    markReauthorizationRequired: async () => rejected(),
    withRefreshLock: async () => rejected(),
    disconnectConnection: async () => rejected(),
    isResultEligible: async () => rejected(),
    ...overrides,
  };
}

function transport(
  handler: GscUpstreamTransport["request"],
): GscUpstreamTransport {
  return Object.freeze({ request: handler });
}

function dependencies(input: {
  repository: GscRepository;
  credentialService?: GscCredentialService;
  transport?: GscUpstreamTransport;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
}): GscOAuthServiceDependencies {
  return {
    googleClientId: GOOGLE_CLIENT_ID,
    googleClientSecret: GOOGLE_CLIENT_SECRET,
    repository: input.repository,
    credentialService: input.credentialService ?? credentialService(),
    transport: input.transport ?? transport(async () => rejected()),
    now: input.now ?? (() => NOW_MS),
    randomBytes: input.randomBytes ?? sequentialRandomBytes(),
  };
}

function assertOAuthError(
  expectedCode: GscOAuthErrorCode,
  sensitive: readonly string[] = [],
) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof GscOAuthError);
    assert.equal(error.code, expectedCode);
    for (const value of sensitive) {
      assert.equal(error.message.includes(value), false);
    }
    return true;
  };
}

function jwtPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signedIdToken(
  privateKey: KeyObject,
  claims: Readonly<Record<string, unknown>>,
  kid = "synthetic-key",
): string {
  const signingInput = `${jwtPart({ alg: "RS256", typ: "JWT", kid })}.${jwtPart(claims)}`;
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(signingInput, "ascii"),
    privateKey,
  ).toString("base64url");
  return `${signingInput}.${signature}`;
}

function rsaFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" });
  return Object.freeze({
    privateKey,
    jwks: { keys: [{ ...jwk, kid: "synthetic-key", use: "sig", alg: "RS256" }] },
  });
}

function claims(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: GOOGLE_CLIENT_ID,
    exp: Math.floor(NOW_MS / 1000) + 600,
    nonce: NONCE,
    sub: GOOGLE_SUBJECT,
    email: DISPLAY_EMAIL,
    ...overrides,
  };
}

function claimedFlow(service: GscCredentialService): GscClaimedOAuthFlow {
  const stateHash = service.hashOpaqueProof("state", STATE);
  const sessionProofHash = service.hashOpaqueProof(
    "browser_session",
    BROWSER_SESSION,
  );
  return Object.freeze({
    flowId: FLOW_ID,
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    expectedGeneration: GENERATION,
    googleClientId: GOOGLE_CLIENT_ID,
    redirectUri: GSC_OAUTH_REDIRECT_URI,
    stateHash,
    sessionProofHash,
    oidcNonceHash: service.hashOpaqueProof("oidc_nonce", NONCE),
    encryptedPkceVerifier: service.encryptPkceVerifier(
      {
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        googleClientId: GOOGLE_CLIENT_ID,
        redirectUri: GSC_OAUTH_REDIRECT_URI,
        generation: GENERATION,
        browserSessionHash: sessionProofHash,
        stateHash,
        formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
      },
      VERIFIER,
    ),
    expiresAt: new Date(NOW_MS + 60_000),
  });
}

function callbackInput(deadline?: GscOperationDeadline) {
  return {
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
    state: STATE,
    browserSessionProof: BROWSER_SESSION,
    code: AUTHORIZATION_CODE,
    deadline,
  };
}

function callbackFixture(input: {
  tokenStatus?: number;
  tokenBody?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  mutateToken?: (token: string) => string;
} = {}) {
  const crypto = credentialService();
  const signing = rsaFixture();
  const events: string[] = [];
  const requests: Parameters<GscUpstreamTransport["request"]>[0][] = [];
  let completedInput: Parameters<GscRepository["completeOAuthBinding"]>[0] | undefined;
  const repo = repository({
    acquireOAuthProcessing: async () => {
      events.push("acquire");
      return claimedFlow(crypto);
    },
    completeOAuthBinding: async (value) => {
      events.push("complete");
      completedInput = value;
      return activeConnection(crypto, value.credentialEnvelope);
    },
  });
  let token = signedIdToken(signing.privateKey, claims(input.claims));
  token = input.mutateToken?.(token) ?? token;
  const tokenBody = input.tokenBody ?? {
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    id_token: token,
    scope: `openid ${GSC_EMAIL_SCOPE} ${GSC_READONLY_SCOPE}`,
    token_type: "Bearer",
    expires_in: 3600,
  };
  const upstream = transport(async (request) => {
    requests.push(request);
    if (request.url === GSC_TOKEN_ENDPOINT) {
      events.push("token");
      return { status: input.tokenStatus ?? 200, body: tokenBody };
    }
    if (request.url === GSC_JWKS_ENDPOINT) {
      events.push("jwks");
      return { status: 200, body: signing.jwks };
    }
    return rejected();
  });
  return {
    crypto,
    repo,
    upstream,
    events,
    requests,
    completedInput: () => completedInput,
  };
}

test("missing GSC-specific configuration fails without module-load side effects", () => {
  const base = dependencies({ repository: repository() });
  assert.throws(
    () => createGscOAuthService({ ...base, googleClientId: "" }),
    assertOAuthError("GSC_OAUTH_CONFIGURATION", [GOOGLE_CLIENT_SECRET]),
  );
  assert.throws(
    () => createGscOAuthService({ ...base, googleClientSecret: "" }),
    assertOAuthError("GSC_OAUTH_CONFIGURATION", [GOOGLE_CLIENT_SECRET]),
  );
});

test("begin creates one owner-bound intent and returns only a fixed-origin ticket URL", async () => {
  const calls: unknown[] = [];
  const state = connection();
  const service = createGscOAuthService(dependencies({
    repository: repository({
      ensureConnection: async (input) => {
        calls.push(["ensure", input]);
        return state;
      },
      beginConnectionIntent: async (input) => {
        calls.push(["intent", input]);
        return {
          flowId: FLOW_ID,
          userId: USER_ID,
          connectionId: CONNECTION_ID,
          expectedGeneration: GENERATION,
          ticketHash: input.ticketHash,
          expiresAt: new Date(NOW_MS + 600_000),
        };
      },
    }),
  }));
  const result = await service.beginConnection({ userId: USER_ID });
  const url = new URL(result.connectionUrl);
  assert.equal(url.origin + url.pathname, GSC_CONNECTION_URL);
  assert.equal(url.searchParams.has("gsc_ticket"), true);
  assert.equal(url.searchParams.size, 1);
  assert.equal(result.connection, state);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["ensure", {
    userId: USER_ID,
    googleClientId: GOOGLE_CLIENT_ID,
  }]);
  const serialized = JSON.stringify(result);
  for (const forbidden of [GOOGLE_CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("start stores hashed state/session/nonce and encrypted PKCE before returning fixed Google URL", async () => {
  const crypto = credentialService();
  let stored: Parameters<GscRepository["startOAuthFromIntent"]>[0] | undefined;
  const service = createGscOAuthService(dependencies({
    credentialService: crypto,
    repository: repository({
      startOAuthFromIntent: async (input) => {
        stored = input;
      },
    }),
  }));
  const result = await service.startAuthorization({
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
    ticket: "synthetic-ticket",
    browserSessionProof: BROWSER_SESSION,
  });
  assert.ok(stored);
  const url = new URL(result.authorizationUrl);
  assert.equal(url.origin + url.pathname, GSC_AUTHORIZATION_ENDPOINT);
  assert.equal(url.searchParams.get("client_id"), GOOGLE_CLIENT_ID);
  assert.equal(url.searchParams.get("redirect_uri"), GSC_OAUTH_REDIRECT_URI);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), `openid email ${GSC_READONLY_SCOPE}`);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.has("state"), true);
  assert.equal(url.searchParams.has("nonce"), true);
  const state = url.searchParams.get("state") as string;
  const nonce = url.searchParams.get("nonce") as string;
  assert.equal(stored.stateHash, crypto.hashOpaqueProof("state", state));
  assert.equal(
    stored.sessionProofHash,
    crypto.hashOpaqueProof("browser_session", BROWSER_SESSION),
  );
  assert.equal(stored.oidcNonceHash, crypto.hashOpaqueProof("oidc_nonce", nonce));
  const verifier = crypto.decryptPkceVerifier(
    {
      userId: USER_ID,
      connectionId: CONNECTION_ID,
      googleClientId: GOOGLE_CLIENT_ID,
      redirectUri: GSC_OAUTH_REDIRECT_URI,
      generation: GENERATION,
      browserSessionHash: stored.sessionProofHash,
      stateHash: stored.stateHash,
      formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
    },
    stored.encryptedPkceVerifier,
  );
  assert.equal(verifier.length >= 43 && verifier.length <= 128, true);
  assert.equal(
    url.searchParams.get("code_challenge"),
    createHash("sha256").update(verifier, "ascii").digest("base64url"),
  );
  const storedText = JSON.stringify(stored);
  for (const raw of ["synthetic-ticket", state, nonce, BROWSER_SESSION, verifier]) {
    assert.equal(storedText.includes(raw), false);
  }
});

test("callback claims before exchange, verifies a real RSA signature, and persists only encrypted durable credentials", async () => {
  const fixture = callbackFixture();
  const service = createGscOAuthService(dependencies({
    repository: fixture.repo,
    credentialService: fixture.crypto,
    transport: fixture.upstream,
  }));
  const result = await service.handleCallback(callbackInput());
  assert.deepEqual(fixture.events, ["acquire", "token", "jwks", "complete"]);
  assert.equal(result.displayEmail, DISPLAY_EMAIL);
  const completed = fixture.completedInput();
  assert.ok(completed);
  assert.equal(
    completed.googleSubjectHash,
    fixture.crypto.hashGoogleSubject(GOOGLE_CLIENT_ID, GOOGLE_SUBJECT),
  );
  const opened = fixture.crypto.decryptCredentialEnvelope(
    {
      userId: USER_ID,
      connectionId: CONNECTION_ID,
      googleClientId: GOOGLE_CLIENT_ID,
      generation: GENERATION,
      formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
    },
    completed.credentialEnvelope,
  );
  assert.deepEqual(opened, {
    refreshToken: REFRESH_TOKEN,
    googleSubject: GOOGLE_SUBJECT,
    displayEmail: DISPLAY_EMAIL,
    grantedScopes: ["openid", GSC_EMAIL_SCOPE, GSC_READONLY_SCOPE],
  });
  const persisted = JSON.stringify(completed);
  assert.equal(persisted.includes(ACCESS_TOKEN), false);
  assert.equal(persisted.includes(REFRESH_TOKEN), false);
  assert.equal(persisted.includes(GOOGLE_SUBJECT), false);
  const tokenRequest = fixture.requests[0];
  assert.equal(tokenRequest.url, GSC_TOKEN_ENDPOINT);
  assert.equal(tokenRequest.deadline, fixture.requests[1].deadline);
  const tokenForm = new URLSearchParams(tokenRequest.body);
  assert.equal(tokenForm.get("code"), AUTHORIZATION_CODE);
  assert.equal(tokenForm.get("code_verifier"), VERIFIER);
  assert.equal(tokenForm.get("redirect_uri"), GSC_OAUTH_REDIRECT_URI);
});

for (const [label, changedClaims] of [
  ["issuer", { iss: "https://issuer.invalid" }],
  ["audience", { aud: "other-client" }],
  ["expiration", { exp: Math.floor(NOW_MS / 1000) }],
  ["nonce", { nonce: "other-nonce" }],
  ["subject", { sub: "" }],
] as const) {
  test(`callback rejects a correctly signed ID token with invalid ${label}`, async () => {
    const fixture = callbackFixture({ claims: changedClaims });
    const service = createGscOAuthService(dependencies({
      repository: fixture.repo,
      credentialService: fixture.crypto,
      transport: fixture.upstream,
    }));
    await assert.rejects(
      service.handleCallback(callbackInput()),
      assertOAuthError("GSC_OAUTH_ID_TOKEN_REJECTED", [AUTHORIZATION_CODE]),
    );
    assert.deepEqual(fixture.events, ["acquire", "token", "jwks"]);
    assert.equal(fixture.completedInput(), undefined);
  });
}

test("callback rejects a forged RSA signature", async () => {
  const fixture = callbackFixture({
    mutateToken: (token) => {
      const parts = token.split(".");
      const bytes = Buffer.from(parts[2], "base64url");
      bytes[0] ^= 1;
      parts[2] = bytes.toString("base64url");
      return parts.join(".");
    },
  });
  const service = createGscOAuthService(dependencies({
    repository: fixture.repo,
    credentialService: fixture.crypto,
    transport: fixture.upstream,
  }));
  await assert.rejects(
    service.handleCallback(callbackInput()),
    assertOAuthError("GSC_OAUTH_ID_TOKEN_REJECTED", [AUTHORIZATION_CODE]),
  );
  assert.deepEqual(fixture.events, ["acquire", "token", "jwks"]);
});

for (const scope of [
  `openid ${GSC_EMAIL_SCOPE}`,
  `openid ${GSC_EMAIL_SCOPE} https://www.googleapis.com/auth/webmasters`,
  `openid ${GSC_READONLY_SCOPE}`,
]) {
  test(`callback rejects missing required grant: ${scope}`, async () => {
    const fixture = callbackFixture({
      tokenBody: {
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        id_token: "unused-id-token",
        scope,
      },
    });
    const service = createGscOAuthService(dependencies({
      repository: fixture.repo,
      credentialService: fixture.crypto,
      transport: fixture.upstream,
    }));
    await assert.rejects(
      service.handleCallback(callbackInput()),
      assertOAuthError("GSC_OAUTH_SCOPE_REJECTED", [ACCESS_TOKEN]),
    );
    assert.deepEqual(fixture.events, ["acquire", "token"]);
    assert.equal(fixture.completedInput(), undefined);
  });
}

test("malformed successful token response is reported as an upstream format failure", async () => {
  const fixture = callbackFixture({
    tokenBody: {
      access_token: ACCESS_TOKEN,
      id_token: "unused-id-token",
      scope: `openid ${GSC_EMAIL_SCOPE} ${GSC_READONLY_SCOPE}`,
    },
  });
  const service = createGscOAuthService(dependencies({
    repository: fixture.repo,
    credentialService: fixture.crypto,
    transport: fixture.upstream,
  }));
  await assert.rejects(
    service.handleCallback(callbackInput()),
    assertOAuthError("GSC_UPSTREAM_INVALID_RESPONSE", [ACCESS_TOKEN]),
  );
  assert.deepEqual(fixture.events, ["acquire", "token"]);
});

test("wrong owner/session and replay are rejected before any further Google exchange", async () => {
  const crypto = credentialService();
  let acquireCount = 0;
  let exchangeCount = 0;
  const repo = repository({
    acquireOAuthProcessing: async () => {
      acquireCount += 1;
      if (acquireCount > 1) return rejected();
      return claimedFlow(crypto);
    },
  });
  const upstream = transport(async () => {
    exchangeCount += 1;
    return { status: 400, body: { error: "invalid_grant" } };
  });
  const service = createGscOAuthService(dependencies({
    repository: repo,
    credentialService: crypto,
    transport: upstream,
  }));
  await assert.rejects(
    service.handleCallback(callbackInput()),
    assertOAuthError("GSC_UPSTREAM_REJECTED", [AUTHORIZATION_CODE]),
  );
  await assert.rejects(service.handleCallback(callbackInput()), GscRepositoryError);
  assert.equal(exchangeCount, 1);

  const rejectedBeforeExchange = createGscOAuthService(dependencies({
    repository: repository({
      acquireOAuthProcessing: async () => rejected(),
    }),
    credentialService: crypto,
    transport: transport(async () => {
      assert.fail("Google exchange must not run");
    }),
  }));
  await assert.rejects(
    rejectedBeforeExchange.handleCallback({
      ...callbackInput(),
      browserSessionProof: "wrong-session",
    }),
    GscRepositoryError,
  );
});

test("callback rejects an envelope bound to another member before exchange", async () => {
  const crypto = credentialService();
  const flow = claimedFlow(crypto);
  const memberBEnvelope = crypto.encryptPkceVerifier(
    {
      userId: "member-b",
      connectionId: CONNECTION_ID,
      googleClientId: GOOGLE_CLIENT_ID,
      redirectUri: GSC_OAUTH_REDIRECT_URI,
      generation: GENERATION,
      browserSessionHash: flow.sessionProofHash,
      stateHash: flow.stateHash,
      formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
    },
    VERIFIER,
  );
  let requests = 0;
  const service = createGscOAuthService(dependencies({
    credentialService: crypto,
    repository: repository({
      acquireOAuthProcessing: async () => ({
        ...flow,
        encryptedPkceVerifier: memberBEnvelope,
      }),
    }),
    transport: transport(async () => {
      requests += 1;
      return { status: 200, body: {} };
    }),
  }));
  await assert.rejects(service.handleCallback(callbackInput()));
  assert.equal(requests, 0);
});

test("callback rejects mismatched claimed-flow owner metadata before decrypt or exchange", async () => {
  const crypto = credentialService();
  let requests = 0;
  const service = createGscOAuthService(dependencies({
    credentialService: crypto,
    repository: repository({
      acquireOAuthProcessing: async () => ({
        ...claimedFlow(crypto),
        userId: "member-b",
      }),
    }),
    transport: transport(async () => {
      requests += 1;
      return { status: 200, body: {} };
    }),
  }));
  await assert.rejects(
    service.handleCallback(callbackInput()),
    assertOAuthError("GSC_OAUTH_REJECTED"),
  );
  assert.equal(requests, 0);
});

test("a flow that expires while the atomic claim returns is rejected before PKCE decrypt or Google exchange", async () => {
  const crypto = credentialService();
  let nowMs = NOW_MS;
  let decrypts = 0;
  let requests = 0;
  const observedCrypto: GscCredentialService = {
    ...crypto,
    decryptPkceVerifier: (...args) => {
      decrypts += 1;
      return crypto.decryptPkceVerifier(...args);
    },
  };
  const flow = {
    ...claimedFlow(crypto),
    expiresAt: new Date(NOW_MS + 10),
  };
  const service = createGscOAuthService(dependencies({
    credentialService: observedCrypto,
    repository: repository({
      acquireOAuthProcessing: async () => {
        nowMs = NOW_MS + 10;
        return flow;
      },
    }),
    transport: transport(async () => {
      requests += 1;
      return { status: 200, body: {} };
    }),
    now: () => nowMs,
  }));
  await assert.rejects(
    service.handleCallback(callbackInput(createGscOperationDeadline(NOW_MS))),
    assertOAuthError("GSC_OAUTH_REJECTED"),
  );
  assert.equal(decrypts, 0);
  assert.equal(requests, 0);
});

test("Google access denial atomically claims and cancels the flow without exchanging a code, and cannot replay", async () => {
  const crypto = credentialService();
  const events: string[] = [];
  let claims = 0;
  const repo = repository({
    acquireOAuthProcessing: async () => {
      claims += 1;
      events.push("claim");
      if (claims > 1) return rejected();
      return claimedFlow(crypto);
    },
    cancelOAuthFlow: async (input) => {
      events.push(`cancel:${input.flowId}`);
    },
  });
  let requests = 0;
  const service = createGscOAuthService(dependencies({
    repository: repo,
    credentialService: crypto,
    transport: transport(async () => {
      requests += 1;
      return { status: 200, body: {} };
    }),
  }));
  assert.deepEqual(
    await service.handleAuthorizationDenied({
      userId: USER_ID,
      connectionId: CONNECTION_ID,
      generation: GENERATION,
      state: STATE,
      browserSessionProof: BROWSER_SESSION,
    }),
    { cancelled: true },
  );
  await assert.rejects(service.handleAuthorizationDenied({
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
    state: STATE,
    browserSessionProof: BROWSER_SESSION,
  }), GscRepositoryError);
  assert.deepEqual(events, ["claim", `cancel:${FLOW_ID}`, "claim"]);
  assert.equal(requests, 0);
});

test("refresh uses the owner DB lock, returns a request-local access token, and atomically replaces the envelope", async () => {
  const crypto = credentialService();
  const active = activeConnection(crypto);
  const events: string[] = [];
  let replaced: GscEncryptedEnvelope | undefined;
  const repo = repository({
    withRefreshLock: async (input, operation) => {
      events.push(`lock:${input.userId}:${input.connectionId}:${input.generation}`);
      return operation({
        connection: active,
        replaceCredentialEnvelope: async (envelope) => {
          events.push("replace");
          replaced = envelope;
          return activeConnection(crypto, envelope);
        },
        markReauthorizationRequired: async () => rejected(),
      });
    },
  });
  const service = createGscOAuthService(dependencies({
    repository: repo,
    credentialService: crypto,
    transport: transport(async (request) => {
      events.push("refresh");
      assert.equal(request.url, GSC_TOKEN_ENDPOINT);
      const form = new URLSearchParams(request.body);
      assert.equal(form.get("refresh_token"), REFRESH_TOKEN);
      return {
        status: 200,
        body: {
          access_token: ACCESS_TOKEN,
          scope: `openid email ${GSC_READONLY_SCOPE}`,
        },
      };
    }),
  }));
  const result = await service.refreshCredential({
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
  });
  assert.deepEqual(events, [
    `lock:${USER_ID}:${CONNECTION_ID}:${GENERATION}`,
    "refresh",
    "replace",
  ]);
  assert.equal(result.accessToken, ACCESS_TOKEN);
  assert.ok(replaced);
  assert.deepEqual(
    crypto.decryptCredentialEnvelope(
      {
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        googleClientId: GOOGLE_CLIENT_ID,
        generation: GENERATION,
        formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
      },
      replaced,
    ),
    {
      refreshToken: REFRESH_TOKEN,
      googleSubject: GOOGLE_SUBJECT,
      displayEmail: DISPLAY_EMAIL,
      grantedScopes: ["openid", "email", GSC_READONLY_SCOPE],
    },
  );
});

for (const response of [
  { status: 400, body: { error: "invalid_grant" } },
  { status: 200, body: { access_token: ACCESS_TOKEN, scope: `openid ${GSC_EMAIL_SCOPE}` } },
]) {
  test("invalid refresh or reduced permission marks only the same connection for reauthorization", async () => {
    const crypto = credentialService();
    const active = activeConnection(crypto);
    const events: string[] = [];
    const repo = repository({
      withRefreshLock: async (_input, operation) => operation({
        connection: active,
        replaceCredentialEnvelope: async () => {
          assert.fail("ineligible refresh must not replace credentials");
        },
        markReauthorizationRequired: async () => {
          events.push(`mark:${USER_ID}:${CONNECTION_ID}:${GENERATION}`);
          return { ...connection("reauthorization_required") };
        },
      }),
    });
    const service = createGscOAuthService(dependencies({
      repository: repo,
      credentialService: crypto,
      transport: transport(async () => {
        events.push("request");
        return response;
      }),
    }));
    await assert.rejects(
      service.refreshCredential({
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        generation: GENERATION,
      }),
      assertOAuthError("GSC_OAUTH_REAUTHORIZATION_REQUIRED", [REFRESH_TOKEN]),
    );
    assert.deepEqual(events, [
      "request",
      `mark:${USER_ID}:${CONNECTION_ID}:${GENERATION}`,
    ]);
  });
}

test("refresh rejects cross-member repository access before decrypt or Google request", async () => {
  let requests = 0;
  const service = createGscOAuthService(dependencies({
    repository: repository({ withRefreshLock: async () => rejected() }),
    transport: transport(async () => {
      requests += 1;
      return { status: 200, body: {} };
    }),
  }));
  await assert.rejects(
    service.refreshCredential({
      userId: "member-b",
      connectionId: CONNECTION_ID,
      generation: GENERATION,
    }),
    assertOAuthError("GSC_OAUTH_REJECTED"),
  );
  assert.equal(requests, 0);
});

for (const code of [
  "GSC_UPSTREAM_TIMEOUT",
  "GSC_UPSTREAM_REDIRECT",
  "GSC_UPSTREAM_RESPONSE_TOO_LARGE",
  "GSC_UPSTREAM_INVALID_RESPONSE",
  "GSC_UPSTREAM_REJECTED",
] as const) {
  test(`refresh preserves safe ${code} after repository error masking`, async () => {
    const crypto = credentialService();
    const active = activeConnection(crypto);
    const repo = repository({
      withRefreshLock: async (_input, operation) => {
        try {
          return await operation({
            connection: active,
            replaceCredentialEnvelope: async () => rejected(),
            markReauthorizationRequired: async () => rejected(),
          });
        } catch {
          return rejected();
        }
      },
    });
    const service = createGscOAuthService(dependencies({
      repository: repo,
      credentialService: crypto,
      transport: transport(async () => {
        if (code === "GSC_UPSTREAM_REJECTED") {
          return { status: 503, body: { error: "temporarily_unavailable" } };
        }
        throw new GscOAuthError(code);
      }),
    }));
    await assert.rejects(
      service.refreshCredential({
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        generation: GENERATION,
      }),
      assertOAuthError(code, [REFRESH_TOKEN, GOOGLE_CLIENT_SECRET]),
    );
  });
}

test("invalid grant changes status while holding the same refresh lock so a queued refresh cannot overwrite it", async () => {
  const crypto = credentialService();
  const active = activeConnection(crypto);
  const events: string[] = [];
  let activeStatus = true;
  let tail = Promise.resolve();
  const repo = repository({
    withRefreshLock: async (_input, operation) => {
      const previous = tail;
      let releaseCurrent = () => undefined;
      tail = new Promise<void>((resolve) => {
        releaseCurrent = resolve;
      });
      await previous;
      events.push("lock-enter");
      try {
        if (!activeStatus) return rejected();
        return await operation({
          connection: active,
          replaceCredentialEnvelope: async () => {
            events.push("replace");
            return active;
          },
          markReauthorizationRequired: async () => {
            events.push("mark-reauthorization");
            activeStatus = false;
            return connection("reauthorization_required");
          },
        });
      } catch {
        return rejected();
      } finally {
        events.push("lock-exit");
        releaseCurrent();
      }
    },
  });
  let finishFirstRequest = (_value: {
    status: number;
    body: Record<string, unknown>;
  }) => undefined;
  let requests = 0;
  const firstResponse = new Promise<{
    status: number;
    body: Record<string, unknown>;
  }>((resolve) => {
    finishFirstRequest = resolve;
  });
  const service = createGscOAuthService(dependencies({
    repository: repo,
    credentialService: crypto,
    transport: transport(async () => {
      requests += 1;
      events.push(`request-${requests}`);
      return firstResponse;
    }),
  }));
  const first = service.refreshCredential({
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
  });
  while (requests !== 1) await Promise.resolve();
  const second = service.refreshCredential({
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
  });
  finishFirstRequest({ status: 400, body: { error: "invalid_grant" } });
  await assert.rejects(
    first,
    assertOAuthError("GSC_OAUTH_REAUTHORIZATION_REQUIRED"),
  );
  await assert.rejects(second, assertOAuthError("GSC_OAUTH_REJECTED"));
  assert.equal(requests, 1);
  assert.equal(events.indexOf("mark-reauthorization") < events.indexOf("lock-exit"), true);
  assert.deepEqual(events, [
    "lock-enter",
    "request-1",
    "mark-reauthorization",
    "lock-exit",
    "lock-enter",
    "lock-exit",
  ]);
});

test("an upper tool deadline prevents a late repository completion from being delivered as callback success", async () => {
  let nowMs = NOW_MS;
  const fixture = callbackFixture();
  const delayedRepo = repository({
    acquireOAuthProcessing: fixture.repo.acquireOAuthProcessing,
    completeOAuthBinding: async (input) => {
      nowMs = NOW_MS + GSC_OPERATION_TIMEOUT_MS;
      return activeConnection(fixture.crypto, input.credentialEnvelope);
    },
  });
  const service = createGscOAuthService(dependencies({
    repository: delayedRepo,
    credentialService: fixture.crypto,
    transport: fixture.upstream,
    now: () => nowMs,
  }));
  await assert.rejects(
    service.handleCallback(callbackInput(createGscOperationDeadline(NOW_MS))),
    assertOAuthError("GSC_OPERATION_TIMEOUT"),
  );
});

test("browser callback without a tool deadline can cross 45 seconds while each external request remains under 10 seconds", async () => {
  let nowMs = NOW_MS;
  const fixture = callbackFixture();
  const requestDurations: number[] = [];
  const delayedRepository = repository({
    acquireOAuthProcessing: async (input) => {
      nowMs += 20_000;
      return fixture.repo.acquireOAuthProcessing(input);
    },
    completeOAuthBinding: async (input) => {
      nowMs += 10_000;
      return activeConnection(fixture.crypto, input.credentialEnvelope);
    },
  });
  const service = createGscOAuthService(dependencies({
    repository: delayedRepository,
    credentialService: fixture.crypto,
    transport: transport(async (request) => {
      const requestStartedAt = nowMs;
      const response = await fixture.upstream.request(request);
      nowMs += 8_000;
      requestDurations.push(nowMs - requestStartedAt);
      return response;
    }),
    now: () => nowMs,
  }));
  const result = await service.handleCallback(callbackInput());
  assert.equal(result.connection.status, "active");
  assert.equal(nowMs - NOW_MS, 46_000);
  assert.deepEqual(requestDurations, [8_000, 8_000]);
  assert.equal(
    requestDurations.every((duration) =>
      duration < GSC_UPSTREAM_REQUEST_TIMEOUT_MS
    ),
    true,
  );
});

test("an upper tool deadline prevents a late refresh write from being delivered as success", async () => {
  let nowMs = NOW_MS;
  const crypto = credentialService();
  const active = activeConnection(crypto);
  const repo = repository({
    withRefreshLock: async (_input, operation) => operation({
      connection: active,
      replaceCredentialEnvelope: async (envelope) => {
        nowMs = NOW_MS + GSC_OPERATION_TIMEOUT_MS;
        return activeConnection(crypto, envelope);
      },
      markReauthorizationRequired: async () => rejected(),
    }),
  });
  const service = createGscOAuthService(dependencies({
    repository: repo,
    credentialService: crypto,
    transport: transport(async () => ({
      status: 200,
      body: { access_token: ACCESS_TOKEN },
    })),
    now: () => nowMs,
  }));
  await assert.rejects(
    service.refreshCredential({
      userId: USER_ID,
      connectionId: CONNECTION_ID,
      generation: GENERATION,
      deadline: createGscOperationDeadline(NOW_MS),
    }),
    assertOAuthError("GSC_OPERATION_TIMEOUT"),
  );
});

test("disconnect commits local invalidation before exactly one revocation attempt", async () => {
  const crypto = credentialService();
  const active = activeConnection(crypto);
  const events: string[] = [];
  const service = createGscOAuthService(dependencies({
    repository: repository({
      disconnectConnection: async () => {
        events.push("local-disconnect");
        return {
          userId: USER_ID,
          connectionId: CONNECTION_ID,
          previousGeneration: GENERATION,
          generation: GENERATION + 1,
          credentialEnvelope: active.credentialEnvelope,
        };
      },
    }),
    credentialService: crypto,
    transport: transport(async (request) => {
      events.push("revoke");
      assert.equal(request.url, GSC_REVOCATION_ENDPOINT);
      assert.equal(new URLSearchParams(request.body).get("token"), REFRESH_TOKEN);
      return { status: 200, body: undefined };
    }),
  }));
  const result = await service.disconnect({
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
  });
  assert.deepEqual(events, ["local-disconnect", "revoke"]);
  assert.deepEqual(result, {
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION + 1,
    localDisconnected: true,
    googleRevocation: "confirmed",
  });
});

test("browser disconnect without a tool deadline still revokes once after a 45-second local wait", async () => {
  let nowMs = NOW_MS;
  const crypto = credentialService();
  const active = activeConnection(crypto);
  const requestDurations: number[] = [];
  let attempts = 0;
  const service = createGscOAuthService(dependencies({
    repository: repository({
      disconnectConnection: async () => {
        nowMs += 46_000;
        return {
          userId: USER_ID,
          connectionId: CONNECTION_ID,
          previousGeneration: GENERATION,
          generation: GENERATION + 1,
          credentialEnvelope: active.credentialEnvelope,
        };
      },
    }),
    credentialService: crypto,
    transport: transport(async () => {
      attempts += 1;
      const requestStartedAt = nowMs;
      nowMs += 8_000;
      requestDurations.push(nowMs - requestStartedAt);
      return { status: 200, body: undefined };
    }),
    now: () => nowMs,
  }));
  const result = await service.disconnect({
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
  });
  assert.equal(attempts, 1);
  assert.deepEqual(requestDurations, [8_000]);
  assert.equal(result.localDisconnected, true);
  assert.equal(result.googleRevocation, "confirmed");
});

test("revocation failure remains locally disconnected and is neither retried nor overstated", async () => {
  const crypto = credentialService();
  const active = activeConnection(crypto);
  let attempts = 0;
  const service = createGscOAuthService(dependencies({
    repository: repository({
      disconnectConnection: async () => ({
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        previousGeneration: GENERATION,
        generation: GENERATION + 1,
        credentialEnvelope: active.credentialEnvelope,
      }),
    }),
    credentialService: crypto,
    transport: transport(async () => {
      attempts += 1;
      throw new GscOAuthError("GSC_UPSTREAM_TIMEOUT");
    }),
  }));
  const result = await service.disconnect({
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
  });
  assert.equal(attempts, 1);
  assert.equal(result.localDisconnected, true);
  assert.equal(result.googleRevocation, "unconfirmed");
});

test("disconnecting an authorization-in-progress connection needs no Google revocation", async () => {
  let attempts = 0;
  const service = createGscOAuthService(dependencies({
    repository: repository({
      disconnectConnection: async () => ({
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        previousGeneration: GENERATION,
        generation: GENERATION + 1,
        credentialEnvelope: null,
      }),
    }),
    transport: transport(async () => {
      attempts += 1;
      return { status: 200, body: undefined };
    }),
  }));
  const result = await service.disconnect({
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
  });
  assert.equal(attempts, 0);
  assert.equal(result.googleRevocation, "not_applicable");
});

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("transport keeps the 10-second timer active while a streamed body is stalled", async () => {
  let timerCallback: (() => void) | undefined;
  let timerDelay = 0;
  let cleared = false;
  let fetched = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from("{\"partial\":"));
    },
  });
  const bounded = createGscUpstreamTransport({
    fetch: async () => {
      fetched = true;
      return new Response(body, { status: 200 });
    },
    now: () => 0,
    setTimer: (callback, delay) => {
      timerCallback = callback;
      timerDelay = delay;
      return 1;
    },
    clearTimer: () => {
      cleared = true;
    },
  });
  const pending = bounded.request({
    url: GSC_TOKEN_ENDPOINT,
    method: "GET",
    responseType: "json",
    deadline: createGscOperationDeadline(0),
  });
  while (!fetched) await Promise.resolve();
  assert.equal(cleared, false);
  assert.equal(timerDelay, GSC_UPSTREAM_REQUEST_TIMEOUT_MS);
  timerCallback?.();
  await assert.rejects(
    pending,
    assertOAuthError("GSC_UPSTREAM_TIMEOUT", [AUTHORIZATION_CODE]),
  );
  assert.equal(cleared, true);
});

test("transport rejects an oversized stream without relying on Content-Length", async () => {
  let calls = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(GSC_UPSTREAM_MAX_BODY_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const bounded = createGscUpstreamTransport({
    fetch: async () => {
      calls += 1;
      return new Response(body, { status: 200 });
    },
  });
  await assert.rejects(
    bounded.request({
      url: GSC_JWKS_ENDPOINT,
      method: "GET",
      responseType: "json",
      deadline: createGscOperationDeadline(),
    }),
    assertOAuthError("GSC_UPSTREAM_RESPONSE_TOO_LARGE"),
  );
  assert.equal(calls, 1);
});

test("transport rejects declared oversize, redirect, invalid UTF-8, and invalid JSON without retry", async (context) => {
  const cases: ReadonlyArray<{
    name: string;
    response: () => Response;
    code: GscOAuthErrorCode;
  }> = [
    {
      name: "declared oversize",
      response: () => new Response("{}", {
        status: 200,
        headers: { "content-length": String(GSC_UPSTREAM_MAX_BODY_BYTES + 1) },
      }),
      code: "GSC_UPSTREAM_RESPONSE_TOO_LARGE",
    },
    {
      name: "redirect",
      response: () => new Response(null, {
        status: 302,
        headers: { location: "https://attacker.invalid" },
      }),
      code: "GSC_UPSTREAM_REDIRECT",
    },
    {
      name: "invalid UTF-8",
      response: () => new Response(new Uint8Array([0xc3, 0x28]), { status: 200 }),
      code: "GSC_UPSTREAM_INVALID_RESPONSE",
    },
    {
      name: "invalid JSON",
      response: () => new Response("not-json", { status: 200 }),
      code: "GSC_UPSTREAM_INVALID_RESPONSE",
    },
  ];
  for (const item of cases) {
    await context.test(item.name, async () => {
      let calls = 0;
      let redirectMode: RequestRedirect | undefined;
      const bounded = createGscUpstreamTransport({
        fetch: async (_url, init) => {
          calls += 1;
          redirectMode = init?.redirect;
          return item.response();
        },
      });
      await assert.rejects(
        bounded.request({
          url: GSC_JWKS_ENDPOINT,
          method: "GET",
          responseType: "json",
          deadline: createGscOperationDeadline(),
        }),
        assertOAuthError(item.code),
      );
      assert.equal(calls, 1);
      assert.equal(redirectMode, "manual");
    });
  }
});

test("one operation deadline is shared and reduces the JWKS request budget", async () => {
  let nowMs = 0;
  const delays: number[] = [];
  const bounded = createGscUpstreamTransport({
    fetch: async () => jsonResponse({ keys: [] }),
    now: () => nowMs,
    setTimer: (_callback, delay) => {
      delays.push(delay);
      return delays.length;
    },
    clearTimer: () => undefined,
  });
  const operationDeadline = createGscOperationDeadline(0);
  await bounded.request({
    url: GSC_TOKEN_ENDPOINT,
    method: "GET",
    responseType: "json",
    deadline: operationDeadline,
  });
  nowMs = 41_000;
  await bounded.request({
    url: GSC_JWKS_ENDPOINT,
    method: "GET",
    responseType: "json",
    deadline: operationDeadline,
  });
  assert.deepEqual(delays, [GSC_UPSTREAM_REQUEST_TIMEOUT_MS, 4_000]);
  nowMs = GSC_OPERATION_TIMEOUT_MS;
  await assert.rejects(
    bounded.request({
      url: GSC_JWKS_ENDPOINT,
      method: "GET",
      responseType: "json",
      deadline: operationDeadline,
    }),
    assertOAuthError("GSC_OPERATION_TIMEOUT"),
  );
  assert.equal(delays.length, 2);
});

test("callback JWKS retrieval uses the bounded transport and a shared 45-second deadline", async () => {
  const fixture = callbackFixture();
  const deadline = createGscOperationDeadline(NOW_MS);
  const service = createGscOAuthService(dependencies({
    repository: fixture.repo,
    credentialService: fixture.crypto,
    transport: fixture.upstream,
  }));
  await service.handleCallback(callbackInput(deadline));
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.requests[0].deadline, deadline);
  assert.equal(fixture.requests[1].deadline, deadline);
  assert.equal(fixture.requests[1].url, GSC_JWKS_ENDPOINT);
});

test("callback JWKS streaming is covered by the same bounded-request timer", async () => {
  const crypto = credentialService();
  const signing = rsaFixture();
  const token = signedIdToken(signing.privateKey, claims());
  const timerCallbacks: Array<() => void> = [];
  const requestedUrls: string[] = [];
  const stalledJwksBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from("{\"keys\":"));
    },
  });
  const bounded = createGscUpstreamTransport({
    fetch: async (url) => {
      requestedUrls.push(String(url));
      if (String(url) === GSC_TOKEN_ENDPOINT) {
        return jsonResponse({
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          id_token: token,
          scope: `openid ${GSC_EMAIL_SCOPE} ${GSC_READONLY_SCOPE}`,
        });
      }
      return new Response(stalledJwksBody, { status: 200 });
    },
    now: () => NOW_MS,
    setTimer: (callback) => {
      timerCallbacks.push(callback);
      return timerCallbacks.length;
    },
    clearTimer: () => undefined,
  });
  let completed = false;
  const service = createGscOAuthService(dependencies({
    repository: repository({
      acquireOAuthProcessing: async () => claimedFlow(crypto),
      completeOAuthBinding: async () => {
        completed = true;
        return activeConnection(crypto);
      },
    }),
    credentialService: crypto,
    transport: bounded,
  }));
  const pending = service.handleCallback(callbackInput());
  while (requestedUrls.length < 2) await Promise.resolve();
  timerCallbacks[1]();
  await assert.rejects(
    pending,
    assertOAuthError("GSC_UPSTREAM_TIMEOUT", [AUTHORIZATION_CODE]),
  );
  assert.deepEqual(requestedUrls, [GSC_TOKEN_ENDPOINT, GSC_JWKS_ENDPOINT]);
  assert.equal(completed, false);
});

test("expired whole-operation deadline fails before exchange", async () => {
  let requests = 0;
  const crypto = credentialService();
  const service = createGscOAuthService(dependencies({
    repository: repository({
      acquireOAuthProcessing: async () => claimedFlow(crypto),
    }),
    credentialService: crypto,
    transport: transport(async () => {
      requests += 1;
      return { status: 200, body: {} };
    }),
    now: () => NOW_MS + GSC_OPERATION_TIMEOUT_MS,
  }));
  await assert.rejects(
    service.handleCallback(callbackInput(createGscOperationDeadline(NOW_MS))),
    assertOAuthError("GSC_OPERATION_TIMEOUT"),
  );
  assert.equal(requests, 0);
});
