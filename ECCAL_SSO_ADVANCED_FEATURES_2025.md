# Eccal SSO 進階功能整合指南 (2025)

## 📋 概述

本文件是 `INTEGRATED_SSO_GUIDE.md` 的補充，專門介紹 2025 年新增的進階功能，包括統一折扣券系統、Meta 追蹤整合和強化會員系統。

## 🎯 新增功能概覽

### 1. 統一折扣券系統 (2025-08-06)
- eccal 作為折扣券管理中心
- 支援跨平台折扣碼驗證和應用
- 多貨幣支援 (TWD/USD/JPY)

### 2. Meta Purchase 事件追蹤 (2025-08-07)
- 正確的轉換事件觸發時機
- 跨域事件追蹤機制
- 購買事件的精確數據

### 3. 強化會員系統 (2025-08-01)
- 創始會員 (founders) 等級
- fabe 課程權限自動同步
- 跨平台會員權益

## 🆕 新增 API 端點

### 折扣券 API
```javascript
// 驗證折扣碼
POST /api/discount-codes/validate-cross-platform
{
  "code": "WELCOME20",
  "amount": 1000,
  "currency": "TWD", 
  "service_name": "your_service"
}

// 應用折扣碼
POST /api/discount-codes/apply-cross-platform
{
  "code": "WELCOME20",
  "amount": 1000,
  "currency": "TWD",
  "service_name": "your_service",
  "user_email": "user@example.com"
}
```

### Meta 事件追蹤 API
```javascript
// 獲取購買事件
GET /api/meta-events/purchase-events
Authorization: Bearer {jwt_token}

// 測試購買事件觸發
POST /api/meta-events/trigger-purchase-event
{
  "paymentType": "founders_membership",
  "amount": 599000,
  "currency": "TWD"
}
```

### Fabe 整合 API
```javascript
// 同步 fabe 權限
POST /api/fabe/sync-permissions
{
  "userId": "user_id"
}

// 查詢創始會員清單
GET /api/fabe/founders-list
```

## 🔧 子服務整合範例

### 1. 折扣券系統整合

```javascript
// 折扣券驗證功能
class DiscountService {
  constructor() {
    this.baseURL = 'https://eccal.thinkwithblack.com';
  }

  async validateDiscount(code, amount, currency = 'TWD') {
    try {
      const response = await fetch(`${this.baseURL}/api/discount-codes/validate-cross-platform`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin
        },
        body: JSON.stringify({
          code,
          amount,
          currency,
          service_name: this.getServiceName()
        })
      });

      const result = await response.json();
      
      if (result.valid) {
        return {
          valid: true,
          discountAmount: result.discountAmount,
          finalAmount: result.finalAmount,
          trackingId: result.trackingId
        };
      } else {
        return { valid: false, error: result.message };
      }
    } catch (error) {
      console.error('Discount validation failed:', error);
      return { valid: false, error: 'Network error' };
    }
  }

  async applyDiscount(code, amount, userEmail, trackingId) {
    try {
      const response = await fetch(`${this.baseURL}/api/discount-codes/apply-cross-platform`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin
        },
        body: JSON.stringify({
          code,
          amount,
          currency: 'TWD',
          service_name: this.getServiceName(),
          user_email: userEmail,
          tracking_id: trackingId
        })
      });

      return await response.json();
    } catch (error) {
      console.error('Discount application failed:', error);
      return { success: false, error: 'Network error' };
    }
  }

  getServiceName() {
    return window.location.hostname.split('.')[0];
  }
}

// 使用範例
const discountService = new DiscountService();

// 在結帳頁面驗證折扣碼
async function handleDiscountCode(code, orderAmount) {
  const result = await discountService.validateDiscount(code, orderAmount);
  
  if (result.valid) {
    console.log(`折扣後金額: ${result.finalAmount}`);
    console.log(`節省金額: ${result.discountAmount}`);
    
    // 顯示折扣資訊給用戶
    updateOrderSummary(result);
  } else {
    console.error('折扣碼無效:', result.error);
    showErrorMessage(result.error);
  }
}
```

### 2. Meta 事件追蹤整合

