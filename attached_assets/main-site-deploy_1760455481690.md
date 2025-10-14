# eccal 主站部署筆記

## 1. 變更總覽
- **JWT scope 支援**：`server/services/eccalAuth.ts` 的 `generateInternalJWT()` 依 membership 推導 scopes，移除 `refresh_token`，並設定 15 分鐘有效期。
- **Worker 驗證配合**：Cloudflare Worker (`galine-worker`) 透過 `/api/auth/get-token` 重新簽發短效 scope token，並對 `/api/line/*` 路由進行 scope 檢查。
- **前端更新**：`client/src/lib/queryClient.ts` 會於請求前自動呼叫 `/api/auth/get-token` 取得短效 JWT 並緩存於 `localStorage`（鍵名 `eccal_auth_scoped_token`）；`client/src/lib/auth.ts` 切換登入狀態時同步清除。
- **部署腳本**：新增 `scripts/deploy-pages.mjs` 與 `pnpm pages:deploy` 指令，用於 Cloudflare Pages 靜態資源部署。

## 2. 主站程式碼需要合併的修改
- **`server/services/eccalAuth.ts`**
```ts
const payload: Record<string, unknown> = {
  email: userData.email,
  name: userData.name,
  membership: userData.membership,
  credits: userData.credits,
  scope: scopes,
  iat: now,
  exp: now + 15 * 60,
};
```
  - 舊版本若有 `payload.refresh_token = ...` 請移除；主站本身仍可保留 refresh token 於資料庫，但不再寫入 JWT。

- **Cloudflare Pages 靜態檔案**
  - 建置指令：`pnpm client:build`
  - 部署指令：
    ```bash
    CF_PAGES_PROJECT_NAME=galine pnpm pages:deploy
    ```
  - 完成後到 Cloudflare Pages Dashboard Promote 最新版本。

## 3. 部署流程（主站 eccal.thinkwithblack.com）
- **Step 1｜拉取/合併最新程式碼**：確保 `server/services/eccalAuth.ts`、`client/src/lib/queryClient.ts`、`client/src/lib/auth.ts` 等更新已在主站 repo。
- **Step 2｜環境變數同步**：確認 Replit 上的 `JWT_SECRET` 與 Cloudflare Worker 的 `ECCAL_JWT_SECRET` 一致。
- **Step 3｜重新部署主站**：
  ```bash
  pnpm install
  pnpm build
  pnpm start   # 或照主站既有部署流程
  ```
- **Step 4｜測試**：
  - 呼叫主站簽發 token (`/api/auth/convert-token` 或登入流程)。
  - 使用簽發出的 JWT 呼叫 Worker（例如 `/api/line/status`、`/api/line/test`），確認 scope 驗證生效。
  - 確認新 JWT payload 無 `refresh_token` 欄位。

## 4. 後續提醒
- 若 worker 或前端再調整 scope 清單，需同步更新 `server/services/eccalAuth.ts` 的 `deriveScopes()`。
- 建議將 `eccal_auth_scoped_token` 改存於 `sessionStorage` 或改由 Worker 使用 HttpOnly Cookie，以降低 XSS 風險。
