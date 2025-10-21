# ECCAL SSO 整合決策指南

## 🎯 **開始之前：我應該用哪種方案？**

這份指南幫助你選擇最適合的整合方案，避免不必要的複雜度。

---

## ⚡ **快速決策樹（30 秒找到答案）**

```
┌─────────────────────────────────────┐
│ 你需要後端驗證/儲存用戶資料嗎？      │
└────────────┬───────────────┬────────┘
             │ NO            │ YES
             ▼               ▼
    ┌────────────────┐  ┌─────────────────┐
    │ 用 SDK 方案    │  │ 你熟悉 API 嗎？ │
    │ (推薦95%情況) │  └────┬────────┬───┘
    └────────────────┘       │ NO     │ YES
                             ▼        ▼
                     ┌───────────┐  ┌──────────┐
                     │ SDK +     │  │ 手動整合 │
                     │ 後端驗證  │  │ (進階)   │
                     └───────────┘  └──────────┘
```

---

## 📊 **方案比較**

| 特性 | SDK 方案 | SDK + 後端 | 手動整合 |
|------|---------|-----------|---------|
| **難度** | ⭐ 簡單 | ⭐⭐ 中等 | ⭐⭐⭐⭐⭐ 困難 |
| **設置時間** | 5 分鐘 | 30 分鐘 | 2-4 小時 |
| **需要後端？** | ❌ 否 | ✅ 是 | ✅ 是 |
| **程式碼量** | ~10 行 | ~50 行 | ~200+ 行 |
| **錯誤率** | ⭐ 低 | ⭐⭐ 中 | ⭐⭐⭐⭐⭐ 高 |
| **維護成本** | 低 | 中 | 高 |
| **適用情況** | 大部分情況 | 需要後端邏輯 | 特殊需求 |

---

## 🎯 **方案 1：純 SDK（推薦 95% 的情況）**

### **適合你，如果：**

✅ 你只需要知道用戶是誰  
✅ 你不需要在自己的資料庫儲存用戶資料  
✅ 你想要最快速完成整合  
✅ 你不想處理複雜的 API 調用

### **不適合你，如果：**

❌ 你需要在後端驗證每個請求  
❌ 你需要儲存用戶的額外資料（例如：用戶設定、訂單記錄）  
❌ 你需要執行複雜的權限檢查

### **整合步驟**

📄 **參考文檔**：`ECCAL_SSO_ZERO_CONFIG_GUIDE.md`

**1. 引入 SDK（1 行）**
```html
<script src="https://eccal.thinkwithblack.com/eccal-auth-sdk.js"></script>
```

**2. 初始化（5 行）**
```javascript
const eccalAuth = new EccalAuth({
  siteName: 'your-service-name',
  onLogin: (user) => console.log('登入成功', user)
});
```

**3. 登入按鈕（1 行）**
```html
<button onclick="eccalAuth.login()">登入</button>
```

**完成！** 🎉

### **範例專案**

- 📄 HTML 範例：`docs/tests/sso-sdk-test.html`
- 📄 React 範例：`ECCAL_SSO_ZERO_CONFIG_GUIDE.md` 中的 React 區段

---

## 🔧 **方案 2：SDK + 後端驗證**

### **適合你，如果：**

✅ 你需要在後端驗證每個 API 請求  
✅ 你需要在資料庫儲存用戶資料  
✅ 你需要實現權限控制  
✅ 你有自己的後端系統

### **不適合你，如果：**

❌ 你只是一個靜態網站  
❌ 你不需要後端邏輯

### **架構**

```
前端 (使用 SDK)
    ↓ (取得 token)
你的後端 API
    ↓ (驗證 token)
ECCAL API (/api/sso/verify-token)
    ↓ (返回用戶資訊)
你的後端
    ↓ (建立 session/查找用戶)
返回給前端
```

### **整合步驟**

**前端（使用 SDK）**

📄 **參考**：`ECCAL_SSO_ZERO_CONFIG_GUIDE.md`

```javascript
const eccalAuth = new EccalAuth({
  siteName: 'your-service',
  onLogin: async (user) => {
    // 取得 token 並傳給你的後端
    const token = eccalAuth.getToken();
    
    // 調用你的後端 API
    const res = await fetch('https://api.your-service.com/auth/login', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (res.ok) {
      console.log('後端登入成功');
    }
  }
});
```

**後端（驗證 token）**

📄 **參考**：`SERP_SSO_DIAGNOSTIC_GUIDE.md` 步驟 4

```javascript
// Node.js 範例
app.post('/auth/login', async (req, res) => {
  const eccalToken = req.headers.authorization?.replace('Bearer ', '');
  
  // 調用 eccal API 驗證
  const verifyRes = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://your-service.thinkwithblack.com'
    },
    body: JSON.stringify({ token: eccalToken })
  });
  
  const { success, valid, user } = await verifyRes.json();
  
  if (success && valid) {
    // Token 有效，建立你的 session
    req.session.userId = user.id;
    res.json({ success: true, user });
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
});
```

### **範例專案**

- 📄 後端範例：`SERP_SSO_DIAGNOSTIC_GUIDE.md`
- 📄 API 文檔：`SSO_VERIFY_TOKEN_SPEC.md`

---

## 🛠️ **方案 3：手動整合（不推薦）**

