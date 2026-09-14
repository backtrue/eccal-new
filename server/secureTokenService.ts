/**
 * 安全 Token 管理服務
 * 使用數據庫持久化（加密）和運行時快取來安全管理 OAuth tokens
 * 支持生產環境重啟後恢復 tokens
 */

import { db } from './db';
import { oauthTokens } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  userId: string;
  provider: 'google' | 'facebook' | 'google_analytics';
}

type TokenProvider = TokenData['provider'];

export type StoredTokenRecord = Readonly<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}>;

export interface SecureTokenPersistence {
  findToken(userId: string, provider: TokenProvider): Promise<StoredTokenRecord | null>;
  saveToken(
    userId: string,
    provider: TokenProvider,
    token: StoredTokenRecord,
  ): Promise<'inserted' | 'updated'>;
  deleteToken(userId: string, provider: TokenProvider): Promise<void>;
}

// 加密配置
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * 獲取加密密鑰（從專用環境變量，優先使用 TOKEN_ENCRYPTION_KEY）
 */
function getEncryptionKey(): Buffer {
  // 優先使用專用的 token 加密密鑰
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || 'fallback-secret-key-for-development';
  // 使用 SHA-256 hash 確保密鑰長度為 32 bytes (256 bits)
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * 加密文本
 */
function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // 格式: iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * 解密文本
 */
function decrypt(encryptedText: string): string {
  try {
    const key = getEncryptionKey();
    const parts = encryptedText.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Token decryption failed:', error);
    throw new Error('Failed to decrypt token');
  }
}

const databaseTokenPersistence: SecureTokenPersistence = {
  async findToken(userId, provider) {
    const rows = await db
      .select()
      .from(oauthTokens)
      .where(and(
        eq(oauthTokens.userId, userId),
        eq(oauthTokens.provider, provider),
      ))
      .limit(1);
    return rows[0] ?? null;
  },

  async saveToken(userId, provider, token) {
    const existing = await db
      .select()
      .from(oauthTokens)
      .where(and(
        eq(oauthTokens.userId, userId),
        eq(oauthTokens.provider, provider),
      ))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(oauthTokens)
        .set({
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          updatedAt: new Date(),
        })
        .where(and(
          eq(oauthTokens.userId, userId),
          eq(oauthTokens.provider, provider),
        ));
      return 'updated';
    }

    await db.insert(oauthTokens).values({
      userId,
      provider,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
    });
    return 'inserted';
  },

  async deleteToken(userId, provider) {
    await db
      .delete(oauthTokens)
      .where(and(
        eq(oauthTokens.userId, userId),
        eq(oauthTokens.provider, provider),
      ));
  },
};

export class SecureTokenService {
  private tokenCache: Map<string, TokenData> = new Map();
  private readonly CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly persistence: SecureTokenPersistence = databaseTokenPersistence,
  ) {
    // 定期清理過期快取
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, 10 * 60 * 1000); // 每 10 分鐘清理一次
  }

  /**
   * 儲存 OAuth token (安全方式) - 同時存到內存和數據庫（加密）
   */
  async storeToken(userId: string, provider: 'google' | 'facebook' | 'google_analytics', tokenData: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }): Promise<void> {
    const cacheKey = `${provider}_${userId}`;
    const previousToken = this.tokenCache.get(cacheKey);
    
    // 存儲到內存快取（明文，用於快速訪問）
    this.tokenCache.set(cacheKey, {
      ...tokenData,
      userId,
      provider,
    });

    // 存儲到數據庫（加密）
    try {
      // 加密 tokens
      const encryptedAccessToken = encrypt(tokenData.accessToken);
      const encryptedRefreshToken = tokenData.refreshToken ? encrypt(tokenData.refreshToken) : null;

      const action = await this.persistence.saveToken(userId, provider, {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt: tokenData.expiresAt || null,
      });
      console.log(`✅ Token ${action} in DB (encrypted) for user ${userId} provider ${provider}`);
    } catch (error) {
      console.error(`❌ Failed to persist token to DB for user ${userId} provider ${provider}:`, error);
      if (provider === 'google') {
        if (previousToken) {
          this.tokenCache.set(cacheKey, previousToken);
        } else {
          this.tokenCache.delete(cacheKey);
        }
        throw error;
      }
      // 保留既有 Facebook/Google Analytics 的快取失敗語意。
    }

    console.log(`✅ Token securely stored for user ${userId} provider ${provider}`);
  }

  /**
   * 獲取 OAuth token - 先從內存快取獲取，失敗則從數據庫恢復（解密）
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

    // 2. 從數據庫恢復 token（解密）
    try {
      const token = await this.persistence.findToken(userId, provider);

      if (token) {
        
        // 解密 tokens
        let decryptedAccessToken: string;
        let decryptedRefreshToken: string | undefined;
        
        try {
          decryptedAccessToken = decrypt(token.accessToken);
          decryptedRefreshToken = token.refreshToken ? decrypt(token.refreshToken) : undefined;
        } catch (decryptError) {
          // 如果解密失敗，可能是舊的未加密數據，嘗試直接使用
          console.log(`⚠️ Decryption failed for user ${userId}, trying as plaintext`);
          decryptedAccessToken = token.accessToken;
          decryptedRefreshToken = token.refreshToken || undefined;
        }
        
        const tokenData: TokenData = {
          accessToken: decryptedAccessToken,
          refreshToken: decryptedRefreshToken,
          expiresAt: token.expiresAt || undefined,
          userId,
          provider,
        };

        // 存入內存快取
        this.tokenCache.set(cacheKey, tokenData);
        console.log(`🔄 Token recovered from DB (decrypted) for user ${userId} provider ${provider}`);
        
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
    const previousToken = this.tokenCache.get(cacheKey);
    this.tokenCache.delete(cacheKey);

    // 從數據庫刪除
    try {
      await this.persistence.deleteToken(userId, provider);
      console.log(`🗑️ Token deleted from DB for user ${userId} provider ${provider}`);
    } catch (error) {
      console.error(`❌ Failed to delete token from DB for user ${userId} provider ${provider}:`, error);
      if (provider === 'google') {
        if (previousToken) {
          this.tokenCache.set(cacheKey, previousToken);
        }
        throw error;
      }
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
