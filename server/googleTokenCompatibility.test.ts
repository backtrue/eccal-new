import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  batchFixExpiredTokens,
  clearGoogleTokenForOwner,
  forceFixUserToken,
  getOwnedGoogleToken,
  type GoogleTokenService,
} from "./autoTokenFix";
import { secureTokenService, type TokenData } from "./secureTokenService";
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
    error: "synthetic write failure",
  });
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