```javascript
// Meta 購買事件追蹤
class MetaTrackingService {
  constructor() {
    this.baseURL = 'https://eccal.thinkwithblack.com';
    this.startPolling();
  }

  // 輪詢購買事件
  startPolling() {
    setInterval(async () => {
      await this.checkPurchaseEvents();
    }, 5000); // 每 5 秒檢查一次
  }

  async checkPurchaseEvents() {
    const token = localStorage.getItem('eccal_auth_token');
    if (!token) return;

    try {
      const response = await fetch(`${this.baseURL}/api/meta-events/purchase-events`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Origin': window.location.origin
        }
      });

      const data = await response.json();
      
      if (data.success && data.event) {
        this.handlePurchaseEvent(data.event);
      }
    } catch (error) {
      console.error('Failed to check purchase events:', error);
    }
  }

  handlePurchaseEvent(event) {
    // 觸發 Meta Pixel Purchase 事件
    if (typeof fbq !== 'undefined') {
      fbq('track', 'Purchase', {
        content_name: `Eccal ${event.paymentType} Membership`,
        content_category: 'Membership',
        value: event.amount / 100,
        currency: event.currency,
        transaction_id: event.transactionId
      });
      
      console.log('Meta Purchase event tracked:', event);
    }
  }

  // 測試購買事件（僅開發環境）
  async triggerTestEvent(paymentType = 'founders_membership') {
    const token = localStorage.getItem('eccal_auth_token');
    if (!token) return;

    try {
      const response = await fetch(`${this.baseURL}/api/meta-events/trigger-purchase-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify({
          paymentType,
          amount: 599000,
          currency: 'TWD'
        })
      });

      const result = await response.json();
      console.log('Test event triggered:', result);
    } catch (error) {
      console.error('Failed to trigger test event:', error);
    }
  }
}

// 初始化 Meta 追蹤
const metaTracking = new MetaTrackingService();
```

### 3. 強化會員系統檢查

```javascript
// 會員權限檢查
function checkMembershipLevel(user) {
  switch (user.membership) {
    case 'founders':
      return {
        level: 'founders',
        displayName: '創始會員',
        badge: '🏆',
        features: ['所有 Pro 功能', 'fabe 課程權限', '終身會員'],
        fabeAccess: user.fabeAccess || true
      };
    case 'pro':
      return {
        level: 'pro',
        displayName: 'Pro 會員',
        badge: '⭐',
        features: ['進階功能', '無限使用'],
        fabeAccess: false
      };
    default:
      return {
        level: 'free',
        displayName: '免費用戶',
        badge: '👤',
        features: ['基本功能'],
        fabeAccess: false
      };
  }
}

// 顯示會員資訊
function displayMembershipInfo(user) {
  const membership = checkMembershipLevel(user);
  
  const membershipHTML = `
    <div class="membership-info">
      <h3>${membership.badge} ${membership.displayName}</h3>
      <ul>
        ${membership.features.map(feature => `<li>${feature}</li>`).join('')}
      </ul>
      ${membership.fabeAccess ? '<p>✅ 已開通 fabe 課程權限</p>' : ''}
    </div>
  `;
  
  document.getElementById('membership-display').innerHTML = membershipHTML;
}
```

## 🔄 更新的 JWT Token 結構

```json
{
  "sub": "用戶ID",
  "email": "用戶郵箱", 
  "name": "用戶姓名",
  "membership": "會員等級（free/pro/founders）",
  "credits": "可用點數",
  "fabeAccess": "boolean - fabe 課程權限",
  "crossPlatformBenefits": "boolean - 跨平台權益",
  "service": "服務名稱",
  "iss": "eccal.thinkwithblack.com",
  "aud": "目標域名", 
  "iat": "發行時間",
  "exp": "過期時間"
}
```

## 📊 整合檢查清單

### 折扣券系統
- [ ] 折扣碼驗證功能正常
- [ ] 折扣金額計算正確
- [ ] 多貨幣支援測試
- [ ] 錯誤處理完善

### Meta 事件追蹤  
- [ ] Purchase 事件正確觸發
- [ ] 事件參數完整
- [ ] 跨域追蹤正常
- [ ] 測試模式可用

### 會員系統
- [ ] 創始會員識別正確
- [ ] fabe 權限同步正常
- [ ] 會員等級顯示正確
- [ ] 權限檢查有效

## 🚨 重要注意事項

### 安全性考量
1. **折扣碼驗證** - 使用 30 分鐘有效期的追蹤 ID 防止濫用
2. **事件追蹤** - 確保敏感資料不會外洩
3. **權限同步** - 驗證跨平台權限的安全性

### 效能優化
1. **API 快取** - 適當快取用戶會員資訊
2. **事件輪詢** - 合理設定輪詢間隔
3. **錯誤重試** - 實現指數退避重試機制

### 相容性
1. **向後相容** - 確保既有功能不受影響  
2. **漸進式升級** - 可選擇性啟用新功能
3. **降級方案** - 準備新功能失效時的備援方案

## 📞 技術支援

如有整合問題，請聯繫：
- **技術支援**: backtrue@thinkwithblack.com
- **主要文件**: `INTEGRATED_SSO_GUIDE.md`
- **API 狀態**: `API_STATUS_REPORT.md`
- **折扣系統**: `UNIFIED_DISCOUNT_SYSTEM_IMPLEMENTATION.md`

---

**文件版本**: V1.0  
**建立日期**: 2025-08-07  
**適用範圍**: 所有 thinkwithblack.com 子域名服務