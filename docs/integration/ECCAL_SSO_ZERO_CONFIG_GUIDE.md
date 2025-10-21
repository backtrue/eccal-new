# ECCAL SSO 零配置整合指南 - 5 分鐘完成整合

## 🎯 **這份指南適合誰？**

- ✅ 你只想快速完成 SSO 整合，不想了解技術細節
- ✅ 你不想處理 JWT、CORS、API 調用等複雜概念
- ✅ 你想複製貼上就能運作

**如果你想深入了解技術細節**，請參考其他文檔。但對於大部分情況，這份指南就夠了。

---

## ⚡ **3 步驟完成整合（真的只要 3 步）**

### 步驟 1：加入 SDK（1 行程式碼）

在你的 HTML 的 `<head>` 區段加入：

```html
<script src="https://eccal.thinkwithblack.com/eccal-auth-sdk.js"></script>
```

### 步驟 2：初始化 SDK（5 行程式碼）

在你的 JavaScript 中加入：

```javascript
const eccalAuth = new EccalAuth({
  siteName: 'serp',  // 改成你的子服務名稱
  onLogin: (user) => {
    console.log('用戶登入成功！', user);
    // 在這裡處理登入後的邏輯（例如：更新 UI）
  }
});
```

### 步驟 3：加入登入按鈕（1 行程式碼）

在登入按鈕的 `onclick` 事件中：

```html
<button onclick="eccalAuth.login()">使用 Google 登入</button>
```

**完成！** 就這麼簡單。

---

## 📄 **完整範例（可直接複製使用）**

創建一個 `index.html`，複製以下內容：

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ECCAL SSO 整合範例</title>
  
  <!-- 步驟 1: 引入 SDK -->
  <script src="https://eccal.thinkwithblack.com/eccal-auth-sdk.js"></script>
  
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
    }
    button {
      padding: 12px 24px;
      font-size: 16px;
      cursor: pointer;
      background: #4285f4;
      color: white;
      border: none;
      border-radius: 4px;
    }
    button:hover {
      background: #357ae8;
    }
    .user-info {
      margin-top: 20px;
      padding: 15px;
      background: #f5f5f5;
      border-radius: 4px;
    }
    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <h1>ECCAL SSO 整合範例</h1>
  
  <!-- 未登入時顯示 -->
  <div id="login-section">
    <p>點擊下方按鈕使用 Google 帳號登入</p>
    <button onclick="eccalAuth.login()">🔐 使用 Google 登入</button>
  </div>
  
  <!-- 登入後顯示 -->
  <div id="user-section" class="hidden">
    <div class="user-info">
      <h2>歡迎！</h2>
      <p><strong>姓名：</strong><span id="user-name"></span></p>
      <p><strong>Email：</strong><span id="user-email"></span></p>
      <p><strong>會員等級：</strong><span id="user-membership"></span></p>
      <p><strong>點數餘額：</strong><span id="user-credits"></span></p>
    </div>
    <button onclick="handleLogout()">登出</button>
  </div>
  
  <script>
    // 步驟 2: 初始化 SDK
    const eccalAuth = new EccalAuth({
      siteName: 'serp',  // ← 改成你的子服務名稱
      
      onLogin: (user) => {
        console.log('✅ 用戶登入成功！', user);
        
        // 更新 UI 顯示用戶資訊
        document.getElementById('login-section').classList.add('hidden');
        document.getElementById('user-section').classList.remove('hidden');
        document.getElementById('user-name').textContent = user.name || '未提供';
        document.getElementById('user-email').textContent = user.email;
        document.getElementById('user-membership').textContent = user.membership || 'free';
        document.getElementById('user-credits').textContent = user.credits || 0;
      },
      
      onLogout: () => {
        console.log('👋 用戶已登出');
        
        // 更新 UI
        document.getElementById('login-section').classList.remove('hidden');
        document.getElementById('user-section').classList.add('hidden');
      },
      
      onError: (error) => {
        console.error('❌ 發生錯誤:', error);
        alert('登入失敗，請稍後再試');
      }
    });
    
    // 登出函數
    function handleLogout() {
      if (confirm('確定要登出嗎？')) {
        eccalAuth.logout();
      }
    }
    
    // 頁面載入時檢查登入狀態
    window.addEventListener('load', async () => {
      const user = await eccalAuth.checkAuth();
      if (user) {
        console.log('✅ 用戶已登入:', user);
        // 觸發 onLogin 更新 UI
        eccalAuth.onLogin(user);
      } else {
        console.log('ℹ️ 用戶未登入');
      }
    });
  </script>
