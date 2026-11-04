# ECCAL 語音額度介面

契約版號：`eccal-voice-v1`

產品依據為 realtime-black 的 `docs/product-spec.md` 第 3 節及已核定的計時規則，對應 realtime-black Issue #1、#5、#6、#8、#9

## 額度與帳本

每位現有 ECCAL 會員有合計 300 秒語音額度，包含 free、pro 與 founders 帳號。首次占用建立 `voice_quotas`，跨登入與跨通話共用同一筆資料

`voice_quotas` 保存固定 300 秒與累計已扣秒數，`voice_reservations` 保存占用識別值、會員、操作識別值、占用秒數、接通前截止、結算秒數、餘額與事件 SHA-256。既有 `users.credits`、MCP 試用及付款資料保持原值

一次占用該會員全部剩餘秒數，未結算前可用餘額為 0。同一會員的占用與結算在 PostgreSQL transaction 中鎖住同一帳本列，另以 partial unique index 限制一筆未結算占用。占用到期仍須以服務端結束事件結算後釋放

從第一段實際音訊到服務端確認結束，扣除工具等待聯集，再對整通總秒數向上取整，最多扣該筆占用秒數。未接通扣 0 秒，工具未回覆時的等待排除至確認結束

## 驗證與呼叫

所有回應包含 `Cache-Control: no-store` 與 `X-Voice-Contract: eccal-voice-v1`

內部介面以 `Authorization: Bearer <後端服務權杖>` 驗證，ECCAL 設定 `THINKWITHBLACK_VOICE_SERVICE_TOKEN` 為專用的 32-byte、canonical base64url 值。realtime-black 的 `ECCAL_SERVICE_TOKEN` 使用相同設定，`ECCAL_ORIGIN` 指向 ECCAL origin

| 方法與路徑 | 輸入 | 回應 |
|---|---|---|
| `POST /api/voice/internal/authenticate` | `{cookie, authorization}`，兩者為會員原請求的登入資料 | `{memberId, eligible:true}`；未登入、JWT 失效或會員已不存在回傳 `null` |
| `POST /api/voice/internal/balance` | `{memberId}` | `{memberId,totalSeconds:300,billedSeconds,reservedSeconds,remainingSeconds}` |
| `POST /api/voice/internal/reserve` | `{memberId,operationId}` | `{id,memberId,seconds,deadline}`，deadline 為 epoch milliseconds |
| `POST /api/voice/internal/settle` | `{memberId,reservationId,events}` | `{billedSeconds,remainingSeconds}` |
| `GET /api/voice/quota` | ECCAL 會員的 Bearer JWT 或 `auth_token` cookie | 本人 balance；會員歸屬從 JWT 取得 |

內部 POST 採 JSON，拒絕額外欄位，本文上限 256 KiB。服務權杖在解析本文前核對。authenticate 使用現有 ECCAL `JWT_SECRET` 與 HS256，要求有效期限、會員 ID，並查詢實際會員存在狀態

`operationId` 為 16～100 個英數、底線或連字號。同一會員重送相同操作會取得相同占用及原截止，即使該占用已結算也不重新占額

events 各筆欄位為 `id`、`type`、`at`，工具事件可帶 `toolCallId`。type 為 reserved、connected、tool_started、tool_finished、disconnected、ended；at 為 epoch milliseconds。須有一筆 reserved、一筆 ended，connected 最多一筆。工具開始與結束按 toolCallId 配對，沿用 realtime-black 的 `tool-start:`、`tool-end:` 識別值也可配對

同一事件重送會去重，衝突內容拒絕。結算先正規化事件並計算摘要，相同時間軸重送回傳原收據；已結算後改時間軸回傳 `409 SETTLEMENT_CONFLICT`

| 錯誤 | HTTP 狀態 |
|---|---:|
| 未設定語音服務權杖／服務暫時無法使用 | 503 |
| `UNAUTHORIZED_CALLER` | 401 |
| `LOGIN_REQUIRED` | 401 |
| `MEMBER_NOT_FOUND`、`RESERVATION_NOT_FOUND` | 404 |
| `QUOTA_EXHAUSTED` | 403 |
| `RESERVATION_ACTIVE`、`SETTLEMENT_CONFLICT` | 409 |
| `INVALID_REQUEST`、`INVALID_METER_EVENTS` | 400 |
| `REQUEST_TOO_LARGE` | 413 |
| `JSON_REQUIRED` | 415 |

路由在全站 JSON parser 與請求紀錄前註冊，錯誤回應保留固定錯誤代碼，登入憑證與事件本文不寫入紀錄或語音資料表

## Schema 與驗證

新增 migration：`migrations/0004_voice_quotas.sql`，Drizzle 定義位於 `shared/schema.ts`

本機使用 PostgreSQL 16，在隨機 `test_voice_*` schema 建立合成會員並重跑 migration；測完移除該測試 schema

```sh
npm run check
npm run test:voice
REALTIME_BLACK_ROOT=/path/to/realtime-black npm run test:voice-contract
npm run build
```

`test:voice` 包含真實並行占用與結算、最後一秒、120＋180 秒跨通話、工具等待及取整、回寫收據失敗的交易回復、權限與請求驗證

`test:voice-contract` 載入指定 checkout 的 realtime-black HTTP adapter 與 MemberEngine，經本機 Express 呼叫 PostgreSQL，核對 300 → 210 → 0，另一會員維持 300。Realtime 與 MCP 使用合成回應

目前變更位於本機 `codex/thinkwithblack-mcp-auth`。正式 migration、GitHub 同步、Replit pull／Republish、正式會員與跨站登入導回尚待執行
