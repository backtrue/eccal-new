# Eccal ↔ Fabe 跨平台整合指南

## 🎯 整合目標

建立雙向權限同步系統：
- **Fabe 購買 999 課程** → **Eccal Pro 權限（一年）**
- **Eccal 購買 5990 創始會員** → **Fabe 完整課程權限（終身）**

## 🔄 系統架構

### 資料庫設計

#### 1. eccal_purchases (Eccal 購買追蹤)
```sql
CREATE TABLE eccal_purchases (
    id TEXT PRIMARY KEY,
    user_id VARCHAR NOT NULL,
    plan_type VARCHAR(50) NOT NULL, -- 'monthly', 'annual', 'founders'
    purchase_amount INTEGER NOT NULL,
    payment_status VARCHAR(20) DEFAULT 'completed',
    stripe_payment_intent_id VARCHAR,
    access_start_date TIMESTAMP DEFAULT NOW(),
    access_end_date TIMESTAMP, -- null for founders (lifetime)
    fabe_access BOOLEAN DEFAULT false, -- 是否獲得 fabe 權限
    fabe_access_synced BOOLEAN DEFAULT false, -- 是否已同步到 fabe
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### 2. fabe_purchases (Fabe 購買記錄)
```sql
CREATE TABLE fabe_purchases (
    id TEXT PRIMARY KEY,
    user_id VARCHAR NOT NULL,
    product_id TEXT NOT NULL,
    purchase_amount INTEGER NOT NULL,
    payment_status VARCHAR(20) DEFAULT 'completed',
    access_start_date TIMESTAMP DEFAULT NOW(),
    access_end_date TIMESTAMP, -- 年課程一年後到期
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## 🔧 技術實作

### API 端點

#### 1. Eccal 購買記錄 API
```typescript
// POST /api/eccal-purchase/record-purchase
{
  "userId": "user-uuid",
  "planType": "founders", // monthly, annual, founders
  "purchaseAmount": 5990,
  "stripePaymentIntentId": "pi_xxx"
}
```

#### 2. Fabe 同步 API  
```typescript
// POST /api/fabe/sync-purchase
{
  "user_email": "user@example.com",
  "product_type": "annual_course",
  "purchase_amount": 999,
  "payment_status": "completed"
}
```

#### 3. 跨平台權限查詢
```typescript
// GET /api/eccal-purchase/user-purchases/:userId
{
  "success": true,
  "data": {
    "purchases": [...],
    "crossPlatformBenefits": {
      "hasFabeAccess": true,
      "foundersPlan": {
        "purchaseId": "xxx",
        "purchaseDate": "2025-08-01",
        "fabeAccessSynced": true
      }
    }
  }
}
```

## 🎯 權限對應表

| 購買項目 | 平台 | 價格 | 獲得權限 | 期限 |
|---------|------|------|---------|------|
| FABE × SPIN 課程 | fabe | NT$999 | Eccal Pro | 1年 |
| Eccal 月訂閱 | eccal | NT$1,280 | Eccal Pro | 1個月 |
| Eccal 年訂閱 | eccal | NT$12,800 | Eccal Pro | 1年 |
| **Eccal 創始會員** | eccal | **NT$5,990** | **Eccal Pro + Fabe 完整課程** | **終身** |

## 🔄 自動同步流程

### 情境 1：Fabe 用戶購買課程
```
fabe 999 購買 → fabe API 同步 → eccal 系統 → 用戶獲得 Pro 權限
```

### 情境 2：Eccal 創始會員購買
```
eccal 5990 購買 → Stripe webhook → eccal_purchases 記錄 → 自動同步 fabe 權限
```

## 📋 實作檢查清單

### 已完成 ✅
- [x] 建立 eccal_purchases 表格
- [x] 建立 fabe_products 和 fabe_purchases 表格  
- [x] 設計跨平台權限邏輯
- [x] 實作 eccal 購買記錄 API
- [x] 整合 Stripe webhook 自動記錄
- [x] 建立自動備份系統

### 進行中 🔄
- [ ] 測試創始會員購買流程
- [ ] 實作 fabe 同步 API
- [ ] 建立用戶權限查詢介面
- [ ] 測試跨平台權限同步

### 待完成 📝
- [ ] fabe 端 API 整合
- [ ] 前端權限狀態顯示
- [ ] 管理後台監控
- [ ] 錯誤處理和重試機制

## 🧪 測試情境

### 1. 創始會員購買測試
```bash
# 模擬 5990 創始會員購買
curl -X POST /api/eccal-purchase/record-purchase \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user-id",
    "planType": "founders",
    "purchaseAmount": 5990,
    "stripePaymentIntentId": "pi_test_123"
  }'
```

### 2. 權限同步測試
```bash
# 檢查用戶跨平台權限
curl /api/eccal-purchase/user-purchases/test-user-id
```

### 3. Fabe 同步測試
```bash
# 手動觸發 fabe 同步
curl -X POST /api/eccal-purchase/sync-founder-to-fabe \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user-id"
  }'
```

## 🔒 安全考量

1. **API 認證**：所有跨平台 API 使用 Bearer token 認證
2. **資料驗證**：嚴格驗證用戶身份和購買記錄
3. **冪等性**：防止重複同步和重複記錄
4. **錯誤處理**：同步失敗不影響原始購買，可重試

## 📊 監控指標

1. **同步成功率**：fabe_access_synced 比例
2. **跨平台使用率**：創始會員 fabe 課程使用情況
3. **系統效能**：API 回應時間和錯誤率
4. **用戶滿意度**：跨平台權限使用回饋

## 🆘 故障排除

### 常見問題

**Q: 創始會員購買後沒有 fabe 權限？**
A: 檢查 eccal_purchases 中的 fabe_access_synced 狀態，可手動重新同步

**Q: fabe 購買後 eccal 沒有 Pro 權限？**  
A: 確認 fabe API 同步是否成功，檢查用戶 email 對應

**Q: 如何確認跨平台權限狀態？**
A: 使用 `/api/eccal-purchase/user-purchases/:userId` 查詢完整狀態

---

*此系統於 2025-08-01 設計實作，旨在提供無縫的跨平台學習體驗*