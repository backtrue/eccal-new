# Google Analytics 授權整合指南

## 概覽

本文檔提供完整的 Google Analytics (GA4) 授權流程實作指南，包含 OAuth2 設定、Token 管理、API 權限驗證等關鍵步驟。請嚴格按照此指南實作，避免常見錯誤。

## 必要環境變數

```bash
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

## 1. Google Cloud Console 設定

### 1.1 建立 OAuth2 憑證

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立新專案或選擇現有專案
3. 啟用以下 API：
   - **Google Analytics Reporting API**
   - **Google Analytics Data API** (GA4)
   - **Google Analytics Admin API**
4. 建立 OAuth 2.0 用戶端 ID：
   - 應用程式類型：網路應用程式
   - 授權重新導向 URI：`https://yourdomain.com/api/auth/google/callback`
   - 開發環境：`http://localhost:5000/api/auth/google/callback`

### 1.2 設定 OAuth 同意畫面

- **使用者類型**：外部 (用於正式環境)
- **範圍 (Scopes)**：
  - `profile`
  - `email`
  - `https://www.googleapis.com/auth/analytics.readonly`

## 2. OAuth2 策略設定

### 2.1 Passport.js Google 策略

```typescript
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackURL: process.env.NODE_ENV === 'production' 
    ? "https://yourdomain.com/api/auth/google/callback"
    : "/api/auth/google/callback",
  scope: [
    'profile',
    'email',
    'https://www.googleapis.com/auth/analytics.readonly'
  ]
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // 儲存用戶資料和 Token
    const user = await storage.upsertUser({
      id: profile.id,
      email: profile.emails?.[0]?.value || null,
      firstName: profile.name?.givenName || null,
      lastName: profile.name?.familyName || null,
      profileImageUrl: profile.photos?.[0]?.value || null,
      googleAccessToken: accessToken,
      googleRefreshToken: refreshToken,
      tokenExpiresAt: new Date(Math.min(Date.now() + 3600000, 2147483647)), // 32-bit 安全上限
    });

    return done(null, user || false);
  } catch (error) {
    return done(error, false);
  }
}));
```

### 2.2 重要設定說明

- **accessType: 'offline'**：確保取得 refresh token
- **prompt: 'consent'**：每次都要求使用者同意，確保 refresh token 有效
- **32-bit 安全處理**：Token 過期時間需要限制在 32-bit 整數範圍內

## 3. 授權路由實作

### 3.1 啟動授權流程

```typescript
app.get('/api/auth/google', (req, res, next) => {
  // 儲存回傳頁面
  const returnTo = req.query.returnTo as string || req.get('Referer') || '/';
  (req.session as any).returnTo = returnTo;

  // 設定語言偏好
  let language = req.query.hl as string || 'zh-TW';
  const googleLanguage = language === 'zh-TW' ? 'zh-TW' : 
                        language === 'ja' ? 'ja' : 'en';

  // 建立狀態參數作為備份
  const state = Buffer.from(JSON.stringify({ returnTo, language })).toString('base64');

  passport.authenticate('google', {
    accessType: 'offline',     // 必要：取得 refresh token
    prompt: 'consent',         // 必要：確保每次都取得有效的 refresh token
    hl: googleLanguage,        // 設定 OAuth 介面語言
    state: state               // 狀態參數備份
  })(req, res, next);
});
```

### 3.2 授權回傳處理

```typescript
app.get('/api/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', (err: any, user: any, info: any) => {
    if (err) {
      console.error('Google OAuth error:', err);
      return res.status(500).send('Authentication failed');
    }

    if (!user) {
      console.error('Google OAuth failed - no user returned:', info);
      return res.status(401).send('Authentication failed');
    }

    req.logIn(user, async (loginErr) => {
      if (loginErr) {
        console.error('Login error:', loginErr);
        return res.status(500).send('Login failed');
      }

      // 確保 session 儲存
      (req.session as any).save((saveErr: any) => {
        if (saveErr) {
          console.error('Session save error:', saveErr);
        }
      });

      // 處理回傳 URL
      let returnTo = (req.session as any)?.returnTo || '/';
      try {
        const stateParam = req.query.state as string;
        if (stateParam && !returnTo) {
          const decoded = JSON.parse(Buffer.from(stateParam, 'base64').toString());
          returnTo = decoded.returnTo || '/';
        }
      } catch (error) {
        console.error('Error parsing state parameter:', error);
      }
      
      delete (req.session as any).returnTo;

      // 建立完整回傳 URL
      const baseUrl = process.env.NODE_ENV === 'production' 
        ? 'https://yourdomain.com' 
        : `${req.protocol}://${req.get('host')}`;
      
      let redirectUrl: string;
      if (returnTo.startsWith('http')) {
        redirectUrl = `${returnTo}${returnTo.includes('?') ? '&' : '?'}auth_success=1`;
      } else {
        const cleanPath = returnTo.startsWith('/') ? returnTo : `/${returnTo}`;
        redirectUrl = `${baseUrl}${cleanPath}${cleanPath.includes('?') ? '&' : '?'}auth_success=1`;
      }

      res.redirect(redirectUrl);
    });
  })(req, res, next);
});
```

## 4. Token 管理與更新

### 4.1 安全的 OAuth2 客戶端建立

```typescript
import { google } from 'googleapis';

