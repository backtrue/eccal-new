# FABE 資料庫同步整合指南

## 概述
此文件說明如何將 fabe.thinkwithblack.com 的訂閱和購買資料同步到 eccal 系統中，實現統一的用戶權限管理。

## 目標系統架構
- **fabe 系統**：獨立的課程訂閱平台
- **eccal 系統**：主要的廣告分析平台
- **整合目標**：讓 fabe 的付費用戶在 eccal 享有對應權限

## 資料庫結構

### eccal 端準備的資料表

#### 1. fabe_products (產品資料表)
```sql
CREATE TABLE fabe_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    price INTEGER NOT NULL,
    original_price INTEGER,
    type VARCHAR(50) NOT NULL, -- 'annual_course', 'lifetime_course'
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);
```

**範例資料**：
```sql
INSERT INTO fabe_products VALUES (
    'be7f0d8c-657d-4b81-be3e-d4c96965411b',
    'FABE × SPIN 話術練習系統',
    999,
    2800,
    'annual_course',
    '「說進心坎裡」角色導向溝通術 - 線上練習平台（一年權限）+ 每月直播課',
    true,
    '2025-08-01 05:16:13'
);
```

#### 2. fabe_purchases (購買記錄表)
```sql
CREATE TABLE fabe_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    product_id UUID REFERENCES fabe_products(id),
    purchase_amount INTEGER NOT NULL,
    payment_method VARCHAR(50),
    payment_status VARCHAR(20) DEFAULT 'completed',
    access_start_date TIMESTAMP,
    access_end_date TIMESTAMP,
    stripe_payment_intent_id VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

## 需要同步的資料

### 1. 產品資料 (fabe_products)
請提供以下產品資訊：

**999 年繳方案**：
- 產品名稱：FABE × SPIN 話術練習系統
- 價格：999
- 原價：2800
- 類型：annual_course
- 說明：完整課程描述

**5990 終身方案**：
- 產品名稱：[請提供]
- 價格：5990
- 原價：[請提供]
- 類型：lifetime_course
- 說明：[請提供完整描述]

### 2. 購買記錄 (fabe_purchases)
對於每筆購買，需要：
- **用戶識別**：email 或其他唯一識別碼
- **產品資訊**：購買的是 999 還是 5990 方案
- **付款金額**：實際付款金額
- **付款方式**：stripe, credit_card, bank_transfer 等
- **付款狀態**：completed, pending, failed
- **權限期間**：
  - access_start_date：開始日期
  - access_end_date：結束日期（999方案一年後，5990終身為 null）
- **Stripe 資訊**：payment_intent_id（如果有）
- **購買時間**：created_at

## 整合方式

### 方式 1：API 同步 (推薦)
建立 API endpoint 供 fabe 推送資料：

**URL**: `https://eccal.thinkwithblack.com/api/fabe/sync-purchase`
**Method**: POST
**Authorization**: Bearer token (我們提供)

**Request Body**:
```json
{
  "user_email": "user@example.com",
  "product_type": "annual_course", // 或 "lifetime_course"
  "purchase_amount": 999,
  "payment_method": "stripe",
  "payment_status": "completed",
  "access_start_date": "2025-08-01T00:00:00Z",
  "access_end_date": "2026-08-01T00:00:00Z", // null for lifetime
  "stripe_payment_intent_id": "pi_xxxxx",
  "purchase_date": "2025-08-01T10:30:00Z"
}
```

### 方式 2：資料庫直連 (如果可行)
如果 fabe 系統可以直接連接到 eccal 資料庫，提供：
- 資料庫連線資訊
- 專用帳號權限（只能寫入 fabe_* 表格）

### 方式 3：檔案匯出匯入
定期匯出 CSV 檔案，格式如下：

**purchases.csv**:
```csv
user_email,product_type,purchase_amount,payment_method,payment_status,access_start_date,access_end_date,stripe_payment_intent_id,purchase_date
user@example.com,annual_course,999,stripe,completed,2025-08-01T00:00:00Z,2026-08-01T00:00:00Z,pi_xxxxx,2025-08-01T10:30:00Z
```

## 用戶帳號對應

### 現有用戶
如果用戶已在 eccal 註冊：
- 使用 email 作為對應鍵值
- 自動關聯到現有帳號

### 新用戶
如果用戶尚未在 eccal 註冊：
- 可先建立購買記錄
- 用戶首次登入時自動關聯

## 權限設計

購買 fabe 課程的用戶將獲得：
- **999 年繳方案**：
  - eccal Pro 會員權限（一年）
  - 所有 eccal 功能無限制使用
  
- **5990 終身方案**：
  - eccal Pro 會員權限（終身）
  - 所有 eccal 功能無限制使用
  - 未來新功能優先體驗權

## 技術實作細節

### API 認證
```bash
# 我們提供的 API Token
Authorization: Bearer fabe_sync_token_xxxxxxxxxxxx
```

### 錯誤處理
API 回應格式：
```json
{
  "success": true,
  "message": "Purchase synced successfully",
  "data": {
    "purchase_id": "uuid",
    "user_id": "uuid"
  }
}
```

錯誤回應：
```json
{
  "success": false,
  "error": "User not found",
  "code": "USER_NOT_FOUND"
}
```

## 測試資料

為了測試整合，請提供：
1. **測試用戶**：1-2 個測試帳號的購買記錄
2. **測試環境**：是否有測試環境可先驗證
3. **歷史資料**：現有的購買記錄需要回溯同步嗎？

## 上線計畫

### 階段 1：準備期 (1-2 天)
- eccal 端建立 API endpoint
- 提供 API 文件和測試 token
- fabe 端開發整合程式

### 階段 2：測試期 (1-2 天)
- 使用測試資料驗證整合
- 確認權限邏輯正確
- 調整 API 參數

### 階段 3：上線期 (1 天)
- 同步歷史購買記錄
- 啟用即時同步
- 監控同步狀況

## 聯絡資訊

**技術負責人**：[您的聯絡資訊]
**緊急聯絡**：[緊急聯絡方式]
**技術支援時間**：週一至週五 9:00-18:00

---

## 附錄：eccal 現有用戶結構

### users 表格結構
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    membership_type VARCHAR(20) DEFAULT 'free', -- 'free', 'pro'
    membership_expires_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

### 積分系統 (可選整合)
如果要整合積分獎勵：
```sql
-- fabe 購買用戶可獲得額外積分
INSERT INTO credit_transactions (user_id, amount, type, description)
VALUES (user_id, 1000, 'fabe_purchase_bonus', 'FABE課程購買獎勵');
```

## 常見問題 FAQ

**Q: 如果用戶取消訂閱怎麼辦？**
A: 請調用取消 API 或更新 access_end_date

**Q: 如何處理退款？**
A: 更新 payment_status 為 'refunded' 並設定 access_end_date

**Q: 是否支援分期付款？**
A: 目前設計為一次性付款，分期需另外討論

**Q: 資料同步頻率？**
A: 建議即時同步，最晚不超過 1 小時