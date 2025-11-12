# JWT Scope Token 測試指南

## ✅ 已完成功能

### 1. 後端實作
- ✅ `server/services/eccalAuth.ts` - Scope 簽發邏輯
  - `deriveScopes()` - 根據會員等級推導權限
  - `generateInternalJWT()` - 生成 15 分鐘短效 token
  - `verifyInternalJWT()` - 驗證 scope token
  - `hasScope()` - 檢查權限

- ✅ `/api/auth/get-token` 端點
  - 驗證長效 JWT (cookie)
  - 查詢用戶最新資料
  - 簽發短效 scope token (15分鐘)

### 2. 前端實作
- ✅ `client/src/lib/queryClient.ts` - 自動 Token 管理
  - `getScopedToken()` - 自動取得並快取 token
  - `clearScopedToken()` - 清除快取
  - 請求時自動加入 `Authorization: Bearer <token>`
  
- ✅ 登出邏輯整合
  - `UserDropdown.tsx` - 登出時清除 scoped token
  - `LogoutButton.tsx` - 登出時清除 scoped token

## 🧪 測試流程

### 測試 1: API 端點測試（未登入）
```bash
curl -X GET http://localhost:5000/api/auth/get-token
# 預期結果: {"error":"Not authenticated"}
```

### 測試 2: API 端點測試（已登入）
1. 先在瀏覽器登入系統
2. 開啟瀏覽器開發者工具 > Application > Cookies
3. 複製 `auth_token` 的值
4. 執行測試：
```bash
curl -X GET http://localhost:5000/api/auth/get-token \
  -H "Cookie: auth_token=<你的token>" \
  -s | python -m json.tool
```

預期結果：
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900
}
```

### 測試 3: Token 內容檢查
使用 [jwt.io](https://jwt.io) 解碼 token，應該包含：
```json
{
  "sub": "user-id",
  "email": "user@example.com",
  "name": "User Name",
  "membership": "free" or "pro",
  "credits": 30,
  "scope": ["user:profile", "line:read"],
  "iat": 1234567890,
  "exp": 1234568790,
  "iss": "eccal.thinkwithblack.com",
  "aud": "eccal-services"
}
```

### 測試 4: 前端自動取得 Token
1. 登入系統
2. 開啟瀏覽器開發者工具 > Console
3. 檢查 localStorage：
```javascript
// 應該看到兩個項目
localStorage.getItem('eccal_auth_scoped_token')
localStorage.getItem('eccal_auth_scoped_token_expiry')
```

### 測試 5: API 請求自動帶 Token
1. 登入系統
2. 開啟瀏覽器開發者工具 > Network
3. 觸發任何 API 請求（例如查看儀表板）
4. 檢查請求 Headers，應該包含：
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 測試 6: Token 快取機制
1. 第一次 API 請求 → 自動呼叫 `/api/auth/get-token`
2. 後續 API 請求 → 使用快取的 token（不再呼叫 get-token）
3. 15 分鐘後 → 自動重新取得新 token

### 測試 7: 登出清除 Token
1. 登入系統
2. 檢查 localStorage 有 `eccal_auth_scoped_token`
3. 點擊登出
4. 再次檢查 localStorage，token 應該已清除

## 🔍 Scope 權限對照表

| 會員等級 | Scopes |
|---------|--------|
| Free | `user:profile`, `line:read` |
| Pro | `user:profile`, `line:read`, `line:write`, `line:manage` |
| Founders | `user:profile`, `line:read`, `line:write`, `line:manage` |

## 📊 Token 比較

| 特性 | 長效 JWT (7天) | 短效 Scope Token (15分鐘) |
|------|---------------|--------------------------|
| 有效期 | 7 天 | 15 分鐘 |
| 儲存位置 | HttpOnly Cookie | localStorage |
| 包含內容 | 基本用戶資料 | 用戶資料 + Scope 權限 |
| 用途 | 身份驗證 | API 權限控制 |
| 更新機制 | 手動更新 | 自動更新（過期前 1 分鐘） |

## 🚀 生產環境部署

### 環境變數配置

#### 主站 (eccal.thinkwithblack.com)
主站使用以下環境變數來簽發 scope token：
```bash
JWT_SECRET=your_secure_jwt_secret_key
```

#### 子服務 (Cloudflare Workers / 其他平台)
子服務在驗證主站簽發的 scope token 時，必須使用相同的密鑰：
```bash
ECCAL_JWT_SECRET=your_secure_jwt_secret_key
```

**⚠️ 重要提醒**：
- `JWT_SECRET`（主站）和 `ECCAL_JWT_SECRET`（子服務）的值**必須完全相同**
- 這是 scope token 驗證的核心安全機制
- 如果兩者不一致，token 驗證將會失敗

### Cloudflare Worker 整合
Worker 端需要：
1. 設定環境變數 `ECCAL_JWT_SECRET`（與主站的 `JWT_SECRET` 值相同）
2. 使用 `ECCAL_JWT_SECRET` 驗證 token
3. 實作 scope 檢查中間件
4. 根據 scope 控制 API 存取權限

## 🔧 故障排除

### 問題 1: 前端無法取得 scoped token
**檢查**:
- 是否已登入（有 auth_token cookie）
- `/api/auth/get-token` 端點是否正常
- Console 是否有錯誤訊息

### 問題 2: Token 快取失效
**檢查**:
- localStorage 的 expiry 時間是否正確
- 是否在無痕模式（localStorage 可能被禁用）

### 問題 3: API 請求沒有帶 Authorization header
**檢查**:
- 確認使用 `apiRequest()` 或 `useQuery()` 發送請求
- 不要直接使用 `fetch()`，因為不會自動加 token

## 📝 開發建議

### 安全性提升（可選）
根據文件建議，可以考慮：
1. 將 scoped token 改存 `sessionStorage`（關閉分頁即清除）
2. 使用 HttpOnly Cookie 儲存（需修改後端）
3. 定期輪換 `JWT_SECRET`

### 監控建議
建議追蹤：
- `/api/auth/get-token` 呼叫頻率
- Token 過期率
- 各 scope 的使用統計

---

**實作完成日期**: 2025-10-14  
**文檔版本**: v1.0.0
