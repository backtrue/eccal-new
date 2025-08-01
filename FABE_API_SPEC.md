# FABE 同步 API 技術規格

## API Endpoint 設計

### 1. 購買記錄同步
```
POST /api/fabe/sync-purchase
Content-Type: application/json
Authorization: Bearer {API_TOKEN}
```

**Request Body**:
```typescript
interface FabePurchaseSync {
  user_email: string;           // 必填：用戶 email
  product_type: 'annual_course' | 'lifetime_course'; // 必填：產品類型
  purchase_amount: number;      // 必填：購買金額
  payment_method: string;       // 選填：付款方式
  payment_status: 'completed' | 'pending' | 'failed'; // 必填：付款狀態
  access_start_date: string;    // 必填：ISO 8601 格式
  access_end_date?: string;     // 選填：終身方案為 null
  stripe_payment_intent_id?: string; // 選填：Stripe ID
  purchase_date: string;        // 必填：購買時間
  metadata?: {                  // 選填：額外資訊
    original_price?: number;
    discount_code?: string;
    referral_source?: string;
  };
}
```

**Response**:
```typescript
interface SyncResponse {
  success: boolean;
  message: string;
  data?: {
    purchase_id: string;
    user_id: string;
    membership_updated: boolean;
  };
  error?: {
    code: string;
    details: string;
  };
}
```

### 2. 用戶狀態查詢
```
GET /api/fabe/user-status?email={email}
Authorization: Bearer {API_TOKEN}
```

**Response**:
```typescript
interface UserStatusResponse {
  success: boolean;
  data: {
    user_exists: boolean;
    user_id?: string;
    current_membership: 'free' | 'pro';
    membership_expires_at?: string;
    fabe_purchases: Array<{
      product_type: string;
      purchase_date: string;
      access_end_date?: string;
      amount: number;
    }>;
  };
}
```

### 3. 取消/退款處理
```
PUT /api/fabe/cancel-subscription
Content-Type: application/json
Authorization: Bearer {API_TOKEN}
```

**Request Body**:
```typescript
interface CancelSubscription {
  user_email: string;
  purchase_id?: string;        // 如果有特定購買記錄
  cancellation_reason: string;
  effective_date: string;      // 取消生效日期
  refund_amount?: number;      // 退款金額
}
```

## 實作範例

### JavaScript/Node.js 範例
```javascript
// fabe 端調用範例
async function syncPurchaseToEccal(purchaseData) {
  const response = await fetch('https://eccal.thinkwithblack.com/api/fabe/sync-purchase', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer fabe_sync_token_xxxxxxxxxxxx'
    },
    body: JSON.stringify({
      user_email: purchaseData.email,
      product_type: purchaseData.amount === 999 ? 'annual_course' : 'lifetime_course',
      purchase_amount: purchaseData.amount,
      payment_method: 'stripe',
      payment_status: 'completed',
      access_start_date: new Date().toISOString(),
      access_end_date: purchaseData.amount === 999 
        ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() 
        : null,
      stripe_payment_intent_id: purchaseData.stripe_id,
      purchase_date: purchaseData.created_at
    })
  });
  
  const result = await response.json();
  
  if (!result.success) {
    console.error('同步失敗:', result.error);
    // 處理錯誤，可能需要重試
  }
  
  return result;
}
```

### cURL 範例
```bash
# 同步年繳購買記錄
curl -X POST https://eccal.thinkwithblack.com/api/fabe/sync-purchase \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer fabe_sync_token_xxxxxxxxxxxx" \
  -d '{
    "user_email": "user@example.com",
    "product_type": "annual_course",
    "purchase_amount": 999,
    "payment_method": "stripe",
    "payment_status": "completed",
    "access_start_date": "2025-08-01T00:00:00Z",
    "access_end_date": "2026-08-01T00:00:00Z",
    "stripe_payment_intent_id": "pi_3xxxxxxxxxxxxx",
    "purchase_date": "2025-08-01T10:30:00Z"
  }'

# 同步終身購買記錄
curl -X POST https://eccal.thinkwithblack.com/api/fabe/sync-purchase \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer fabe_sync_token_xxxxxxxxxxxx" \
  -d '{
    "user_email": "vip@example.com",
    "product_type": "lifetime_course",
    "purchase_amount": 5990,
    "payment_method": "stripe",
    "payment_status": "completed",
    "access_start_date": "2025-08-01T00:00:00Z",
    "access_end_date": null,
    "stripe_payment_intent_id": "pi_3yyyyyyyyyyy",
    "purchase_date": "2025-08-01T15:20:00Z"
  }'
```

## 錯誤碼對照表

| 錯誤碼 | 說明 | 處理建議 |
|--------|------|----------|
| `USER_NOT_FOUND` | 用戶不存在 | 檢查 email 格式，或先建立用戶 |
| `INVALID_PRODUCT_TYPE` | 無效的產品類型 | 確認使用 annual_course 或 lifetime_course |
| `DUPLICATE_PURCHASE` | 重複的購買記錄 | 檢查是否已同步過 |
| `INVALID_DATE_FORMAT` | 日期格式錯誤 | 使用 ISO 8601 格式 |
| `AMOUNT_MISMATCH` | 金額不符 | 確認金額與產品類型匹配 |
| `AUTH_FAILED` | 認證失敗 | 檢查 API token 是否正確 |

## 重要注意事項

### 1. 冪等性
- 同一筆購買記錄多次提交應該不會產生重複記錄
- 建議使用 stripe_payment_intent_id 作為唯一識別

### 2. 資料一致性
- 確保 purchase_amount 與 product_type 匹配
- 999 → annual_course（fabe 的唯一產品）
- 注意：5990 是 eccal 自己的創始會員方案，不是 fabe 產品

### 3. 時區處理
- 所有時間都使用 UTC 時區
- 格式：`2025-08-01T10:30:00Z`

### 4. 失敗重試機制
```javascript
async function syncWithRetry(data, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await syncPurchaseToEccal(data);
      if (result.success) return result;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(Math.pow(2, i) * 1000); // 指數退避
    }
  }
}
```

### 5. 批量同步 (歷史資料)
```javascript
// 批量同步歷史購買記錄
async function batchSync(purchases) {
  const batchSize = 10;
  for (let i = 0; i < purchases.length; i += batchSize) {
    const batch = purchases.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(purchase => syncPurchaseToEccal(purchase))
    );
    
    // 避免 API 限制，間隔 100ms
    await sleep(100);
  }
}
```

## 測試清單

在正式上線前，請確認：
- [ ] 999 年繳方案同步正常
- [ ] 5990 終身方案同步正常
- [ ] 新用戶自動建立帳號
- [ ] 現有用戶正確關聯
- [ ] 會員權限正確更新
- [ ] 錯誤情況正確處理
- [ ] 重複提交正確處理
- [ ] 日期時區正確轉換