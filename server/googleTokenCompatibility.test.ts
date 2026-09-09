import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  batchFixExpiredTokens,
  clearGoogleTokenForOwner,
  forceFixUserToken,
  getOwnedGoogleToken,
  sendAdminBatchFixResult,
  sendEmergencyBatchFixResult,
  type GoogleTokenService,
  type TokenFixResponse,
} from "./autoTokenFix";
import {
  SecureTokenService,
  secureTokenService,
  type SecureTokenPersistence,
  type StoredTokenRecord,
  type TokenData,
} from "./secureTokenService";
import { TokenMaintenanceService } from "./tokenMaintenance";

class FakeGoogleTokenService implements GoogleTokenService {
  token: TokenData | null = null;
  readonly calls: Array<{ action: string; userId: string; provider: string }> = [];
  stored: Pick<TokenData, "accessToken" | "refreshToken" | "expiresAt"> | null = null;
  storeError: Error | null = null;

  async getToken(userId: string, provider: "google"): Promise<TokenData | null> {
    this.calls.push({ action: "get", userId, provider });
    return this.token;
  }

  async storeToken(
    userId: string,
    provider: "google",
    token: Pick<TokenData, "accessToken" | "refreshToken" | "expiresAt">,
  ): Promise<void> {
    this.calls.push({ action: "store", userId, provider });
    if (this.storeError) {
      throw this.storeError;
    }
    this.stored = token;
  }

  async deleteToken(userId: string, provider: "google"): Promise<void> {
    this.calls.push({ action: "delete", userId, provider });
    this.token = null;
  }
}

class SyntheticTokenPersistence implements SecureTokenPersistence {
  record: StoredTokenRecord | null = null;
  failSave = false;
  failDelete = false;

  async findToken(): Promise<StoredTokenRecord | null> {
    return this.record;
  }

  async saveToken(
    _userId: string,
    _provider: TokenData["provider"],
    token: StoredTokenRecord,
  ): Promise<"inserted" | "updated"> {
    if (this.failSave) {
      throw new Error("synthetic persistence write failure");
    }
    const action = this.record ? "updated" : "inserted";
    this.record = token;
    return action;
  }

  async deleteToken(): Promise<void> {
    if (this.failDelete) {
      throw new Error("synthetic persistence delete failure");
    }
    this.record = null;
  }
}

class ResponseRecorder implements TokenFixResponse {
  statusCode = 200;
  body: unknown;

  status(code: number): TokenFixResponse {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): unknown {
    this.body = body;
    return body;
  }
}

const tokenFor = (
  userId: string,
  overrides: Partial<TokenData> = {},
): TokenData => ({
  accessToken: "synthetic-access-token",
  refreshToken: "synthetic-refresh-token",
  expiresAt: new Date("2026-09-09T00:00:00.000Z"),
  userId,
  provider: "google",
  ...overrides,
});

after(() => {
  secureTokenService.destroy();
});

test("expired Google token is extended for the verified owner and preserves refresh data", async () => {
  const service = new FakeGoogleTokenService();
  service.token = tokenFor("member-a");

  const result = await batchFixExpiredTokens(
    "member-a",
    service,
    () => new Date("2026-09-09T01:00:00.000Z"),
  );

  assert.equal(result.success, true);
  assert.equal(result.fixed, 1);
  assert.deepEqual(service.calls, [
    { action: "get", userId: "member-a", provider: "google" },
    { action: "store", userId: "member-a", provider: "google" },
  ]);
  assert.equal(service.stored?.accessToken, "synthetic-access-token");
  assert.equal(service.stored?.refreshToken, "synthetic-refresh-token");
  assert.equal(service.stored?.expiresAt?.toISOString(), "2026-09-11T01:00:00.000Z");
});

test("owner and provider mismatch fails closed without writing", async () => {
  const service = new FakeGoogleTokenService();
  service.token = tokenFor("member-b");

  assert.equal(await getOwnedGoogleToken("member-a", service), null);
  assert.equal((await batchFixExpiredTokens("member-a", service)).fixed, 0);
  assert.equal(service.calls.some((call) => call.action === "store"), false);

  service.token = tokenFor("member-a", { provider: "google_analytics" });
  assert.equal(await getOwnedGoogleToken("member-a", service), null);
});

test("forced refresh reports storage failure instead of returning success", async () => {
  const service = new FakeGoogleTokenService();
  service.token = tokenFor("member-a");
  service.storeError = new Error("synthetic write failure");

  const result = await forceFixUserToken(
    "member-a",
    service,
    () => new Date("2026-09-09T01:00:00.000Z"),
  );

  assert.deepEqual(result, {
    success: false,
    reason: "storage",
    error: "synthetic write failure",
  });
});

