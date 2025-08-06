# Eccal 統一折扣券系統設計方案

## 概述
基於 eccal 作為會員系統主平台的角色，設計統一的折扣券系統，讓所有子服務都能使用同一套折扣碼機制。

## 擴展的資料庫設計

### 1. 折扣碼表 (discount_codes) - 增強版
```sql
CREATE TABLE discount_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'ALL',
  
  -- 跨服務控制
  applicable_services TEXT[] DEFAULT '{"eccal","fabe"}', -- 適用的服務列表
  service_specific_rules JSONB DEFAULT '{}', -- 各服務專屬規則
  
  -- 使用限制
  usage_limit INTEGER,
  used_count INTEGER DEFAULT 0,
  per_user_limit INTEGER DEFAULT 1, -- 每用戶使用次數限制
  minimum_amount INTEGER, -- 最低消費金額 (分為單位)
  
  -- 時間控制
  is_active BOOLEAN DEFAULT true,
  valid_from TIMESTAMP,
  valid_until TIMESTAMP,
  
  -- 管理資訊
  description TEXT,
  created_by VARCHAR(255), -- 創建者 (admin email)
  campaign_name VARCHAR(100), -- 活動名稱
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2. 跨服務使用記錄表 (discount_usages) - 增強版
```sql
CREATE TABLE discount_usages (
  id SERIAL PRIMARY KEY,
  discount_code_id INTEGER REFERENCES discount_codes(id),
  user_id VARCHAR(255),
  user_email VARCHAR(255), -- 跨服務用戶識別
  service_name VARCHAR(50) NOT NULL, -- 使用的服務 (eccal, fabe, etc.)
  
  -- 金額資訊
  original_amount DECIMAL(10,2) NOT NULL,
  discount_amount DECIMAL(10,2) NOT NULL,
  final_amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  
  -- 交易關聯
  external_transaction_id VARCHAR(255), -- 各服務的交易ID
  payment_status VARCHAR(20) DEFAULT 'pending', -- pending, completed, failed
  
  -- 元資料
  metadata JSONB, -- 各服務專屬資料
  user_agent TEXT,
  ip_address INET,
  
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3. 服務配置表 (service_configs)
```sql
CREATE TABLE service_configs (
  id SERIAL PRIMARY KEY,
  service_name VARCHAR(50) UNIQUE NOT NULL,
  service_display_name VARCHAR(100),
  api_endpoint VARCHAR(255),
  webhook_secret VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  supported_currencies TEXT[] DEFAULT '{"TWD","USD","JPY"}',
  default_currency VARCHAR(10) DEFAULT 'TWD',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 跨服務 API 設計

### 1. 折扣碼驗證 API (供子服務調用)
```javascript
// POST /api/discount-codes/validate-cross-platform
{
  "code": "WELCOME20",
  "amount": 99900,
  "currency": "TWD", 
  "service_name": "fabe",
  "user_email": "user@example.com",
  "user_id": "optional_service_user_id"
}

// Response
{
  "valid": true,
  "discount_code": {
    "id": 123,
    "code": "WELCOME20",
    "discount_type": "percentage",
    "discount_value": "20.00"
  },
  "calculation": {
    "original_amount": 99900,
    "discount_amount": 19980,
    "final_amount": 79920,
    "currency": "TWD"
  },
  "service_allowed": true,
  "usage_tracking_id": "temp_uuid_for_apply"
}
```

### 2. 折扣碼應用 API (完成使用)
```javascript
// POST /api/discount-codes/apply-cross-platform
{
  "usage_tracking_id": "temp_uuid_from_validate",
  "external_transaction_id": "fabe_order_12345",
  "payment_status": "completed"
}
```

### 3. 統計報告 API
```javascript
// GET /api/discount-codes/analytics
{
  "code": "WELCOME20",
  "service_name": "all", // or specific service
  "date_range": "2025-01-01,2025-01-31"
}
```

## 子服務整合範例

### Fabe 結帳頁面整合
```typescript
// fabe 的折扣碼組件
const FabeDiscountInput = ({ orderAmount, onDiscountApplied }) => {
  const validateDiscount = async (code) => {
    const response = await fetch('https://eccal.domain/api/discount-codes/validate-cross-platform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        amount: orderAmount,
        currency: 'TWD',
        service_name: 'fabe',
        user_email: getCurrentUserEmail()
      })
    });
    
    const result = await response.json();
    if (result.valid && result.service_allowed) {
      onDiscountApplied(result);
    }
    return result;
  };
  
  // UI 組件邏輯...
};
```

## 管理後台設計

### 折扣碼創建介面增強功能
- **服務選擇器**：選擇適用的服務
- **服務專屬規則**：為不同服務設定不同規則
- **跨服務統計**：查看各服務的使用情況
- **批量管理**：一次管理多個服務的折扣活動

## 實作優勢

### 1. 商業優勢
- **統一行銷**：一個活動碼可以促進整個生態系統
- **用戶體驗**：用戶只需記住一套折扣碼
- **數據洞察**：完整的跨服務用戶行為分析
- **成本效益**：集中管理減少開發和維護成本

### 2. 技術優勢
- **服務解耦**：子服務不需要自己的折扣系統
- **一致性**：所有服務使用相同的折扣邏輯
- **可擴展**：新服務可以快速接入
- **安全性**：集中的權限和使用次數控制

### 3. 運營優勢
- **靈活性**：可以針對不同服務設定不同規則
- **效率**：一個後台管理所有促銷活動
- **監控**：統一的使用監控和異常檢測

## 實作時程建議

### Phase 1: 基礎設施 (2-3天)
- 資料庫設計和建立
- 核心 API 開發
- 基礎管理介面

### Phase 2: Eccal 整合 (1天)
- Eccal 內部折扣功能
- 管理後台完善

### Phase 3: Fabe 整合 (1天)  
- Fabe 服務接入
- 跨服務測試

### Phase 4: 擴展和優化 (ongoing)
- 新服務接入
- 分析報告
- 性能優化

這個統一折扣券系統將成為 eccal 生態系統的重要基礎設施，為未來的商業成長奠定堅實基礎。