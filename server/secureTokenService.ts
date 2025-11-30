/**
 * 安全 Token 管理服務
 * 使用數據庫持久化和運行時快取來安全管理 OAuth tokens
 * 支持生產環境重啟後恢復 tokens
 */

import { db } from './db';
import { oauthTokens } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  userId: string;
  provider: 'google' | 'facebook' | 'google_analytics';
}

class SecureTokenService {
  private tokenCache: Map<string, TokenData> = new Map();
  private readonly CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor() {
    // 定期清理過期快取
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, 10 * 60 * 1000); // 每 10 分鐘清理一次
  }

  /**
   * 儲存 OAuth token (安全方式) - 同時存到內存和數據庫
   */
  async storeToken(userId: string, provider: 'google' | 'facebook' | 'google_analytics', tokenData: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }): Promise<void> {
    const cacheKey = `${provider}_${userId}`;
    
    // 存儲到內存快取
    this.tokenCache.set(cacheKey, {
      ...tokenData,
      userId,
      provider,
    });

    // 存儲到數據庫（持久化）
    try {
      // 檢查是否已有記錄
      const existing = await db
        .select()
        .from(oauthTokens)
        .where(and(
          eq(oauthTokens.userId, userId),
          eq(oauthTokens.provider, provider)
        ))
        .limit(1);

      if (existing.length > 0) {
        // 更新現有記錄
        await db
          .update(oauthTokens)
          .set({
            accessToken: tokenData.accessToken,
            refreshToken: tokenData.refreshToken || null,
            expiresAt: tokenData.expiresAt || null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(oauthTokens.userId, userId),
            eq(oauthTokens.provider, provider)
          ));
        console.log(`✅ Token updated in DB for user ${userId} provider ${provider}`);
      } else {
        // 插入新記錄
        await db.insert(oauthTokens).values({
          userId,
          provider,
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken || null,
          expiresAt: tokenData.expiresAt || null,
        });
        console.log(`✅ Token inserted in DB for user ${userId} provider ${provider}`);
      }
    } catch (error) {
      console.error(`❌ Failed to persist token to DB for user ${userId} provider ${provider}:`, error);
      // 即使數據庫保存失敗，內存快取仍然有效
    }

    console.log(`✅ Token securely stored for user ${userId} provider ${provider}`);
  }

  /**
   * 獲取 OAuth token - 先從內存快取獲取，失敗則從數據庫恢復
   */
  async getToken(userId: string, provider: 'google' | 'facebook' | 'google_analytics'): Promise<TokenData | null> {
    const cacheKey = `${provider}_${userId}`;
    
    // 1. 先從內存快取獲取
    const cached = this.tokenCache.get(cacheKey);
    if (cached) {
      // 檢查是否過期（但有 refresh token 的情況下仍然返回，讓調用方刷新）
      if (cached.expiresAt && cached.expiresAt < new Date() && !cached.refreshToken) {
        console.log(`⚠️ Token expired without refresh token for user ${userId} provider ${provider}`);
        this.tokenCache.delete(cacheKey);
        // 繼續嘗試從數據庫恢復
      } else {
        return cached;
      }
    }

    // 2. 從數據庫恢復 token
    try {
      const dbToken = await db
        .select()
        .from(oauthTokens)
        .where(and(
          eq(oauthTokens.userId, userId),
          eq(oauthTokens.provider, provider)
        ))
        .limit(1);

      if (dbToken.length > 0) {
        const token = dbToken[0];
        const tokenData: TokenData = {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken || undefined,
          expiresAt: token.expiresAt || undefined,
          userId,
          provider,
        };

        // 存入內存快取
        this.tokenCache.set(cacheKey, tokenData);
        console.log(`🔄 Token recovered from DB for user ${userId} provider ${provider}`);
        
        return tokenData;
      }
    } catch (error) {
      console.error(`❌ Failed to recover token from DB for user ${userId} provider ${provider}:`, error);
    }

    return null;
  }

  /**
   * 刪除 token - 從內存和數據庫同時刪除
   */
  async deleteToken(userId: string, provider: 'google' | 'facebook' | 'google_analytics'): Promise<void> {
    const cacheKey = `${provider}_${userId}`;
    this.tokenCache.delete(cacheKey);

    // 從數據庫刪除
    try {
      await db
        .delete(oauthTokens)
        .where(and(
          eq(oauthTokens.userId, userId),
          eq(oauthTokens.provider, provider)
        ));
      console.log(`🗑️ Token deleted from DB for user ${userId} provider ${provider}`);
    } catch (error) {
      console.error(`❌ Failed to delete token from DB for user ${userId} provider ${provider}:`, error);
    }

    console.log(`🗑️ Token deleted for user ${userId} provider ${provider}`);
  }

  /**
   * 檢查 token 是否存在且有效
   */
  async hasValidToken(userId: string, provider: 'google' | 'facebook' | 'google_analytics'): Promise<boolean> {
    const token = await this.getToken(userId, provider);
    return token !== null;
  }

  /**
   * 清理過期 tokens（只從內存清理，數據庫中的過期 token 仍然保留用於刷新）
   */
  private cleanupExpiredTokens(): void {
    const now = new Date();
    let cleanedCount = 0;
    
    // Convert iterator to array to avoid TypeScript iteration issues
    const entries = Array.from(this.tokenCache.entries());
    for (const [key, tokenData] of entries) {
      // 只清理沒有 refresh token 的過期 token
      if (tokenData.expiresAt && tokenData.expiresAt < now && !tokenData.refreshToken) {
        this.tokenCache.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired tokens from memory`);
    }
  }

  /**
   * 為生產環境創建 Google OAuth2 Client
   */
  createGoogleOAuth2Client(userId: string): any {
    const google = require('googleapis').google;
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    // 不再從資料庫讀取 tokens，而是從安全快取讀取
    const tokenPromise = this.getToken(userId, 'google');
    
    return {
      client: oauth2Client,
      setCredentials: async () => {
        const tokenData = await tokenPromise;
        if (tokenData) {
          oauth2Client.setCredentials({
            access_token: tokenData.accessToken,
            refresh_token: tokenData.refreshToken,
            expiry_date: tokenData.expiresAt?.getTime()
          });
        }
      }
    };
  }

  /**
   * 為生產環境獲取 Facebook access token
   */
  async getFacebookAccessToken(userId: string): Promise<string | null> {
    const tokenData = await this.getToken(userId, 'facebook');
    return tokenData?.accessToken || null;
  }

  /**
   * 銷毀服務（清理資源）
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.tokenCache.clear();
  }
}

// 單例實例
export const secureTokenService = new SecureTokenService();

// 優雅關閉處理
process.on('SIGTERM', () => {
  secureTokenService.destroy();
});

process.on('SIGINT', () => {
  secureTokenService.destroy();
});