</body>
</html>
```

**部署這個檔案，立即可用！**

---

## 🎨 **React/Vue/Angular 整合**

### React 範例

```jsx
import { useEffect, useState } from 'react';

function App() {
  const [user, setUser] = useState(null);
  const [eccalAuth] = useState(() => {
    return new window.EccalAuth({
      siteName: 'serp',
      onLogin: (user) => setUser(user),
      onLogout: () => setUser(null)
    });
  });
  
  useEffect(() => {
    // 檢查登入狀態
    eccalAuth.checkAuth().then(user => {
      if (user) setUser(user);
    });
  }, []);
  
  if (!user) {
    return (
      <div>
        <h1>請登入</h1>
        <button onClick={() => eccalAuth.login()}>
          使用 Google 登入
        </button>
      </div>
    );
  }
  
  return (
    <div>
      <h1>歡迎，{user.name}！</h1>
      <p>Email: {user.email}</p>
      <p>會員等級: {user.membership}</p>
      <p>點數: {user.credits}</p>
      <button onClick={() => eccalAuth.logout()}>登出</button>
    </div>
  );
}

export default App;
```

**在 `public/index.html` 的 `<head>` 中加入**：
```html
<script src="https://eccal.thinkwithblack.com/eccal-auth-sdk.js"></script>
```

### Vue 範例

```vue
<template>
  <div>
    <div v-if="!user">
      <h1>請登入</h1>
      <button @click="login">使用 Google 登入</button>
    </div>
    
    <div v-else>
      <h1>歡迎，{{ user.name }}！</h1>
      <p>Email: {{ user.email }}</p>
      <p>會員等級: {{ user.membership }}</p>
      <p>點數: {{ user.credits }}</p>
      <button @click="logout">登出</button>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      user: null,
      eccalAuth: null
    };
  },
  
  mounted() {
    this.eccalAuth = new window.EccalAuth({
      siteName: 'serp',
      onLogin: (user) => {
        this.user = user;
      },
      onLogout: () => {
        this.user = null;
      }
    });
    
    // 檢查登入狀態
    this.eccalAuth.checkAuth().then(user => {
      if (user) this.user = user;
    });
  },
  
  methods: {
    login() {
      this.eccalAuth.login();
    },
    logout() {
      this.eccalAuth.logout();
    }
  }
};
</script>
```

---

## 🔧 **常用功能**

### 檢查用戶是否已登入

```javascript
if (eccalAuth.isAuthenticated()) {
  console.log('用戶已登入');
  const user = eccalAuth.getUser();
  console.log(user);
}
```

### 取得用戶資訊

```javascript
const user = eccalAuth.getUser();
console.log('用戶姓名:', user.name);
console.log('Email:', user.email);
console.log('會員等級:', user.membership);
console.log('點數:', user.credits);
```

### 取得 Token（如果你的後端需要）

```javascript
const token = eccalAuth.getToken();

