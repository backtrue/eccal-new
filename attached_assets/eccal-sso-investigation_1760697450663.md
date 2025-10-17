# Eccal SSO 調查需求

## 問題摘要
- **現象**：首次登入 GA LINE Reporter（`https://galine.thinkwithblack.com`）的使用者在完成 Google SSO 後，回跳網址僅帶 `?user_id=<id>`，缺少預期的 `auth_success=true` 與 `token=<jwt>` 參數，導致前端無法換取內部 access/refresh token。
- **錯誤訊息**：Cloudflare Worker 端記錄 `"exp" claim timestamp check failed`，顯示從 Eccal SSO 返回的 JWT 在驗證 `exp`（過期時間）時即被判定為無效。
- **影響範圍**：所有重新註冊或首次登入的使用者將卡在登入頁面，無法取得系統授權。

## 需要 Eccal 協助的項目
- **[檢查 JWT 生成流程]**
  - 確認 `service=galine` 的 SSO 設定是否正確（允許的 redirect domain、有效時間等）。
  - 檢視 JWT payload 中 `exp`、`iat` 的值，確保 token 生成時未立即過期，並容許 1–2 分鐘的時鐘偏差。
  - 若使用快取/重發機制，請確認不會回傳舊的（已過期） token。

- **[核對系統時間]**
  - 比對 Eccal SSO 伺服器與 Cloudflare Worker 的 UTC 時間是否存在明顯差距。
  - 若採用容忍度設定，請提供目前允許的 clock skew（例如 ±5 秒）。

- **[登入流程回傳資訊]**
  - 針對 `service=galine` 的登入流程，確認在成功授權時必定帶回 `auth_success=true` 與 `token=<jwt>` 參數。
  - 若 SSO 還會附帶 `user_id`，請確認是否有其他判斷邏輯會在缺少 `token` 時仍返回 `user_id`（以利排查為何出現半成品的 callback）。

- **[提供日誌]**
  - 請協助提供對應時段（約登入後立即跳轉回 GA LINE Reporter）之 SSO 伺服器的日誌，尤其是 JWT 生成與驗證部分。
  - 若日誌中已有 `exp claim timestamp check failed` 或其他錯誤資訊，請一併回報。

## 我們可提供的補充資訊
- Cloudflare Worker 端呼叫 `/api/auth/convert-token` 時，因 `exp` 驗證失敗而回覆 401。
- 問題帳號的登入回跳 URL 範例：`https://galine.thinkwithblack.com/?user_id=117064908070974409833`
- 若需要 worker 端更多詳細日誌，可再配合提供。

## 期望結果
- Eccal SSO 在成功登入後返回有效的 JWT 並附帶 `auth_success=true`，GA LINE Reporter 才能完成 access/refresh token 的換發流程。
- 確保 JWT 生效時間足夠，避免「剛生成就過期」的情況。
