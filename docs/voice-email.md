# 語音成果 Email 交付

依 realtime-black [Issue #23](https://github.com/backtrue/realtime-black/issues/23)與使用者核定，成果只寄到該會員的 ECCAL 登入信箱，使用既有 Resend 帳號

`server/voiceEmailRoutes.ts` 在全站本文與請求紀錄 middleware 之前註冊，由 `THINKWITHBLACK_VOICE_SERVICE_TOKEN` 驗證。三個內部端點為 `/api/voice/internal/email/recipient`、`verify`、`send`，皆採嚴格 JSON、no-store 與 eccal-voice-v1 契約

`server/voiceEmailService.ts` 從 users 查詢登入信箱，寄送前再次核對。Resend 憑證沿用 `RESEND_API_KEY`，成果網址限定 `VOICE_APP_ORIGIN`，寄件人為已驗證網域的 `AI 小黑 <call@toldyou.co>`

成功回傳提供者收據；明確拒絕與不明回應分別記錄固定失敗代碼及可用 HTTP 狀態，7 秒逾時不重送，Idempotency-Key 綁定同一工作

完整欄位與會員流程見 realtime-black 的 [Email 成果交付](https://github.com/backtrue/realtime-black/blob/main/docs/email-delivery.md)

```sh
npm run check
REALTIME_BLACK_ROOT=/path/to/realtime-black npm run test:voice-email
npm run build
```

測試只使用本機隨機 PostgreSQL schema、實際 HTTP／通話引擎與受控提供者回應，測後清理合成資料
