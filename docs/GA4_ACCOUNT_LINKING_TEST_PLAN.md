# GA4 獨立帳號連結功能 - 測試計劃

## 功能概述

允許用戶用 A 帳號登入報數據平台，但連結 B 帳號的 Google Analytics 權限。這樣用戶可以使用自己的登入帳號，但存取客戶或合作夥伴的 GA4 資料。

## 架構說明

### 資料儲存

1. **metadata（公開資料）** - `google_analytics_connections` 表
   - userId（關聯到登入帳號）
   - googleEmail（連結的 GA4 帳號 email）
   - googleId（Google user ID）
   - connectedAt / updatedAt

2. **tokens（敏感資料）** - `secure_tokens` 表（加密儲存）
   - userId + tokenType='google_analytics'
   - accessToken（加密儲存）
   - refreshToken（加密儲存）
   - expiresAt（token 過期時間）

### API 端點

1. **GET /api/auth/google-analytics**
   - 啟動 GA4 OAuth 連結流程
   - 需要登入（requireJWTAuth）
   - 重定向到 Google OAuth 授權頁面

2. **GET /api/auth/google-analytics/callback**
   - OAuth 回調處理
   - 儲存 tokens 和連結資訊
   - 成功後重定向回設定頁面

3. **GET /api/analytics/ga-connection**
   - 查詢當前用戶的 GA4 連結狀態
   - 需要登入（requireJWTAuth）
   - 返回連結的 email 和時間

4. **POST /api/analytics/disconnect-ga**
   - 斷開 GA4 連結
   - 需要登入（requireJWTAuth）
   - 刪除 tokens 和連結記錄

### Token 優先級邏輯

`getGAOAuthClient(userId)` 函數會：
1. 優先嘗試使用 GA4 專用 token（`tokenType='google_analytics'`）
2. 如果 GA4 token 過期，自動刷新
3. 如果 GA4 token 刷新失敗，優雅回退到主帳號 token（`tokenType='google'`）
4. 如果主帳號 token 也過期，刷新主帳號 token

## 測試場景

### 場景 1：基本連結流程

**前置條件：**
- 用戶已登入報數據平台（帳號 A：user@example.com）

**測試步驟：**
1. 訪問 `/settings` 頁面
2. 點擊「連結 GA4 帳號」按鈕
3. 重定向到 Google OAuth 授權頁面
4. 使用不同的 Google 帳號登入（帳號 B：analytics@client.com）
5. 授權 Analytics 權限
6. 重定向回設定頁面

**預期結果：**
- 設定頁面顯示「已連結」狀態
- 顯示連結的帳號：analytics@client.com
- 顯示連結時間
- 資料庫正確儲存連結資訊和 tokens

**驗證查詢：**
```sql
-- 檢查連結記錄
SELECT * FROM google_analytics_connections WHERE user_id = '<userId>';

-- 檢查 token 記錄（會顯示加密的資料）
SELECT user_id, token_type, expires_at, created_at 
FROM secure_tokens 
WHERE user_id = '<userId>' AND token_type = 'google_analytics';
```

### 場景 2：使用 GA4 專用帳號存取資料

**前置條件：**
- 已完成場景 1 的連結

**測試步驟：**
1. 訪問任何使用 GA4 資料的頁面（如 Calculator）
2. 選擇 GA4 property
3. 載入 ecommerce 資料

**預期結果：**
- 成功載入 analytics@client.com 帳號有權限的 GA4 properties
- 能正常讀取 ecommerce 資料
- 後端日誌顯示使用 GA4 專用連結

**後端日誌檢查：**
```
✅ Using dedicated GA4 connection for user <userId> (analytics@client.com)
```

### 場景 3：Token 自動刷新

**前置條件：**
- GA4 access token 已過期（但 refresh token 有效）

**測試步驟：**
1. 訪問使用 GA4 資料的頁面
2. 觸發 GA4 API 調用

**預期結果：**
- token 自動刷新
- API 調用成功
- 新的 access token 被儲存

**後端日誌檢查：**
```
🔄 GA4 token needs refresh for user <userId>, refreshing now...
✅ GA4 token refreshed for user <userId>
```

### 場景 4：GA4 Token 失效時回退到主帳號

**前置條件：**
- GA4 refresh token 失效或過期

**測試步驟：**
1. 訪問使用 GA4 資料的頁面
2. 觸發 GA4 API 調用

**預期結果：**
- GA4 token 刷新失敗
- 自動回退到主帳號 token
- 如果主帳號有 GA4 權限，API 調用成功

**後端日誌檢查：**
```
Failed to refresh GA4 token for user <userId>: ...
⚠️ GA4 token refresh failed, falling back to main account for user <userId>
⚠️ Using main account for user <userId>
```

