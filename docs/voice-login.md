# 語音顧問跨站登入

本機來源：`backtrue/eccal-new`，分支 `codex/thinkwithblack-mcp-auth`，搭配 realtime-black 的 `docs/product-spec.md` 第 3、6、8 節與 Issue #1、#3、#10、#21

## 設定與資料

| 設定 | 用途 |
|---|---|
| `VOICE_APP_ORIGIN` | realtime-black 的完整 origin，須與該站 `APP_ORIGIN` 相同；正式環境使用 HTTPS，本機可用 loopback HTTP |
| `THINKWITHBLACK_VOICE_SERVICE_TOKEN` | 與 realtime-black `ECCAL_SERVICE_TOKEN` 相同的專用 32-byte canonical base64url 後端憑證 |
| `JWT_SECRET` | 沿用 ECCAL 既有登入簽章設定 |

`migrations/0005_voice_login.sql` 新增 `voice_login_codes` 與 `voice_sessions`。登入碼、state 與會話 token 保存 SHA-256，資料表不保存 JWT 原文。登入碼有效期最多兩分鐘，本站會話最晚與本次 ECCAL JWT 同時到期

## 瀏覽器流程

1. realtime-black `/auth/login` 產生簽章 state，綁定 app origin、10 分鐘期限及當次瀏覽器 HttpOnly nonce
2. ECCAL `/api/voice/login?state=...` 核對簽章與核定 origin，將流程保存在 HttpOnly cookie，再轉到乾淨的 `/api/voice/login`
3. 已登入時使用既有 ECCAL JWT；未登入時導向既有 Google 登入，returnTo 固定為 `/api/voice/login`
4. 語音用 Google state 與瀏覽器 nonce 綁定，回呼走專用分支。簽章 context 同時綁住當次 voice state 與 JWT，登入途中覆寫成另一個帳號會遭拒
5. ECCAL 發出一次性登入碼，導回 realtime-black `/auth/callback`；本站後端核對自己的瀏覽器 nonce，再向 ECCAL 交換會話
6. 本站以 HttpOnly、SameSite=Lax、host-only cookie 保存自己的會話。HTTPS 使用 Secure 與 `__Host-`，隨即導回首頁；ECCAL JWT 不交給本站瀏覽器

## 後端介面

沿用 `eccal-voice-v1` 版號、no-store 與專用服務 Bearer 憑證

| 介面 | 本文 | 回應 |
|---|---|---|
| `POST /api/voice/internal/login/exchange` | `{code,state}` | `{memberId,sessionToken,expiresAt}`，供本站後端設定 cookie |
| `POST /api/voice/internal/login/revoke` | `{sessionToken}` | `{revoked:true}` |
| `POST /api/voice/internal/login/mcp-identity` | `{memberId,accountEmail}` | `{memberId,matches}` |

既有 `/api/voice/internal/authenticate` 增加本站會話 cookie 的驗證，查詢實際會員與會話期限，回傳原有 `{memberId,eligible}` 或 null 形狀

MCP 帳號核對按正規化 Email 查詢會員，必須只有唯一結果且 ID 相符；大小寫別名落在兩個會員 ID 時拒絕綁定

## 個人 MCP 授權

realtime-black 使用既有 ThinkWithBlack OAuth 同意頁、S256 PKCE、resource 與 issuer 核對，要求 `thinkwithblack.use thinkwithblack.methods.read`。MCP 新增的方法庫 scope 限制帳號核對及五項方法工具，拒絕與 GSC／GTM scope 混用

會員的 access token、refresh token 與待處理 PKCE verifier 保存於各自 AuthVault 的 AES-GCM 密文，使用獨立 `AUTH_VAULT_KEY`，加密驗證資料綁定會員及用途。每次取得工具授權都以該會員 token 呼叫既有帳號查詢工具，再回 ECCAL 核對帳號歸屬

工具操作使用授權識別值，原始 bearer 留在 AuthVault。工具操作與解除授權共用佇列，解除回覆後舊授權識別值拒絕使用。提供者撤銷回應未確認時保留密文待確認工作，由 alarm 續做；瀏覽器顯示待確認狀態。到期憑證與登入流程會清除

## 驗證

```sh
REALTIME_BLACK_ROOT=/path/to/realtime-black npm run test:voice-login
REALTIME_BLACK_ROOT=/path/to/realtime-black THINKWITHBLACK_MCP_ROOT=/path/to/thinkwithblack-mcp npm run test:voice-mcp
npm run check
npm run build
```

登入測試使用本機 PostgreSQL 的隨機 `test_voice_login_*` schema、合成會員、兩個 repo 的實際登入程式及受控 Google 身分回應，8 項通過。檢查跨站登入、8 個並行交換、錯瀏覽器、換帳號、到期、登出及 MCP 帳號核對

三 repo MCP 測試使用獨立的 `test_voice_mcp_*` schema、實際 OAuth client、已安裝的 Workers OAuth Provider、MCP SDK 與 ECCAL 帳號核對，2 項通過。同意身分與方法內容由測試控制，驗證兩會員隔離、token 換發、方法 scope、撤銷及錯帳號拒絕

正式 migration、設定、GitHub／Replit 同步、MCP 新 scope 發布與真實 Google／MCP 同意畫面待環境同步後驗收
