# Stripe Webhook 問題診斷報告

## 問題根本原因 ❌

**Stripe Dashboard 中的 webhook endpoint 設定錯誤**

### 當前設定（錯誤）
```
Webhook URL: https://thinkwithblack.com/api/stripe/webhook
狀態: 404 Not Found
```

### 應該設定為（正確）
```
Webhook URL: https://629e49c6-8dc3-42cd-b86c-d35b18e038dd-00-2e3bopfmdivrv.kirk.replit.dev/api/stripe/webhook
或部署後的正確域名
```

## 問題影響
1. Stripe 付款成功，但 webhook 調用失敗
2. 用戶會員狀態沒有自動更新
3. eccal_purchases 表沒有自動建立記錄
4. FABE 權限沒有自動同步

## 修復步驟
1. 前往 Stripe Dashboard > Webhooks
2. 找到現有的 webhook 設定
3. 更新 Endpoint URL 為正確的 Replit 域名
4. 或等待部署後使用正式域名

## 最近受影響的付款
- backtrue@toldyou.co: pi_2RrIdcYDQY3sAQES1VdZDl7i (已手動修復)
- backtrue@bvgcorp.net: pi_2RrImvYDQY3sAQES1oX0ZveU (需手動修復)

## 驗證方法
測試 webhook endpoint 是否可訪問：
```bash
curl -X POST "https://your-correct-domain/api/stripe/webhook" -H "Content-Type: application/json" -d '{"test": true}'
```

應該返回 "Missing stripe signature" 而不是 404。