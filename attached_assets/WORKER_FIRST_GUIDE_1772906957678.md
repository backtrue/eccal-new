# ECCAL SSO 整合指南（Cloudflare Worker 優先）

最後更新：2026-03-08

本文件是 `andromeda` 實際整合 ECCAL SSO 後整理出的可執行版本，目標是給未來其他子服務直接複用。文件只保留目前已在正式環境驗證過的做法，不保留舊版前端直連流程的歷史包袱。

## 適用範圍

- 子服務前端與 API 分離
- 子服務 API 跑在 Cloudflare Workers
- ECCAL 作為統一登入與會員資料來源
- 子服務需要依會員等級與點數做授權判斷

## 正式建議架構

採用模式：`前端 -> 子服務 Worker -> ECCAL`

不要採用：

- 前端直接依賴 ECCAL session cookie
- 前端直接把 ECCAL cookie 當成子服務登入狀態
- 子服務把 ECCAL HTML/login redirect 流程當成 API 規格

原因：

- Cloudflare Workers 與瀏覽器 cookie/session 行為不同
- Worker 對外部服務的 `fetch()` 對 redirect、header、origin 的容錯空間比瀏覽器小
- 子服務自己的登入狀態、returnTo、CORS、custom domain 必須自己掌控

參考：

- ECCAL 官方文件：[ECCAL SSO Guide](https://eccal.thinkwithblack.com/sso-guide)
- Cloudflare 官方文件：[Fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
- Cloudflare 官方文件：[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## 已驗證可用的 ECCAL 端點

以下端點已在正式環境驗證過可直接使用：

- `GET https://eccal.thinkwithblack.com/api/sso/login?service=audai&returnTo=...`
- `POST https://eccal.thinkwithblack.com/api/sso/verify-token`
- `GET https://eccal.thinkwithblack.com/api/account-center/user/:id`

目前正式回應 header 會帶：

- `x-eccal-version: 3.2`
- `x-eccal-route: ...`
- `x-eccal-redirect-bypassed: false`

## 標準登入流程

### 1. 前端只打子服務自己的登入入口

前端不要直接導向 ECCAL。

前端只導向：

- `GET /api/auth/login`

### 2. 子服務 Worker 伺服器端轉接 ECCAL SSO

Worker 應做的事：

1. 組出 ECCAL SSO URL
2. 帶正確的 `Origin`
3. 以 `redirect: 'manual'` 取得 ECCAL 的 302
4. 再把瀏覽器導向 ECCAL 給的 `Location`

`andromeda` 目前實作可直接參考：

- [/Users/backtrue/Documents/andromeda/src/routes/auth.ts](/Users/backtrue/Documents/andromeda/src/routes/auth.ts)

關鍵實作：

```ts
auth.get('/login', async (c) => {
  const eccalBaseUrl = c.env.ECCAL_BASE_URL;
  const returnTo = `${getPublicAppUrl(c.env, c.req.url)}/auth/callback`;
  const eccalSsoOrigin = c.env.ECCAL_SSO_ORIGIN || 'https://audai.thinkwithblack.com';

  const params = new URLSearchParams({
    service: 'audai',
    returnTo,
  });

  const redirectUrl = `${eccalBaseUrl}/api/sso/login?${params.toString()}`;

  const response = await fetch(redirectUrl, {
    method: 'GET',
    headers: {
      Origin: eccalSsoOrigin,
    },
    redirect: 'manual',
  });

  const location = response.headers.get('location');
  if (!location || response.status < 300 || response.status >= 400) {
    return c.json({ error: 'Failed to initialize login' }, 502);
  }

  return c.redirect(new URL(location, eccalBaseUrl).toString());
});
```

### 3. ECCAL 完成登入後回前端 callback

目前已驗證可用的回跳格式：

- `https://your-app.example.com/auth/callback?token=JWT&user_id=...`

子服務前端要做的事：

1. 讀取 `token`
2. 存到本地 token storage
3. 後續 API 請求改帶 `Authorization: Bearer <token>`
4. 再導回實際應用頁面

`andromeda` 目前採用 Bearer token，而不是完全依賴 HttpOnly cookie。

相關檔案：

- [/Users/backtrue/Documents/andromeda/frontend/src-shared/api/client.ts](/Users/backtrue/Documents/andromeda/frontend/src-shared/api/client.ts)
- [/Users/backtrue/Documents/andromeda/frontend/src-shared/hooks/useAuth.ts](/Users/backtrue/Documents/andromeda/frontend/src-shared/hooks/useAuth.ts)

## 子服務 Worker 驗證 JWT 的標準做法

Worker 中介層建議順序：

1. 從 `Authorization` 或 cookie 抽 token
2. 先 decode JWT payload 檢查基本格式與 `exp`
3. 若有 `ECCAL_SERVICE_SECRET`，先做本地 HS256 驗簽
4. 再打 ECCAL `verify-token` 取正式 membership / credits
5. 驗證成功後把 user 掛進 request context

`andromeda` 目前實作：

- [/Users/backtrue/Documents/andromeda/src/middleware/auth.ts](/Users/backtrue/Documents/andromeda/src/middleware/auth.ts)

關鍵點：

- Cloudflare Workers 沒有必要依賴 Node.js `Buffer`
- 直接用 `atob` + `TextDecoder` 做 base64url decode
- HS256 驗簽使用 `crypto.subtle`

參考：

- Cloudflare 官方文件：[Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- Cloudflare 官方文件：[Fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/)

## ECCAL 成功回應規格

### `POST /api/sso/verify-token`

目前正式環境已驗證到的成功格式：

```json
{
  "success": true,
  "valid": true,
  "user": {
    "id": "102598988575056957509",
    "email": "backtrue@gmail.com",
    "name": "邱煜庭（邱小黑）",
    "membership": "pro",
    "membershipExpires": null,
    "credits": 92,
    "profileImageUrl": "...",
    "createdAt": "2025-06-25T06:29:51.640Z"
  },
  "expiresAt": "2026-03-14T04:03:09.000Z"
}
```

### `GET /api/account-center/user/:id`

目前正式環境已驗證到的成功格式：

```json
{
  "success": true,
  "user": {
    "id": "102598988575056957509",
    "email": "backtrue@gmail.com",
    "name": "邱煜庭（邱小黑）",
    "membership": "pro",
    "membershipExpires": null,
    "credits": 92,
    "profileImageUrl": "...",
    "createdAt": "2025-06-25T06:29:51.640Z"
  }
}
```

## 會員等級與點數的判斷原則

子服務正式建議：

1. `membership` 與 `credits` 的真值以 ECCAL 為主
2. 子服務本地 DB 可以快取，但不是主真值
3. 只有在 ECCAL 暫時失敗時，才使用本地快取做保底

這是 `andromeda` 當前已上線策略：

- ECCAL 正常時，吃 ECCAL `verify-token` 的 membership / credits
- ECCAL 失敗時，不把本地已知的 membership 直接覆寫成 `free`

原因：

- SSO/會員中心是 ECCAL 的責任域
- 子服務只應持有可恢復的快取，不應永久分叉商業狀態

## 會員狀態同步建議

若服務有授權或點數消耗需求，建議分兩層：

### A. 即時授權

登入或請求進來時：

- `verify-token` 取最新 membership / credits

### B. 本地快取

同步進子服務本地 `users` 表：

- `id`
- `email`
- `name`
- `membership`
- `credits`

目的：

- 降低 ECCAL 短暫失敗時的全面故障風險
- 便於後台查詢與審計

## CORS 與網域建議

正式環境應採：

- 前端：`https://app.example.com`
- API：`https://api.example.com` 或同站 `/api/*`

不要用 `workers.dev` 當正式 API 網域。

原因：

- custom domain 與正式站 same-site 關係更穩定
- callback / cookie / CORS / analytics 行為更可控

參考：

- Cloudflare 官方文件：[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- MDN：[Site](https://developer.mozilla.org/en-US/docs/Glossary/Site)

## 新子服務最小整合清單

1. 建立 `/api/auth/login`
2. 建立 `/api/auth/user`
3. 建立 JWT middleware
4. 前端 callback 頁接 `token`
5. API client 自動帶 `Authorization: Bearer`
6. 正式環境使用 custom domain
7. `ECCAL_BASE_URL` 指向 `https://eccal.thinkwithblack.com`
8. 設定 `ECCAL_SSO_ORIGIN`
9. 若要本地驗簽，配置 `ECCAL_SERVICE_SECRET`

## 必要環境變數

以 `andromeda` 為例：

```toml
ECCAL_BASE_URL = "https://eccal.thinkwithblack.com"
PUBLIC_APP_URL = "https://andromeda.thinkwithblack.com"
ECCAL_SSO_ORIGIN = "https://audai.thinkwithblack.com"
```

若要本地 HS256 驗簽：

```toml
ECCAL_SERVICE_SECRET = "<secret>"
```

敏感值應使用 Cloudflare Worker Secret，不要放在 `vars`。

參考：

- Cloudflare 官方文件：[Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

## 驗收腳本

### 1. 驗證 ECCAL `verify-token`

```bash
TOKEN='REAL_JWT'
curl -i -sS -X POST 'https://eccal.thinkwithblack.com/api/sso/verify-token' \
  -H 'Content-Type: application/json' \
  --data "{\"token\":\"$TOKEN\"}"
```

預期：

- `HTTP 200`
- `x-eccal-version: 3.2`
- `success: true`
- 有 `user.membership`

### 2. 驗證 ECCAL `account-center/user`

```bash
USER_ID='REAL_USER_ID'
curl -i -sS "https://eccal.thinkwithblack.com/api/account-center/user/$USER_ID"
```

預期：

- `HTTP 200`
- `x-eccal-version: 3.2`
- `success: true`
- `user.membership` 與 `verify-token.user.membership` 一致

### 3. 驗證子服務正式 `/api/auth/user`

```bash
TOKEN='REAL_JWT'
curl -i -sS 'https://your-api.example.com/api/auth/user' \
  -H "Authorization: Bearer $TOKEN"
```

預期：

- `HTTP 200`
- `membership` 與 ECCAL 一致
- `credits` 與 ECCAL 一致

## 實作參考檔案

- ECCAL Worker relay login：
  [/Users/backtrue/Documents/andromeda/src/routes/auth.ts](/Users/backtrue/Documents/andromeda/src/routes/auth.ts)
- JWT middleware：
  [/Users/backtrue/Documents/andromeda/src/middleware/auth.ts](/Users/backtrue/Documents/andromeda/src/middleware/auth.ts)
- ECCAL membership/credits service：
  [/Users/backtrue/Documents/andromeda/src/services/eccalAuthService.ts](/Users/backtrue/Documents/andromeda/src/services/eccalAuthService.ts)
- ECCAL 問題修復 ticket：
  [/Users/backtrue/Documents/andromeda/docs/eccal-sso/FIX_TICKET.md](/Users/backtrue/Documents/andromeda/docs/eccal-sso/FIX_TICKET.md)

## 結論

未來其他子服務若也是 Cloudflare Worker，應直接複用這個模式：

- 前端不直連 ECCAL
- Worker relay 啟動登入
- 前端存 Bearer JWT
- Worker 用 `verify-token` 做正式授權
- 子服務本地 DB 只做快取，不做最終真值

這樣可以避開：

- `workers.dev` / custom domain 混用
- 第三方 cookie / session 假設
- API 被頁面 redirect middleware 汙染
- 會員狀態在多服務間分叉
