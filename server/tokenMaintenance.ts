import { and, eq, isNotNull, lt } from "drizzle-orm";
import { oauthTokens } from "../shared/schema";
import { db } from "./db";
import {
  getOwnedGoogleToken,
  type GoogleTokenService,
} from "./autoTokenFix";
import { secureTokenService } from "./secureTokenService";

interface TokenMaintenanceDependencies {
  listExpiringGoogleTokenOwners(cutoff: Date): Promise<string[]>;
  tokenService: GoogleTokenService;
  now(): Date;
}

const defaultDependencies: TokenMaintenanceDependencies = {
  async listExpiringGoogleTokenOwners(cutoff: Date): Promise<string[]> {
    const rows = await db
      .select({ userId: oauthTokens.userId })
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.provider, "google"),
          isNotNull(oauthTokens.expiresAt),
          lt(oauthTokens.expiresAt, cutoff),
        ),
      );
    return Array.from(new Set(rows.map((row) => row.userId)));
  },
  tokenService: secureTokenService,
  now: () => new Date(),
};

export class TokenMaintenanceService {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly dependencies: TokenMaintenanceDependencies = defaultDependencies,
  ) {}

  start(): void {
    console.log("[TOKEN-MAINTENANCE] 啟動自動 token 維護服務");
    void this.maintainTokens();
    this.intervalId = setInterval(() => {
      void this.maintainTokens();
    }, 60 * 60 * 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[TOKEN-MAINTENANCE] 停止自動 token 維護服務");
    }
  }

  private async maintainTokens(): Promise<number> {
    try {
      const now = this.dependencies.now();
      const cutoff = new Date(now.getTime() + 6 * 60 * 60 * 1000);
      const ownerIds = await this.dependencies.listExpiringGoogleTokenOwners(cutoff);
      if (ownerIds.length === 0) {
        return 0;
      }

      const newExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      let updated = 0;
      for (const ownerId of ownerIds) {
        const token = await getOwnedGoogleToken(
          ownerId,
          this.dependencies.tokenService,
        );
        if (!token) {
          continue;
        }
        await this.dependencies.tokenService.storeToken(ownerId, "google", {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: newExpiry,
        });
        updated += 1;
      }

      console.log("[TOKEN-MAINTENANCE] 已更新 Google token 到期時間，數量：", updated);
      return updated;
    } catch (error: unknown) {
      console.error(
        "[TOKEN-MAINTENANCE] 自動維護失敗:",
        error instanceof Error ? error.message : "未知錯誤",
      );
      return 0;
    }
  }

  async runMaintenance(): Promise<number> {
    return this.maintainTokens();
  }
}

export const tokenMaintenance = new TokenMaintenanceService();
