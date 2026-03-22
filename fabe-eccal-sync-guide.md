# Fabe × ECCAL 購買紀錄同步整合指南

> 文件版本：2026-03-22  
> 接收方：fabe.thinkwithblack.com 開發團隊

---

## 一、現況說明

ECCAL（eccal.thinkwithblack.com）目前的 `fabe_purchases` 資料表中共有 **4 筆紀錄**，全部是系統自動授予的「Founders 福利」，並非來自 Fabe 平台的實際付款紀錄。

目前 Fabe 的購買紀錄**從未同步到 ECCAL**，原因是 Fabe 那邊尚未串接通知端點。

---

## 二、整合目標

| 目標 | 說明 |
|------|------|
| 歷史補登 | 把 Fabe 過去所有已完成的購買紀錄一次性匯入 ECCAL |
| 即時同步 | 從現在起，Fabe 用戶付款完成後，即時通知 ECCAL 寫入紀錄 |

---

## 三、ECCAL 這邊需要做的事（由 ECCAL 開發者處理）

### 3.1 新增批次匯入端點（歷史補登用）

新增 `POST /api/fabe-reverse/import-purchases`，接受陣列格式，讓 Fabe 可以一次傳多筆歷史紀錄。

**預計完成後的 Request 格式：**

```json
POST https://eccal.thinkwithblack.com/api/fabe-reverse/import-purchases
Authorization: Bearer {FABE_SYNC_API_KEY}
Content-Type: application/json

{
  "purchases": [
    {
      "email": "user@example.com",
      "product_id": "course_123",
      "purchase_amount": 2980,
      "currency": "twd",
      "payment_method": "stripe",
      "payment_status": "completed",
      "fabe_order_id": "fabe_order_abc123",
      "access_start_date": "2025-01-01T00:00:00Z",
      "access_end_date": null,
      "purchased_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

**Response：**

```json
{
  "success": true,
  "imported": 10,
  "skipped": 2,
  "errors": []
}
```

### 3.2 新增 API Key 驗證

目前 `/api/fabe-reverse/notify-subscription` 端點沒有任何身份驗證，任何人都可以呼叫。ECCAL 將新增 `FABE_SYNC_API_KEY` 環境變數，所有 Fabe 呼叫的端點都需要在 Header 帶上：

```
Authorization: Bearer {FABE_SYNC_API_KEY}
```

ECCAL 開發者會把 API Key 值提供給 Fabe 方。

### 3.3 修正即時通知寫入目標

目前 `POST /api/fabe-reverse/notify-subscription` 是把資料寫進 `stripe_payments` 資料表，ECCAL 將同步修正為也寫入 `fabe_purchases` 資料表，確保資料結構一致。

---

## 四、Fabe 這邊需要做的事

### 4.1 即時同步（新購買）

**時機：** 用戶在 Fabe 付款成功後（Webhook 確認付款完成時）

**呼叫方式：**

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
  "amount": 298000,
  "currency": "twd",
  "fabe_subscription_id": "fabe_sub_xxx",
  "expires_at": "2026-01-01T00:00:00Z"
}
```

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `email` | string | 是 | 購買用戶的 Email |
| `subscription_type` | string | 是 | 訂閱類型，例如 `annual`、`monthly`、`lifetime` |
| `amount` | integer | 否 | 金額，單位為分（例如 2980 元 = 298000） |
| `currency` | string | 否 | 貨幣代碼，預設 `twd` |
| `fabe_subscription_id` | string | 否 | Fabe 內部的訂閱/訂單 ID |
| `expires_at` | string (ISO 8601) | 否 | 訂閱到期時間，終身不填 |

**成功 Response：**

```json
{
  "success": true,
  "message": "Subscription synced successfully",
  "user": {
    "id": "...",
    "email": "user@example.com",
    "membership_level": "pro",
    "membership_expires": "2026-01-01T00:00:00Z"
  }
}
```

**失敗 Response：**

```json
{
  "success": false,
  "error": "Missing required fields: email, subscription_type"
}
```

---

### 4.2 歷史紀錄補登（一次性）

**等 ECCAL 完成 3.1 端點後再執行。**

做法：從 Fabe 資料庫撈出所有歷史已完成的訂單，整理成以下格式，呼叫批次端點：

```
POST https://eccal.thinkwithblack.com/api/fabe-reverse/import-purchases
Authorization: Bearer {FABE_SYNC_API_KEY}
Content-Type: application/json
```

建議每批不超過 **100 筆**，分批呼叫，避免 timeout。

---

## 五、整合時序

```
歷史補登（一次性）：
Fabe DB → 整理資料 → POST /api/fabe-reverse/import-purchases → ECCAL 寫入 fabe_purchases ✓

即時同步（持續）：
用戶付款 → Fabe Webhook 確認 → POST /api/fabe-reverse/notify-subscription → ECCAL 寫入 fabe_purchases ✓
```

---

## 六、測試驗收方式

Fabe 串接完成後，可用以下方式驗證：

```bash
# 測試單筆通知（用真實存在的測試 Email）
curl -X POST https://eccal.thinkwithblack.com/api/fabe-reverse/notify-subscription \
  -H "Authorization: Bearer {FABE_SYNC_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "subscription_type": "annual",
    "amount": 298000,
    "currency": "twd",
    "fabe_subscription_id": "test_order_001",
    "expires_at": "2027-01-01T00:00:00Z"
  }'
```

預期回傳 `"success": true`，ECCAL 可在後台確認紀錄已寫入。

---

## 七、注意事項

- **重複防護**：ECCAL 端點會根據 `fabe_subscription_id` 防止重複寫入，歷史補登可安心重跑
- **用戶不存在時**：若 Email 在 ECCAL 查無此人，系統會自動建立帳號（以 `fabe` 為來源標記）
- **API Key 保密**：`FABE_SYNC_API_KEY` 只能存放在 Fabe 的環境變數中，不可硬寫在前端或公開 repo
- **時區**：所有時間欄位請使用 UTC，格式 ISO 8601（`2025-01-01T00:00:00Z`）

---

## 八、聯繫窗口

如整合過程有任何問題，請聯繫 ECCAL 開發者確認 API Key 及端點狀態。