test("actual secure service rolls back Google cache and reports forced persistence failure", async () => {
  const persistence = new SyntheticTokenPersistence();
  const service = new SecureTokenService(persistence);
  const originalExpiry = new Date("2026-09-09T00:00:00.000Z");
  try {
    await service.storeToken("member-a", "google", {
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      expiresAt: originalExpiry,
    });
    persistence.failSave = true;

    const result = await forceFixUserToken(
      "member-a",
      service,
      () => new Date("2026-09-09T01:00:00.000Z"),
    );

    assert.deepEqual(result, {
      success: false,
      reason: "storage",
      error: "synthetic persistence write failure",
    });
    assert.equal(
      (await service.getToken("member-a", "google"))?.expiresAt?.toISOString(),
      originalExpiry.toISOString(),
    );
  } finally {
    service.destroy();
  }
});

test("actual batch failure is returned as HTTP 500 by both mounted route response paths", async () => {
  const persistence = new SyntheticTokenPersistence();
  const service = new SecureTokenService(persistence);
  try {
    await service.storeToken("member-a", "google", {
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      expiresAt: new Date("2026-09-09T00:00:00.000Z"),
    });
    persistence.failSave = true;

    const result = await batchFixExpiredTokens(
      "member-a",
      service,
      () => new Date("2026-09-09T01:00:00.000Z"),
    );
    assert.equal(result.success, false);

    const adminResponse = new ResponseRecorder();
    sendAdminBatchFixResult(adminResponse, result);
    assert.equal(adminResponse.statusCode, 500);
    assert.deepEqual(adminResponse.body, {
      success: false,
      error: "Google token 修復失敗：synthetic persistence write failure",
    });

    const emergencyResponse = new ResponseRecorder();
    sendEmergencyBatchFixResult(emergencyResponse, result, "member@example.com");
    assert.equal(emergencyResponse.statusCode, 500);
    assert.deepEqual(emergencyResponse.body, adminResponse.body);
    assert.equal(
      (await service.getToken("member-a", "google"))?.expiresAt?.toISOString(),
      "2026-09-09T00:00:00.000Z",
    );
  } finally {
    service.destroy();
  }
});

test("actual clear failure restores the verified owner's Google cache and rejects", async () => {
  const persistence = new SyntheticTokenPersistence();
  const service = new SecureTokenService(persistence);
  try {
    await service.storeToken("member-a", "google", {
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      expiresAt: new Date("2026-09-10T00:00:00.000Z"),
    });
    persistence.failDelete = true;

    await assert.rejects(
      clearGoogleTokenForOwner("member-a", service),
      /synthetic persistence delete failure/,
    );
    assert.equal(
      (await service.getToken("member-a", "google"))?.accessToken,
      "synthetic-access-token",
    );
  } finally {
    service.destroy();
  }
});

test("non-Google persistence failure retains the existing cache-only behavior", async () => {
  const persistence = new SyntheticTokenPersistence();
  persistence.failSave = true;
  const service = new SecureTokenService(persistence);
  try {
    await service.storeToken("member-a", "facebook", {
      accessToken: "synthetic-facebook-token",
    });
    assert.equal(
      (await service.getToken("member-a", "facebook"))?.accessToken,
      "synthetic-facebook-token",
    );
  } finally {
    service.destroy();
  }
});

test("clear operation deletes only the verified owner's Google token", async () => {
  const service = new FakeGoogleTokenService();
  service.token = tokenFor("member-a");

  assert.equal(await clearGoogleTokenForOwner("member-a", service), true);
  assert.deepEqual(service.calls, [
    { action: "get", userId: "member-a", provider: "google" },
    { action: "delete", userId: "member-a", provider: "google" },
  ]);
});

test("maintenance updates only owners whose stored token matches owner and provider", async () => {
  const service = new FakeGoogleTokenService();
  const tokens = new Map<string, TokenData>([
    ["member-a", tokenFor("member-a")],
    ["member-b", tokenFor("different-member")],
  ]);
  service.getToken = async (userId: string, provider: "google") => {
    service.calls.push({ action: "get", userId, provider });
    return tokens.get(userId) ?? null;
  };

  const maintenance = new TokenMaintenanceService({
    listExpiringGoogleTokenOwners: async () => ["member-a", "member-b"],
    tokenService: service,
    now: () => new Date("2026-09-09T01:00:00.000Z"),
  });

  assert.equal(await maintenance.runMaintenance(), 1);
  assert.deepEqual(
    service.calls.filter((call) => call.action === "store"),
    [{ action: "store", userId: "member-a", provider: "google" }],
  );
  assert.equal(service.stored?.expiresAt?.toISOString(), "2026-09-10T01:00:00.000Z");
});