### **適合你，如果：**

✅ 你有特殊需求無法用 SDK 滿足  
✅ 你需要完全自訂整合流程  
✅ 你對 JWT、OAuth、CORS 非常熟悉

### **不適合你，如果：**

❌ 你只是想快速完成整合  
❌ 你不熟悉 API 整合  
❌ 你沒有足夠時間除錯

### **為什麼不推薦？**

- ❌ **耗時**：需要 2-4 小時（vs SDK 的 5 分鐘）
- ❌ **容易出錯**：需要處理 token 儲存、CORS、錯誤處理等
- ❌ **維護成本高**：API 更新時需要手動修改

### **如果你堅持要手動整合**

📄 **參考文檔**：
- `SSO_VERIFY_TOKEN_SPEC.md` - 完整 API 規格
- `INTEGRATED_SSO_GUIDE.md` - 詳細整合指南
- `SERP_SSO_DIAGNOSTIC_GUIDE.md` - 診斷指南

**核心流程**：

1. 重定向到 Google SSO
2. 接收回調參數（token）
3. 儲存 token 到 localStorage
4. 調用 `/api/sso/verify-token` 驗證
5. 處理錯誤和 token 過期

**注意事項**：
- ⚠️ 必須正確設置 CORS headers
- ⚠️ 必須處理 token 過期
- ⚠️ 必須正確清理 URL 參數
- ⚠️ 必須處理多種錯誤情況

---

## 🎓 **常見情境決策**

### **情境 1：簡單的行銷網站**

**需求**：用戶登入後顯示個人化內容

**建議方案**：✅ **純 SDK**

**理由**：不需要後端，SDK 自動處理所有事情

---

### **情境 2：SaaS 應用（如 serp.thinkwithblack.com）**

**需求**：
- 用戶登入
- 儲存用戶設定
- API 需要驗證

**建議方案**：✅ **SDK + 後端驗證**

**理由**：前端用 SDK 快速整合，後端驗證 API 請求

---

### **情境 3：內容平台**

**需求**：
- 用戶登入
- 追蹤用戶瀏覽記錄
- 個人化推薦

**建議方案**：✅ **SDK + 後端驗證**

**理由**：需要後端儲存用戶行為資料

---

### **情境 4：單頁靜態網站**

**需求**：只需要顯示"歡迎，XXX"

**建議方案**：✅ **純 SDK**

**理由**：最簡單快速

---

## 📋 **快速檢查清單**

### **選擇 SDK 方案前，確認：**

- [ ] 你不需要在後端驗證每個請求
- [ ] 你不需要儲存額外的用戶資料
- [ ] 你想要最快速完成整合
- [ ] 你的域名已加入 eccal 允許清單

### **選擇 SDK + 後端方案前，確認：**

- [ ] 你有自己的後端系統
- [ ] 你需要驗證 API 請求
- [ ] 你需要儲存用戶資料
- [ ] 你的團隊有後端開發能力

### **選擇手動整合前，三思：**

- [ ] 你確定 SDK 無法滿足需求？
- [ ] 你有足夠時間處理除錯？
- [ ] 你對 API 整合非常熟悉？
- [ ] 你願意承擔高維護成本？

---

## 🆘 **還是不確定？**

### **問自己這 3 個問題：**

**Q1: 我需要後端嗎？**
- NO → 純 SDK ✅
- YES → 繼續 Q2

**Q2: 我的後端需要驗證每個請求嗎？**
- NO → 純 SDK ✅
- YES → SDK + 後端 ✅

**Q3: 我有特殊需求無法用 SDK 滿足嗎？**
- NO → SDK + 後端 ✅
- YES → 聯繫我們討論 📧

---

## 📞 **技術支援**

如果你還是不確定應該用哪種方案：

1. **描述你的需求**
   - 你的應用是什麼？
   - 你需要什麼功能？
   - 你有後端嗎？

2. **聯繫我們**
   - Email: backtrue@thinkwithblack.com
   - 我們會幫你選擇最適合的方案

---

## 🎯 **推薦閱讀順序**

### **如果選擇 SDK 方案**
1. `ECCAL_SSO_ZERO_CONFIG_GUIDE.md` ← 從這裡開始
2. `docs/tests/sso-sdk-test.html` ← 測試範例

### **如果選擇 SDK + 後端**
1. `ECCAL_SSO_ZERO_CONFIG_GUIDE.md` ← 前端整合
2. `SERP_SSO_DIAGNOSTIC_GUIDE.md` 步驟 4 ← 後端驗證
3. `SSO_VERIFY_TOKEN_SPEC.md` ← API 詳細文檔

### **如果選擇手動整合**
1. `SSO_VERIFY_TOKEN_SPEC.md` ← API 規格
2. `INTEGRATED_SSO_GUIDE.md` ← 完整指南
3. `SERP_SSO_DIAGNOSTIC_GUIDE.md` ← 診斷工具

---

**最後更新**：2025-10-21  
**維護者**：Eccal 技術團隊

---

## 💡 **記住**

> **95% 的情況下，使用 SDK 方案就夠了。**
>
> 只有在你真的需要後端邏輯時，才選擇 SDK + 後端方案。
>
> 除非有非常特殊的需求，否則不要選擇手動整合。

**疑問時，選 SDK。** 👍
