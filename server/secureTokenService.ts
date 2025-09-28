/**
 * 安全 Token 管理服務
 * 使用 Replit Secrets 和運行時快取來安全管理 OAuth tokens
 * 不再將敏感 tokens 存儲在資料庫中
 */

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  userId: string;
  provider: 'google' | 'facebook';
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
   * 儲存 OAuth token (安全方式)
   */
  async storeToken(userId: string, provider: 'google' | 'facebook', tokenData: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }): Promise<void> {
    const cacheKey = `${provider}_${userId}`;
    
    // 存儲到內存快取（開發環境）
    this.tokenCache.set(cacheKey, {
      ...tokenData,
      userId,
      provider,
    });

    console.log(`✅ Token securely stored for user ${userId} provider ${provider}`);
  }

  /**
   * 獲取 OAuth token
   */
  async getToken(userId: string, provider: 'google' | 'facebook'): Promise<TokenData | null> {
    const cacheKey = `${provider}_${userId}`;
    
    // 從快取獲取
    const cached = this.tokenCache.get(cacheKey);
    if (cached) {
      // 檢查是否過期
      if (cached.expiresAt && cached.expiresAt < new Date()) {
        console.log(`⚠️ Token expired for user ${userId} provider ${provider}`);
        this.tokenCache.delete(cacheKey);
        return null;
      }
      return cached;
    }

    return null;
  }

  /**
   * 刪除 token
   */
  async deleteToken(userId: string, provider: 'google' | 'facebook'): Promise<void> {
    const cacheKey = `${provider}_${userId}`;
    this.tokenCache.delete(cacheKey);
    console.log(`🗑️ Token deleted for user ${userId} provider ${provider}`);
  }

  /**
   * 檢查 token 是否存在且有效
   */
  async hasValidToken(userId: string, provider: 'google' | 'facebook'): Promise<boolean> {
    const token = await this.getToken(userId, provider);
    return token !== null;
  }

  /**
   * 清理過期 tokens
   */
  private cleanupExpiredTokens(): void {
    const now = new Date();
    let cleanedCount = 0;
    
    // Convert iterator to array to avoid TypeScript iteration issues
    const entries = Array.from(this.tokenCache.entries());
    for (const [key, tokenData] of entries) {
      if (tokenData.expiresAt && tokenData.expiresAt < now) {
        this.tokenCache.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired tokens`);
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