### 場景 5：斷開連結

**前置條件：**
- 已有 GA4 連結

**測試步驟：**
1. 訪問 `/settings` 頁面
2. 點擊「斷開連結」按鈕
3. 在確認對話框點擊「確認」

**預期結果：**
- 顯示「已成功斷開」toast 提示
- 設定頁面顯示「未連結」狀態
- 顯示「連結 GA4 帳號」按鈕
- 資料庫刪除連結記錄和 tokens

**驗證查詢：**
```sql
-- 應該返回 0 行
SELECT * FROM google_analytics_connections WHERE user_id = '<userId>';

-- 應該返回 0 行
SELECT * FROM secure_tokens 
WHERE user_id = '<userId>' AND token_type = 'google_analytics';
```

### 場景 6：重新連結（更換帳號）

**前置條件：**
- 已有 GA4 連結（帳號 B）

**測試步驟：**
1. 重複場景 1，但使用不同的 Google 帳號（帳號 C）

**預期結果：**
- 舊的連結資訊被更新
- 顯示新的連結帳號
- 舊的 tokens 被新的取代
- 保留舊的 refresh token（如果新的授權沒有提供）

## API 測試（需要登入）

### 測試未連結狀態

```bash
# 需要先登入，然後執行
curl -s http://localhost:5000/api/analytics/ga-connection \
  -H "Cookie: <auth_cookie>" | json_pp
```

**預期返回：**
```json
null
```

### 測試已連結狀態

**預期返回：**
```json
{
  "userId": "abc123",
  "googleEmail": "analytics@client.com",
  "googleId": "123456789",
  "connectedAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

## 錯誤處理測試

### 1. 未登入訪問

```bash
curl -s http://localhost:5000/api/auth/google-analytics
```

**預期：** 401 Unauthorized

### 2. Session 過期

模擬 OAuth callback 時 session 過期的情況

**預期：** "Session expired. Please try again."

### 3. OAuth 授權取消

在 Google 授權頁面點擊「取消」

**預期：** 顯示錯誤訊息並重定向

## 安全性檢查

### 1. Token 加密儲存

```sql
-- tokens 應該是加密的，不可見明文
SELECT encrypted_data FROM secure_tokens 
WHERE user_id = '<userId>' AND token_type = 'google_analytics';
```

### 2. 跨用戶隔離

確保用戶 A 無法存取用戶 B 的 GA4 連結

### 3. Refresh Token 保留

當重新授權時，如果 Google 不提供新的 refresh token，應保留舊的

## 前端 UI 檢查

### 設定頁面 `/settings`

- [ ] 未連結狀態顯示正確
- [ ] 已連結狀態顯示正確
- [ ] 連結帳號 email 顯示正確
- [ ] 連結時間格式正確（本地化）
- [ ] 「連結 GA4 帳號」按鈕可點擊
- [ ] 「斷開連結」按鈕可點擊
- [ ] 斷開連結確認對話框正確顯示
- [ ] Loading 狀態顯示
- [ ] Toast 提示顯示
- [ ] 支援三種語言（zh-TW, en, ja）
- [ ] 響應式設計正常

## 整合測試

### Calculator 頁面整合

1. 用 A 帳號登入
2. 連結 B 帳號的 GA4
3. 訪問 Calculator 頁面
4. 選擇 GA4 property
5. 驗證載入的是 B 帳號的資料

### Campaign Planner 頁面整合

同上，驗證在 Campaign Planner 頁面也能正確使用 B 帳號的 GA4 資料

## 成功標準

- ✅ 用戶可以成功連結獨立的 GA4 帳號
- ✅ 所有 GA4 API 調用優先使用專用 token
- ✅ Token 過期時自動刷新
- ✅ GA4 token 失效時優雅回退到主帳號
- ✅ 用戶可以成功斷開連結
- ✅ 用戶可以更換連結的帳號
- ✅ Tokens 安全儲存（加密）
- ✅ 前端 UI 正確顯示連結狀態
- ✅ 多語言支援正常
- ✅ 錯誤處理完善

## 已知限制

1. **Refresh Token 限制**：Google OAuth 在某些情況下不會返回新的 refresh token（已處理：保留舊的）
2. **Token 過期時間**：依賴 Google 返回的 expiry_date（已處理：自動刷新機制）
3. **跨域問題**：生產環境需要正確設定 CORS 和 cookie domain

## 下一步

- [ ] 進行完整的手動測試
- [ ] 在生產環境測試 OAuth 流程
- [ ] 監控 token 刷新日誌
- [ ] 收集用戶反饋
