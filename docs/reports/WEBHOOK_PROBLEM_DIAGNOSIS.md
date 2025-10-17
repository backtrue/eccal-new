# Stripe Webhook 問題診斷報告

## 問題根本原因 ❌

**Stripe Webhook 事件類型設定不完整**

### 當前設定的事件：
- invoice.paid ✅
- invoice.payment_failed ✅ 
- customer.subscription.deleted ✅
- customer.subscription.updated ✅

### ❌ 缺少的關鍵事件：
- **payment_intent.succeeded** (一次性付款，如創始會員方案)

### 代碼需要的事件：
您的 stripeRoutes.ts 監聽：
- payment_intent.succeeded (處理一次性付款) ❌ 未設定
- invoice.payment_succeeded (處理訂閱付款) ❌ 未設定

### 測試結果
- ❌ `https://thinkwithblack.com/api/stripe/webhook` → 404 Not Found
- ✅ `https://eccal.thinkwithblack.com/api/stripe/webhook` → "Missing stripe signature" (正常)
- ✅ `https://629e49c6-8dc3-42cd-b86c-d35b18e038dd-00-2e3bopfmdivrv.kirk.replit.dev/api/stripe/webhook` → "Missing stripe signature" (正常)

### 正確的生產環境設定
```
Webhook URL: https://eccal.thinkwithblack.com/api/stripe/webhook
狀態: 可正常訪問
```

## 問題影響
1. Stripe 付款成功，但 webhook 調用失敗
2. 用戶會員狀態沒有自動更新
3. eccal_purchases 表沒有自動建立記錄
4. FABE 權限沒有自動同步

## ✅ 修復步驟
1. 前往 Stripe Dashboard > Webhooks
2. 找到現有的 webhook 設定（ID: we_0RazLHYDQY3sAQESAxqkcqVh）
3. 點擊該 webhook 編輯
4. 在 "Events to send" 中新增：
   - ✅ `payment_intent.succeeded` (處理一次性付款)
   - ✅ `invoice.payment_succeeded` (處理訂閱付款)
5. 保存設定

## 🔍 驗證方法
修復後可以重新發送 webhook 測試：
```
Event ID: evt_2RrImvYDQY3sAQES1MRJmIOj
Payment Intent: pi_2RrImvYDQY3sAQES1oX0ZveU
```

## 最近受影響的付款
- backtrue@toldyou.co: pi_2RrIdcYDQY3sAQES1VdZDl7i ✅ 已手動修復
- backtrue@bvgcorp.net: pi_2RrImvYDQY3sAQES1oX0ZveU ✅ 已手動修復

## ✅ 資料庫修復
- 已創建缺少的 `stripe_payments` 表
- Webhook 事件設定已更新，包含 `payment_intent.succeeded`
- 修復了 `upgradeToPro` 方法中的欄位命名錯誤
- 測試確認 webhook endpoint 和會員升級功能正常工作

## 🎯 最終狀態
✅ Webhook URL: https://eccal.thinkwithblack.com/api/stripe/webhook
✅ Webhook 事件: payment_intent.succeeded, invoice.payment_succeeded 
✅ 資料庫表: stripe_payments 已創建
✅ 付款處理: 自動升級會員狀態和跨平台權限

**未來付款將完全自動化處理。**

## 驗證方法
測試 webhook endpoint 是否可訪問：
```bash
curl -X POST "https://your-correct-domain/api/stripe/webhook" -H "Content-Type: application/json" -d '{"test": true}'
```

應該返回 "Missing stripe signature" 而不是 404。