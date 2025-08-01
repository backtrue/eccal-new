# Fabe x Eccal 跨平台權限同步整合指南

## 概述

本文件說明 fabe.thinkwithblack.com（課程平台）與 eccal.thinkwithblack.com（廣告分析平台）之間的跨平台權限同步機制。目標是實現統一的用戶權限管理，讓 eccal 創始會員可以自動獲得 fabe 平台的課程存取權限。

## 架構設計

### 平台定位
- **Eccal (eccal.thinkwithblack.com)**: 廣告預算計算與分析平台
  - 月訂閱：1,280 NT$/月
  - 年訂閱：12,800 NT$/年
  - 創始會員：5,990 NT$（終身）
  
- **Fabe (fabe.thinkwithblack.com)**: 線上課程平台
  - 年訂閱：999 NT$/年

### 權限映射關係
```
Eccal 創始會員 (5,990 NT$ 終身) → Fabe 年訂閱權限 (999 NT$/年)
```

## 技術實現

### 1. 數據庫架構

**Eccal 用戶表結構 (users)**
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  membership_level VARCHAR(20) DEFAULT 'free', -- 'free', 'pro'
  membership_expires_at TIMESTAMP,
  google_id VARCHAR(255),
  facebook_id VARCHAR(255),
  meta_access_token TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Stripe 付款記錄表 (stripe_payments)**
```sql
CREATE TABLE stripe_payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  stripe_payment_intent_id VARCHAR(255) UNIQUE,
  amount INTEGER NOT NULL, -- 以分為單位
  currency VARCHAR(3) DEFAULT 'twd',
  status VARCHAR(20) DEFAULT 'pending',
  plan_type VARCHAR(20), -- 'monthly', 'annual', 'founders'
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 2. API 端點

#### A. Eccal 提供的同步端點

**GET /api/fabe/sync-permissions**
```javascript
// 檢查用戶是否為 eccal 創始會員
app.get('/api/fabe/sync-permissions', async (req, res) => {
  const { email } = req.query;
  
  try {
    const user = await db.select()
      .from(users)
      .where(eq(users.email, email));
    
    if (!user.length) {
      return res.json({
        hasAccess: false,
        reason: 'user_not_found'
      });
    }
    
    const userData = user[0];
    
    // 檢查是否為創始會員（終身方案）
    const foundersPayment = await db.select()
      .from(stripe_payments)
      .where(and(
        eq(stripe_payments.user_id, userData.id),
        eq(stripe_payments.plan_type, 'founders'),
        eq(stripe_payments.status, 'succeeded')
      ));
    
    return res.json({
      hasAccess: foundersPayment.length > 0,
      membership_level: userData.membership_level,
      plan_type: foundersPayment.length > 0 ? 'founders' : null,
      expires_at: null // 創始會員終身有效
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

#### B. Fabe 需要實現的端點

**POST /api/eccal/grant-access**
```javascript
// Fabe 端接收 eccal 權限同步請求
app.post('/api/eccal/grant-access', async (req, res) => {
  const { email, membership_level, plan_type } = req.body;
  
  try {
    // 檢查用戶是否存在
    let user = await fabe_db.findUserByEmail(email);
    
    if (!user) {
      // 創建新用戶
      user = await fabe_db.createUser({
        email,
        source: 'eccal_sync'
      });
    }
    
    // 如果是 eccal 創始會員，授予 fabe 年訂閱權限
    if (plan_type === 'founders') {
      await fabe_db.grantSubscription(user.id, {
        type: 'annual',
        source: 'eccal_founders',
        expires_at: null // 或設定很遠的到期日
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to grant access' });
  }
});
```

### 3. 同步觸發機制

#### 方案 A: Webhook 同步（推薦）
當用戶在 eccal 完成創始會員付款時，自動觸發 fabe 權限同步：

```javascript
// eccal 端付款成功後觸發
async function syncToFabe(user, paymentData) {
  if (paymentData.plan_type === 'founders') {
    try {
      const response = await fetch('https://fabe.thinkwithblack.com/api/eccal/grant-access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FABE_API_KEY}` // 需要設定 API Key
        },
        body: JSON.stringify({
          email: user.email,
          membership_level: 'pro',
          plan_type: 'founders'
        })
      });
      
      if (!response.ok) {
        console.error('Failed to sync to Fabe:', await response.text());
      }
    } catch (error) {
      console.error('Fabe sync error:', error);
    }
  }
}
```

#### 方案 B: SSO 即時檢查
用戶登入 fabe 時，即時檢查 eccal 權限：

```javascript
// fabe 端用戶登入時檢查
async function checkEccalPermissions(email) {
  try {
    const response = await fetch(`https://eccal.thinkwithblack.com/api/fabe/sync-permissions?email=${email}`, {
      headers: {
        'Authorization': `Bearer ${ECCAL_API_KEY}`
      }
    });
    
    const data = await response.json();
    
    if (data.hasAccess && data.plan_type === 'founders') {
      // 授予 fabe 權限
      await grantFabeAccess(email);
    }
  } catch (error) {
    console.error('Eccal permission check failed:', error);
  }
}
```

### 4. 安全性考量

#### API 金鑰驗證
```javascript
// 驗證 API 請求
const FABE_API_KEY = process.env.FABE_API_KEY;
const ECCAL_API_KEY = process.env.ECCAL_API_KEY;

function verifyApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token || token !== EXPECTED_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
}
```

#### IP 白名單（可選）
```javascript
const ALLOWED_IPS = [
  '34.111.179.208', // eccal 服務器 IP
  // 其他授權 IP
];

function checkIPWhitelist(req, res, next) {
  const clientIP = req.ip || req.connection.remoteAddress;
  
  if (!ALLOWED_IPS.includes(clientIP)) {
    return res.status(403).json({ error: 'IP not allowed' });
  }
  
  next();
}
```

## 實作步驟

### Eccal 端（已完成）
- ✅ 用戶認證系統
- ✅ Stripe 付款處理
- ✅ 創始會員方案
- ✅ 用戶權限管理
- ✅ **Fabe 同步 API 端點 (已測試並正常運作)**

### Fabe 端（需要實作）
- ⏳ 接收 eccal 權限同步的 API 端點
- ⏳ 用戶權限授予機制
- ⏳ SSO 登入時權限檢查
- ⏳ API 金鑰驗證機制

## 測試案例

### 1. 創始會員購買測試
1. 用戶在 eccal 購買創始會員方案（5,990 NT$）
2. 付款成功後，eccal 自動呼叫 fabe API
3. Fabe 授予該用戶年訂閱權限
4. 用戶登入 fabe 時可以存取所有課程內容

### 2. 權限驗證測試

✅ **已測試並正常運作 (2025-08-01)**

#### 測試結果:
```bash
# ✅ 測試 eccal 權限檢查 API - 成功
curl -X GET "https://eccal.thinkwithblack.com/api/fabe/sync-permissions?email=2pluscs@gmail.com"
# 回應: {"hasAccess":true,"user":{"id":"113789521099917357494",...},"plan_type":"founders",...}

# ✅ 測試創始會員列表 API - 成功
curl -X GET "https://eccal.thinkwithblack.com/api/fabe/founders-list"
# 回應: {"total":5,"users":[...]} (目前有5位創始會員)

# ✅ 測試手動同步觸發 API - 成功
curl -X POST "https://eccal.thinkwithblack.com/api/fabe/trigger-sync" \
  -H "Content-Type: application/json" \
  -d '{"email":"2pluscs@gmail.com"}'
# 回應: {"success":true,"message":"Sync triggered successfully",...}
```

#### Fabe 端需要實作:
```bash
# 測試 fabe 權限授予 API (待 fabe 端實作)
curl -X POST "https://fabe.thinkwithblack.com/api/eccal/grant-access" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"email":"test@example.com","membership_level":"pro","plan_type":"founders"}'
```

## 聯絡資訊

- **Eccal 技術負責人**: [您的聯絡方式]
- **整合測試環境**: https://eccal.thinkwithblack.com
- **API 文件**: 本文件
- **緊急聯絡**: [緊急聯絡方式]

---

**備註**: 此整合需要雙方協作完成，建議先在測試環境驗證所有功能後再部署到正式環境。