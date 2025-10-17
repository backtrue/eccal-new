# galine SSO 整合修復指南

## 📋 問題摘要

**問題現象**：首次登入 galine 的用戶在完成 Google SSO 後，Cloudflare Worker 端出現 `"exp" claim timestamp check failed` 錯誤，導致 JWT token 驗證失敗。

**根本原因**：JWT 驗證缺少時鐘容忍度（clock tolerance），當 Eccal 服務器與 Cloudflare Worker 之間存在微小時間差異（幾秒鐘）時，剛生成的 token 會被立即判定為過期。

---

## ✅ Eccal 端已完成的修復

我們已在 `eccal.thinkwithblack.com` 完成以下修復（2025-10-17）：

### 1. JWT 驗證添加時鐘容忍度
- **端點**：`POST /api/sso/verify-token`
- **修改**：添加 60 秒的 `clockTolerance`
- **效果**：允許 ±60 秒的時間偏差

### 2. JWT 生成時間戳調試日誌
- **端點**：`GET /api/auth/google-sso/callback`
- **新增**：詳細的時間戳日誌（iat、exp、服務器時間）
- **效果**：便於診斷時間同步問題

### 3. SSO 回調確認
- **確認**：所有必要參數都正確返回：
  - `auth_success=true` ✅
  - `token=<jwt>` ✅
  - `user_id=<id>` ✅

---

## 🔧 galine 端需要的調整

### **必要修改：添加 clockTolerance 到 JWT 驗證**

在 Cloudflare Worker 中驗證 Eccal JWT token 時，必須添加相同的時鐘容忍度設置。

#### **修改前（會導致錯誤）：**
```javascript
// ❌ 沒有 clockTolerance，時間偏差會導致驗證失敗
const decoded = jwt.verify(eccalToken, ECCAL_JWT_SECRET);
```

#### **修改後（正確）：**
```javascript
// ✅ 添加 60 秒時鐘容忍度
const decoded = jwt.verify(eccalToken, ECCAL_JWT_SECRET, {
  clockTolerance: 60  // 允許 ±60 秒的時間偏差
});
```

---

## 📝 完整代碼範例

### **Cloudflare Worker - JWT 驗證邏輯**