export function createSafeOAuth2Client(credentials?: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | Date | null;
}): any {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  if (credentials) {
    const safeCredentials: any = {
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
    };

    // 處理過期時間，確保 32-bit 安全
    if (credentials.expiry_date) {
      let expiryValue: number;
      if (credentials.expiry_date instanceof Date) {
        expiryValue = credentials.expiry_date.getTime();
      } else {
        expiryValue = Number(credentials.expiry_date);
      }
      
      // 限制在 32-bit 範圍內
      safeCredentials.expiry_date = Math.min(expiryValue, 2147483647);
    } else {
      safeCredentials.expiry_date = Math.min(Date.now() + 3600000, 2147483647);
    }

    oauth2Client.setCredentials(safeCredentials);
  }

  return oauth2Client;
}
```

### 4.2 Token 自動更新

```typescript
private async refreshAccessToken(userId: string): Promise<void> {
  try {
    const user = await storage.getUser(userId);
    if (!user || !user.googleRefreshToken) {
      throw new Error('No refresh token available');
    }

    const refreshClient = createSafeOAuth2Client({
      refresh_token: user.googleRefreshToken,
      expiry_date: user.tokenExpiresAt,
    });

    const { credentials } = await refreshClient.refreshAccessToken();
    
    if (credentials.access_token) {
      await storage.upsertUser({
        ...user,
        googleAccessToken: credentials.access_token,
        tokenExpiresAt: credentials.expiry_date ? 
          new Date(Math.min(credentials.expiry_date, 2147483647)) :
          new Date(Date.now() + 3600000),
      });
    }
  } catch (error) {
    console.error('Error refreshing access token:', error);
    throw error;
  }
}
```

## 5. GA4 API 資料取得

### 5.1 取得使用者的 Analytics 屬性

```typescript
async getUserAnalyticsProperties(userId: string): Promise<any[]> {
  try {
    const user = await storage.getUser(userId);
    if (!user || !user.googleAccessToken) {
      throw new Error('User not found or no access token');
    }

    // 先更新 Token 確保有效性
    await this.refreshAccessToken(userId);
    const updatedUser = await storage.getUser(userId);
    
    const oauth2Client = createSafeOAuth2Client({
      access_token: updatedUser?.googleAccessToken,
      refresh_token: updatedUser?.googleRefreshToken,
      expiry_date: updatedUser?.tokenExpiresAt,
    });

    const analyticsAdmin = google.analyticsadmin('v1beta');
    
    // 取得所有帳戶
    const accountsResponse = await analyticsAdmin.accounts.list({
      auth: oauth2Client,
    });

    const properties: any[] = [];
    
    if (accountsResponse.data.accounts) {
      for (const account of accountsResponse.data.accounts) {
        if (account.name) {
          try {
            // 列出每個帳戶的屬性
            const propertiesResponse = await analyticsAdmin.properties.list({
              auth: oauth2Client,
              filter: `parent:${account.name}`,
            });

            if (propertiesResponse.data.properties) {
              const accountProperties = propertiesResponse.data.properties.map(prop => ({
                id: prop.name?.split('/')[1], // 提取屬性 ID
                displayName: prop.displayName,
                accountName: account.displayName,
              }));
              
              properties.push(...accountProperties);
            }
          } catch (propError) {
            console.error(`Error fetching properties for account ${account.displayName}:`, propError);
          }
        }
      }
    }

    return properties;
  } catch (error) {
    console.error('Error fetching Analytics properties:', error);
    
    // 錯誤分析和處理
    if (error instanceof Error) {
      if (error.message.includes('invalid_grant') || error.message.includes('invalid_token')) {
        throw new Error('Authentication expired. Please logout and login again.');
      }
      if (error.message.includes('insufficient permissions')) {
        throw new Error('Insufficient permissions. Please ensure you have access to Google Analytics and try re-authenticating.');
      }
      if (error.message.includes('403')) {
        throw new Error('Access denied to Google Analytics API. Please check your permissions.');
      }
    }
    
    throw error;
  }
}
```

### 5.2 取得電商資料

```typescript
async getEcommerceData(userId: string, propertyId: string): Promise<AnalyticsData | null> {
  try {
    const user = await storage.getUser(userId);
    if (!user || !user.googleAccessToken) {
      throw new Error('User not found or no access token');
    }

    const oauth2Client = createSafeOAuth2Client({
      access_token: user.googleAccessToken,
      refresh_token: user.googleRefreshToken,
      expiry_date: user.tokenExpiresAt,
    });

    const analyticsData = google.analyticsdata('v1beta');
    
    // 計算日期範圍（過去 28 天）
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 28);

    const dateRange = {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };

    // 嘗試不同的指標組合
    const metricSets = [
      {
        name: 'Standard GA4 Ecommerce',
        metrics: ['sessions', 'totalRevenue', 'ecommercePurchases', 'averagePurchaseRevenue']
      },
      {
        name: 'Purchase Event Based', 
        metrics: ['sessions', 'purchaseRevenue', 'purchases', 'itemRevenue']
      },
      {
        name: 'Enhanced Ecommerce Legacy',
        metrics: ['sessions', 'itemRevenue', 'itemPurchaseQuantity', 'averagePurchaseRevenue']
      },
      {
        name: 'Basic Conversion Tracking',
        metrics: ['sessions', 'conversions', 'eventValue', 'eventCount']
      }
    ];

    let response;
    for (const metricSet of metricSets) {
      try {
        response = await analyticsData.properties.runReport({
          auth: oauth2Client,
          property: `properties/${propertyId}`,
          requestBody: {
            dateRanges: [dateRange],
            metrics: metricSet.metrics.map(name => ({ name })),
            dimensions: [],
          },
        });
        
        console.log(`Success with metric set: ${metricSet.name}`);
        break;
        
      } catch (error) {
        console.log(`Failed with ${metricSet.name}:`, (error as any).message);
        if (metricSet === metricSets[metricSets.length - 1]) {
          throw error;
        }
      }
    }

    if (!response || !response.data.rows || response.data.rows.length === 0) {
      return {
        sessions: 0,
        totalRevenue: 0,
        ecommercePurchases: 0,
        averageOrderValue: 0,
        conversionRate: 0,
      };
    }

    const metrics = response.data.rows[0].metricValues;
    if (!metrics || metrics.length < 4) {
      return {
        sessions: 0,
        totalRevenue: 0,
        ecommercePurchases: 0,
        averageOrderValue: 0,
        conversionRate: 0,
      };
    }

    const sessions = parseFloat(metrics[0].value || '0');
    const totalRevenue = parseFloat(metrics[1].value || '0');
    const ecommercePurchases = parseFloat(metrics[2].value || '0');
    const averageOrderValue = metrics[3] ? 
      parseFloat(metrics[3].value || '0') : 
      (ecommercePurchases > 0 ? totalRevenue / ecommercePurchases : 0);

    const conversionRate = sessions > 0 ? (ecommercePurchases / sessions) * 100 : 0;

    return {
      sessions,
      totalRevenue,
      ecommercePurchases,
      averageOrderValue,
      conversionRate,
    };
  } catch (error) {
    console.error('Error fetching Google Analytics data:', error);
    
    // Token 過期處理
    if (error instanceof Error && error.message.includes('invalid_grant')) {
      await this.refreshAccessToken(userId);
      return this.getEcommerceData(userId, propertyId);
    }
    
    throw error;
  }
}
```

## 6. 資料庫結構設計

### 6.1 使用者表格

```sql
CREATE TABLE users (
  id VARCHAR PRIMARY KEY,
  email VARCHAR UNIQUE,
  first_name VARCHAR,
  last_name VARCHAR,
  profile_image_url VARCHAR,
  google_access_token TEXT,
  google_refresh_token TEXT,
  token_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 6.2 使用者指標表格

```sql
CREATE TABLE user_metrics (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR REFERENCES users(id),
  average_order_value DECIMAL,
  conversion_rate DECIMAL,
  data_source VARCHAR DEFAULT 'google_analytics',
  ga_resource_name VARCHAR,
  period_start DATE,
  period_end DATE,
  raw_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## 7. 前端整合

### 7.1 授權按鈕

```tsx
const GoogleAuthButton = () => {
  const handleLogin = () => {
    const returnTo = encodeURIComponent(window.location.pathname);
    window.location.href = `/api/auth/google?returnTo=${returnTo}`;
  };

  return (
    <button onClick={handleLogin} className="bg-blue-500 text-white px-4 py-2 rounded">
      連接 Google Analytics
    </button>
  );
};
```

### 7.2 授權狀態檢查

```tsx
const useAuth = () => {
  const { data: user, isLoading } = useQuery({
    queryKey: ['/api/auth/user'],
    queryFn: async () => {
      const response = await fetch('/api/auth/user');
      if (!response.ok) {
        if (response.status === 401) {
          return null; // 未授權
        }
        throw new Error('Failed to fetch user');
      }
      return response.json();
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    hasGoogleAccess: !!(user?.googleAccessToken),
  };
};
```

## 8. 常見錯誤處理

### 8.1 權限不足錯誤

```typescript
// 錯誤：insufficient permissions
if (error.message.includes('insufficient permissions')) {
  throw new Error('使用者需要在 Google Analytics 中被授予適當權限，或重新授權。');
}
```

### 8.2 Token 過期錯誤

```typescript
// 錯誤：invalid_grant
if (error.message.includes('invalid_grant')) {
  await this.refreshAccessToken(userId);
  // 重試一次
  return this.getEcommerceData(userId, propertyId);
}
```

### 8.3 API 存取被拒

```typescript
// 錯誤：403 Forbidden
if (error.message.includes('403')) {
  throw new Error('Google Analytics API 存取被拒。請檢查：1) 是否有 GA 存取權限，2) 屬性 ID 是否正確，3) Google 帳戶權限是否足夠。');
}
```

## 9. 安全性考量

### 9.1 Token 儲存

- **加密儲存**：在生產環境中應加密儲存 access token 和 refresh token
- **定期清理**：定期清理過期的 token
- **最小權限原則**：只請求必要的 OAuth 範圍

### 9.2 CORS 設定

```typescript
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] 
    : ['http://localhost:3000', 'http://localhost:5000'],
  credentials: true,
}));
```

### 9.3 Session 安全

```typescript
app.use(session({
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 小時
  },
}));
```

## 10. 測試與除錯

### 10.1 除錯日誌

```typescript
// 在關鍵點加入詳細日誌
console.log(`[GA-DEBUG] User ${userId} - Token info:`, {
  hasAccessToken: !!user.googleAccessToken,
  hasRefreshToken: !!user.googleRefreshToken,
  tokenExpiresAt: user.tokenExpiresAt,
});
```

### 10.2 測試流程

1. **本地測試**：使用 `http://localhost:5000` 回傳 URL
2. **權限測試**：確認使用者在 GA 中有適當權限
3. **Token 更新測試**：模擬 token 過期情況
4. **錯誤處理測試**：測試各種錯誤情況的處理

## 11. 部署檢查清單

- [ ] Google Cloud Console 中設定正確的回傳 URL
- [ ] 環境變數 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET` 已設定
- [ ] OAuth 同意畫面已設定並通過審核（生產環境）
- [ ] 所有必要的 Google API 已啟用
- [ ] CORS 設定正確
- [ ] Session 和 Cookie 設定適合生產環境
- [ ] 錯誤處理和日誌記錄完整

## 12. 支援與除錯

如果遇到問題，請檢查：

1. **Google Cloud Console 設定**是否完整
2. **OAuth 範圍**是否包含 Analytics 權限
3. **使用者在 GA 中的權限**是否足夠
4. **Token 是否過期**需要重新授權
5. **API 配額**是否已用盡

---

**重要提醒**：務必按照此指南的順序實作，特別注意 Token 安全處理和錯誤處理機制。任何偏離此指南的實作都可能導致授權失敗或安全問題。