# Stripe Webhook 除錯指南

## 問題症狀
- Stripe 後台顯示付款成功
- 用戶會員狀態未更新
- eccal_purchases 表無購買記錄

## 解決步驟

### 1. 檢查 Stripe Dashboard
- 前往 Stripe Dashboard > Webhooks
- 確認 webhook endpoint 設定為：`https://your-domain.com/api/stripe/webhook`
- 檢查是否監聽 `payment_intent.succeeded` 事件

### 2. 檢查環境變數
```bash
# 確認以下環境變數存在
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 3. 測試 Webhook
```bash
# 使用 Stripe CLI 測試
stripe listen --forward-to localhost:5000/api/stripe/webhook
stripe trigger payment_intent.succeeded
```

### 4. 檢查伺服器日誌
- 查看是否收到 webhook 事件
- 確認 metadata 包含 userId 和 paymentType

### 5. 手動修復（如本次操作）
```sql
-- 1. 新增購買記錄
INSERT INTO eccal_purchases (...);

-- 2. 升級會員等級
UPDATE users SET membership_level = 'pro' WHERE id = 'user_id';

-- 3. 同步 FABE 權限
UPDATE eccal_purchases SET fabe_access_synced = true WHERE user_id = 'user_id';
```

## 監控建議
- 定期檢查 Stripe Dashboard > Events
- 設定付款成功但會員狀態未更新的告警
- 每日檢查 eccal_purchases 表的同步狀態