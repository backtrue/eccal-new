# Fabe × ECCAL 購買紀錄同步整合指南

> 文件版本：2026-03-22（已完成初次歷史補登）  
> 接收方：fabe.thinkwithblack.com 開發團隊

---

## 一、現況

| 項目 | 狀態 |
|------|------|
| 歷史補登 | ✅ 已完成（2026-03-22，Fabe 批次匯入 40+ 筆） |
| 即時同步端點 | ✅ 已完成（`/api/fabe-reverse/notify-subscription`） |
| 批次匯入端點 | ✅ 已完成（`/api/fabe-reverse/import-purchases`） |
| API Key 驗證 | ✅ 已完成 |

---

## 二、核心設計原則

> **Fabe 購買紀錄只寫入 `fabe_purchases`，不影響 ECCAL 的會員等級（`membership_level`）。**

- 在 ECCAL 購買（Pro / Founders）→ 決定 ECCAL 會員等級
- 在 Fabe 購買課程 → 只記錄在 `fabe_purchases`，ECCAL 等級完全不動
- 兩者是獨立的，不互相影響

---

## 三、API 端點

### 3.1 即時通知（新購買時呼叫）

**時機：** 用戶在 Fabe 付款完成後（Stripe Webhook 確認時）

```
POST https://eccal.thinkwithblack.com/api/fabe-reverse/notify-subscription
Authorization: Bearer {FABE_SYNC_API_KEY}
Content-Type: application/json
```

**Request Body：**

```json
{
  "email": "user@example.com",
  "subscription_type": "annual",
  "amount": 99900,
  "currency": "twd",
  "fabe_subscription_id": "pi_xxx",
  "expires_at": "2027-01-01T00:00:00Z"
}
```

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `email` | string | ✅ | 購買用戶的 Email |
| `subscription_type` | string | ✅ | 訂閱類型：`annual`、`monthly`、`lifetime` |
| `amount` | integer | | 金額，單位為分（999 元 = 99900） |
| `currency` | string | | 貨幣，預設 `twd`，日圓填 `jpy` |
| `fabe_subscription_id` | string | | Fabe 內部訂單／Stripe payment intent ID |
| `expires_at` | string ISO 8601 | | 到期時間，終身不填 |

**成功 Response：**

```json
{
  "success": true,
  "skipped": false,
  "message": "Subscription synced successfully",
  "user": {
    "id": "...",
    "email": "user@example.com"
  }
}
```

> `skipped: true` 表示該 `fabe_subscription_id` 已存在，自動跳過（重跑安全）

**失敗 Response：**

```json
{
  "success": false,
  "error": "Missing required fields: email, subscription_type"
}
```

---

### 3.2 批次歷史匯入（補登用，可重複執行）

```
POST https://eccal.thinkwithblack.com/api/fabe-reverse/import-purchases
Authorization: Bearer {FABE_SYNC_API_KEY}
Content-Type: application/json
```

**Request Body：**

```json
{
  "purchases": [
    {
      "email": "user@example.com",
      "subscription_type": "annual",
      "purchase_amount": 99900,
      "currency": "twd",
      "fabe_order_id": "pi_xxx",
      "expires_at": "2027-01-01T00:00:00Z",
      "purchased_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

建議每批不超過 **100 筆**，避免 timeout。

**Response：**

```json
{
  "success": true,
  "imported": 38,
  "skipped": 2,
  "errors": []
}
```

---

## 四、API Key

```
Authorization: Bearer fabe_58dfc8c890510a6623594cce00af3c47d1cfb59f8a150d123bc6b51b0fdd75fa
```

請存入 Fabe 的環境變數，不可硬寫在程式碼或公開 repo 中。

---

## 五、重複防護

兩個端點都根據 `fabe_subscription_id`（或 `fabe_order_id`）防止重複寫入：
- 同一個 ID 打第二次 → 回 `"skipped": true`，不會產生重複紀錄
- 歷史補登可以安心重跑

---

## 六、用戶不存在時

若 Email 在 ECCAL 查無此人，系統會自動建立帳號：
- `membership_level` 預設為 `free`（Fabe 購買不影響 ECCAL 等級）
- `service` 標記為 `fabe`

---

## 七、測試驗收

```bash
# 單筆通知
curl -X POST https://eccal.thinkwithblack.com/api/fabe-reverse/notify-subscription \
  -H "Authorization: Bearer fabe_58dfc8c890510a6623594cce00af3c47d1cfb59f8a150d123bc6b51b0fdd75fa" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "subscription_type": "annual",
    "amount": 99900,
    "currency": "twd",
    "fabe_subscription_id": "test_order_001",
    "expires_at": "2027-01-01T00:00:00Z"
  }'
```

```bash
# 批次匯入
curl -X POST https://eccal.thinkwithblack.com/api/fabe-reverse/import-purchases \
  -H "Authorization: Bearer fabe_58dfc8c890510a6623594cce00af3c47d1cfb59f8a150d123bc6b51b0fdd75fa" \
  -H "Content-Type: application/json" \
  -d '{
    "purchases": [
      {
        "email": "test@example.com",
        "subscription_type": "annual",
        "purchase_amount": 99900,
        "currency": "twd",
        "fabe_order_id": "test_batch_001",
        "expires_at": "2027-01-01T00:00:00Z",
        "purchased_at": "2026-01-01T00:00:00Z"
      }
    ]
  }'
```

---

## 八、注意事項

- **Fabe 購買不影響 ECCAL 會員等級**：這是核心設計，兩邊會員制度完全獨立
- **時區**：所有時間請用 UTC，格式 `2026-01-01T00:00:00Z`
- **聯繫窗口**：串接過程有問題請聯繫 ECCAL 開發者
