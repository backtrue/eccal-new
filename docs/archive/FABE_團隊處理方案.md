# FABE 端權限整合處理方案

## 🚨 緊急問題
**eccal 創始會員（NT$5,990）無法在 Fabe 平台使用權限**

用戶 kaoic08@gmail.com (高樂) 已購買 eccal 創始會員，eccal 端已建立對應的 Fabe 權限記錄，但 Fabe 端無法識別。

---

## 📊 現況確認

### Eccal 端狀態 ✅
- 用戶：`kaoic08@gmail.com`
- 會員等級：`founders` (創始會員)
- Fabe 購買記錄：`已建立 completed 狀態`
- 產品：`FABE × SPIN 完整課程（創始會員專享）`
- 權限：`終身有效 (lifetime_access)`

### Fabe 端狀態 ❌
- 用戶無法使用課程權限
- 系統未識別 eccal 創始會員身份

---

## 🔧 FABE 端需要處理的方案

### 方案一：API 權限檢查整合 (推薦)

#### 1. 新增權限檢查端點
在用戶訪問 Fabe 課程時，調用 eccal API 檢查權限：

```javascript
// 在 Fabe 端用戶進入課程前
async function checkEccalFoundersAccess(userEmail) {
  try {
    const response = await fetch(
      `https://eccal.thinkwithblack.com/api/fabe/sync-permissions?email=${userEmail}`,
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer YOUR_API_TOKEN'
        }
      }
    );
    
    const data = await response.json();
    
    if (data.hasAccess && data.plan_type === 'founders') {
      // 允許用戶存取課程
      return {
        hasAccess: true,
        plan: 'lifetime',
        source: 'eccal_founders'
      };
    }
    
    return { hasAccess: false };
  } catch (error) {
    console.error('eccal 權限檢查失敗:', error);
    return { hasAccess: false };
  }
}
```

#### 2. 整合到 Fabe 權限系統

```javascript
// 在現有的權限檢查邏輯中加入
async function hasUserCourseAccess(userEmail) {
  // 1. 檢查 Fabe 本地購買記錄
  const localAccess = await checkLocalPurchases(userEmail);
  if (localAccess) return true;
  
  // 2. 檢查 eccal 創始會員權限
  const eccalAccess = await checkEccalFoundersAccess(userEmail);
  if (eccalAccess.hasAccess) {
    // 可選：在 Fabe 端建立對應記錄以提升效能
    await createLocalAccessRecord(userEmail, eccalAccess);
    return true;
  }
  
  return false;
}
```

---

### 方案二：資料同步整合

#### 1. 接收 eccal 同步資料
eccal 會調用 Fabe API 同步購買記錄：

```javascript
// POST /api/sync-eccal-purchase
app.post('/api/sync-eccal-purchase', async (req, res) => {
  const {
    user_email,
    product_type,
    access_start_date,
    access_end_date, // null 表示終身
    source_plan,
    metadata
  } = req.body;
  
  if (source_plan === 'eccal_founders') {
    // 為用戶建立終身課程權限
    await createLifetimeAccess(user_email, {
      source: 'eccal_founders',
      granted_at: access_start_date,
      metadata: metadata
    });
    
    res.json({ success: true, message: 'eccal 創始會員權限已同步' });
  }
});
```

---

### 方案三：SSO 整合 (長期方案)

#### 1. 建立跨平台 JWT Token 驗證
```javascript
// 驗證 eccal JWT token
async function verifyEccalToken(token) {
  try {
    const response = await fetch(
      'https://eccal.thinkwithblack.com/api/auth/verify-token',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const userData = await response.json();
    
    if (userData.success && userData.user.membership_level === 'founders') {
      return {
        valid: true,
        user: userData.user,
        hasLifetimeAccess: true
      };
    }
    
    return { valid: false };
  } catch (error) {
    return { valid: false };
  }
}
```

---

## 🚀 立即處理步驟

### 第一步：緊急修復 (最快)
實作方案一中的 API 權限檢查，立即解決 `kaoic08@gmail.com` 的問題。

### 第二步：測試驗證
```bash
# 測試 eccal API 回應
curl "https://eccal.thinkwithblack.com/api/fabe/sync-permissions?email=kaoic08@gmail.com"

# 預期回應：
{
  "hasAccess": true,
  "user": {
    "email": "kaoic08@gmail.com",
    "membership_level": "founders"
  },
  "plan_type": "founders",
  "expires_at": null
}
```

### 第三步：全面部署
確認 eccal 創始會員都能正常使用 Fabe 課程。

---

## 🔍 eccal 創始會員清單

需要驗證以下 7 位創始會員的 Fabe 權限：

1. `backtrue@bvgcorp.net` (邱煜庭)
2. `hourneau@gmail.com` (Stanley Ko)  
3. `kaoic08@gmail.com` (高樂) ← 當前問題用戶
4. `analytics@ecpaydata.tw` (綠界大數據)
5. `esther.focuz@gmail.com` (Carol A)
6. `janusnew2@gmail.com`
7. `2pluscs@gmail.com` (鋭齊科技BVG)

---

## 📞 技術聯絡

- **urgency**: 高 (用戶等待中)
- **impact**: 影響所有 eccal 創始會員
- **eccal 負責人**: [請填寫聯絡資訊]
- **預期完成時間**: 24 小時內

---

## ⚠️ 重要注意

1. **立即性**：高樂正在等待解決方案
2. **完整性**：確保所有 7 位創始會員都能正常使用
3. **持續性**：新的 eccal 創始會員購買後也要自動獲得權限
4. **安全性**：權限檢查要有適當的防護措施

請優先實作方案一，可以最快解決問題！