// 在 API 請求中使用
fetch('https://api.your-service.com/api/data', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### 執行需要認證的請求

```javascript
// SDK 會自動處理 token、錯誤、重試
const response = await eccalAuth.authenticatedRequest(
  'https://api.your-service.com/api/data',
  {
    method: 'POST',
    body: JSON.stringify({ data: 'example' })
  }
);
```

---

## ❓ **常見問題**

### Q1: 我需要自己的後端嗎？

**不需要！** SDK 會直接與 eccal API 溝通，你不需要自己的後端伺服器。

如果你需要儲存用戶資料或執行特定業務邏輯，那才需要後端。

### Q2: 如何在後端驗證 token？

如果你有自己的後端，使用這個方式驗證：

```javascript
// Node.js 後端範例
const token = req.headers.authorization?.replace('Bearer ', '');

const verifyRes = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': 'https://your-service.thinkwithblack.com'
  },
  body: JSON.stringify({ token })
});

const { success, valid, user } = await verifyRes.json();

if (success && valid) {
  // Token 有效，user 包含用戶資訊
  console.log('用戶:', user);
} else {
  // Token 無效
  res.status(401).json({ error: 'Unauthorized' });
}
```

### Q3: SDK 會自動處理什麼？

✅ **SDK 自動處理：**
- Google OAuth 登入流程
- Token 儲存到 localStorage
- Token 驗證
- CORS headers
- URL 回調參數清理
- 錯誤處理
- Token 過期自動刷新

❌ **你不需要：**
- 手動呼叫 `/api/sso/verify-token`
- 處理 CORS
- 管理 token 儲存
- 清理 URL 參數

### Q4: 如何除錯？

打開瀏覽器的 Console（F12），SDK 會自動輸出詳細的 log：

```
Redirecting to Google SSO: https://...
Verifying token with: {...}
Token verification response: {...}
✅ 用戶登入成功！ {name: "...", email: "..."}
```

### Q5: 支援哪些瀏覽器？

✅ 支援所有現代瀏覽器：
- Chrome/Edge (最新版)
- Firefox (最新版)
- Safari (最新版)
- Mobile browsers

---

## 🚀 **部署檢查清單**

在部署到生產環境前，確認：

- [ ] 已在 `public/index.html` 或 `<head>` 中引入 SDK
- [ ] 已設置正確的 `siteName`
- [ ] 登入/登出按鈕功能正常
- [ ] 在瀏覽器 Console 沒有錯誤訊息
- [ ] 你的域名已加入 eccal 允許清單（聯繫 eccal 團隊）

---

## 🆘 **還是遇到問題？**

### 自動診斷

在瀏覽器 Console 執行：

```javascript
// 檢查 SDK 是否載入
console.log('SDK 已載入?', typeof EccalAuth !== 'undefined');

// 檢查當前狀態
console.log('已登入?', eccalAuth.isAuthenticated());
console.log('用戶資訊:', eccalAuth.getUser());
console.log('Token:', eccalAuth.getToken());

// 測試登入流程
eccalAuth.login();  // 會跳轉到 Google 登入
```

### 常見錯誤

**錯誤 1: `EccalAuth is not defined`**
```
原因：SDK 沒有載入
解決：確認 <script src="https://eccal.thinkwithblack.com/eccal-auth-sdk.js"></script> 在 <head> 中
```

**錯誤 2: CORS 錯誤**
```
原因：你的域名不在允許清單中
解決：聯繫 eccal 團隊加入你的域名
```

**錯誤 3: Token 驗證失敗**
```
原因：Token 過期或無效
解決：執行 eccalAuth.logout() 然後重新登入
```

### 技術支援

如果以上方法都無法解決問題：

1. 在瀏覽器 Console 複製所有錯誤訊息
2. 提供你的域名
3. 聯繫：backtrue@thinkwithblack.com

---

## 📚 **進階文檔**

如果你需要：
- 自訂登入流程
- 後端整合
- 進階錯誤處理
- 多頁面狀態同步

請參考：
- `docs/api/SSO_VERIFY_TOKEN_SPEC.md` - API 詳細規格
- `docs/integration/INTEGRATED_SSO_GUIDE.md` - 完整整合指南

---

**最後更新**：2025-10-21  
**版本**：1.0  
**狀態**：✅ 生產環境可用

---

## 💡 **為什麼這個方案更好？**

| 傳統整合方式 | 使用 SDK |
|------------|---------|
| ❌ 需要理解 JWT、OAuth、CORS | ✅ 不需要理解技術細節 |
| ❌ 手動處理 token 儲存 | ✅ 自動處理 |
| ❌ 手動處理錯誤 | ✅ 自動錯誤處理 |
| ❌ 需要寫 50+ 行程式碼 | ✅ 只需要 5 行程式碼 |
| ❌ 容易出錯 | ✅ 經過測試，穩定可靠 |
| ❌ 需要反覆除錯 | ✅ 開箱即用 |

**推薦所有新的子服務都使用 SDK 整合！**