```javascript
import jwt from '@tsndr/cloudflare-worker-jwt'

// 環境變數
const ECCAL_JWT_SECRET = env.ECCAL_JWT_SECRET  // 與 Eccal 相同的密鑰

// SSO 回調處理
async function handleEccalCallback(request, env) {
  const url = new URL(request.url)
  
  // 1. 從 URL 取得參數
  const authSuccess = url.searchParams.get('auth_success')
  const token = url.searchParams.get('token')
  const userId = url.searchParams.get('user_id')
  
  console.log('Eccal SSO 回調:', {
    authSuccess,
    hasToken: !!token,
    userId
  })
  
  // 2. 檢查必要參數
  if (authSuccess !== 'true' || !token) {
    return new Response('SSO 認證失敗：缺少必要參數', { status: 400 })
  }
  
  try {
    // 3. 驗證 JWT token（🔧 重點：添加 clockTolerance）
    const isValid = await jwt.verify(token, ECCAL_JWT_SECRET, {
      clockTolerance: 60  // 允許 60 秒時鐘偏差
    })
    
    if (!isValid) {
      console.error('JWT 驗證失敗：token 無效')
      return new Response('JWT token 無效', { status: 401 })
    }
    
    // 4. 解碼 token 取得用戶資訊
    const decoded = jwt.decode(token)
    
    console.log('JWT 驗證成功:', {
      userId: decoded.payload.sub,
      email: decoded.payload.email,
      membership: decoded.payload.membership,
      iat: new Date(decoded.payload.iat * 1000).toISOString(),
      exp: new Date(decoded.payload.exp * 1000).toISOString()
    })
    
    // 5. 生成 galine 內部的 access/refresh token
    const accessToken = await generateGalineAccessToken(decoded.payload)
    const refreshToken = await generateGalineRefreshToken(decoded.payload)
    
    // 6. 設置 Cookie 並重定向
    const response = new Response(null, {
      status: 302,
      headers: {
        'Location': '/',
        'Set-Cookie': [
          `galine_access_token=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${15 * 60}`,
          `galine_refresh_token=${refreshToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`
        ].join(', ')
      }
    })
    
    return response
    
  } catch (error) {
    console.error('JWT 驗證錯誤:', error.message)
    
    // 記錄詳細錯誤資訊
    if (error.message.includes('exp')) {
      console.error('時間戳錯誤 - 可能的時鐘偏差問題')
    }
    
    return new Response(`JWT 驗證失敗: ${error.message}`, { status: 401 })
  }
}

// Token 生成函數（示例）
async function generateGalineAccessToken(eccalUser) {
  return await jwt.sign({
    sub: eccalUser.sub,
    email: eccalUser.email,
    membership: eccalUser.membership,
    credits: eccalUser.credits,
    type: 'access'
  }, env.GALINE_JWT_SECRET, {
    expiresIn: '15m'
  })
}

async function generateGalineRefreshToken(eccalUser) {
  return await jwt.sign({
    sub: eccalUser.sub,
    email: eccalUser.email,
    type: 'refresh'
  }, env.GALINE_JWT_SECRET, {
    expiresIn: '7d'
  })
}
```

---

## 🧪 測試驗證步驟

### **1. 環境變數確認**
確保 Cloudflare Worker 環境變數已設置：
```bash
ECCAL_JWT_SECRET=<與 Eccal 相同的密鑰>
GALINE_JWT_SECRET=<galine 自己的密鑰>
```

### **2. 測試流程**
1. **清除瀏覽器 Cookie** - 確保是全新登入
2. **訪問 galine** - `https://galine.thinkwithblack.com`
3. **點擊 Google 登入** - 應重定向到 Eccal SSO
4. **完成 Google OAuth** - 授權後返回 galine
5. **檢查 URL 參數** - 應包含 `auth_success=true&token=...&user_id=...`
6. **驗證登入狀態** - 確認可以正常訪問受保護頁面

### **3. 日誌檢查重點**

#### **Eccal 端日誌（已就緒）**：
```
🕒 JWT 時間戳資訊: {
  iat: "2025-10-17T10:30:00.000Z",
  exp: "2025-10-24T10:30:00.000Z",
  serverTime: "2025-10-17T10:30:00.123Z",
  serverTimeUnix: 1729161000,
  validFor: "7 days",
  timeDiff: "iat vs now: 0 seconds"
}
✅ JWT 自我驗證成功
```

#### **galine Worker 端預期日誌**：
```
Eccal SSO 回調: {
  authSuccess: "true",
  hasToken: true,
  userId: "xxx-xxx-xxx"
}
JWT 驗證成功: {
  userId: "xxx-xxx-xxx",
  email: "user@example.com",
  membership: "free",
  iat: "2025-10-17T10:30:00.000Z",
  exp: "2025-10-24T10:30:00.000Z"
}
```

### **4. 錯誤排查**

如果仍出現 `exp claim timestamp check failed`：

1. **檢查 clockTolerance 是否已添加** - 確認代碼修改正確
2. **比對時間戳** - 查看 Eccal 和 Worker 日誌中的時間差異
3. **驗證密鑰一致性** - 確認 `ECCAL_JWT_SECRET` 完全相同
4. **檢查 JWT 格式** - token 應為 `header.payload.signature` 三段式

---

## 📊 JWT Token 結構參考

### **Eccal 生成的 JWT Payload**：
```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "name": "User Name",
  "membership": "free",
  "credits": 30,
  "iss": "eccal.thinkwithblack.com",
  "aud": "https://galine.thinkwithblack.com",
  "iat": 1729161000,
  "exp": 1729765800
}
```

### **字段說明**：
- `sub`: 用戶 ID（UUID 格式）
- `email`: 用戶 Email
- `name`: 用戶姓名
- `membership`: 會員等級（"free" / "pro" / "founders"）
- `credits`: 用戶點數
- `iss`: 發行者（Eccal）
- `aud`: 目標服務（galine）
- `iat`: 發行時間（Unix timestamp）
- `exp`: 過期時間（Unix timestamp，7 天後）

---

## ⚠️ 重要注意事項

### **1. 時鐘容忍度必須一致**
- Eccal 端：60 秒 ✅
- galine Worker 端：60 秒 ⚠️ **需要添加**

### **2. JWT 密鑰必須完全相同**
- 確認環境變數 `ECCAL_JWT_SECRET` 與 Eccal 生產環境一致
- 任何字符差異都會導致驗證失敗

### **3. 時區無關性**
- JWT 使用 Unix timestamp（UTC），與服務器時區無關
- 時鐘偏差通常來自系統時間不同步

---

## 🚀 部署檢查清單

- [ ] 修改 Worker 代碼添加 `clockTolerance: 60`
- [ ] 確認 `ECCAL_JWT_SECRET` 環境變數正確
- [ ] 部署到 Cloudflare Workers
- [ ] 清除測試用戶 Cookie
- [ ] 執行端到端登入測試
- [ ] 檢查 Worker 日誌確認 JWT 驗證成功
- [ ] 驗證 access/refresh token 生成正常

---

## 📞 技術支援

如有任何問題，請提供以下資訊：

1. **Worker 日誌截圖** - 包含 JWT 驗證錯誤訊息
2. **SSO 回調 URL** - 完整的 callback URL 參數
3. **時間戳資訊** - Worker 端的服務器時間
4. **測試帳號 Email** - 方便我們在 Eccal 端查詢日誌

---

**Eccal 技術團隊**  
更新日期：2025-10-17  
版本：v1.0
