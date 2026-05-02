# Adcheck Cloudflare Worker

`adcheck.thinkwithblack.com` 的獨立 Worker 部署入口。

## Deploy

```bash
npx wrangler secret put DATABASE_URL --config cloudflare/adcheck-worker/wrangler.jsonc
npx wrangler secret put JWT_SECRET --config cloudflare/adcheck-worker/wrangler.jsonc
npx wrangler deploy --config cloudflare/adcheck-worker/wrangler.jsonc
```

## Domain

`wrangler.jsonc` 已設定：

```json
{
  "routes": [
    {
      "pattern": "adcheck.thinkwithblack.com",
      "custom_domain": true
    }
  ]
}
```

部署後 Cloudflare 會把 `adcheck.thinkwithblack.com` 綁到 Worker custom domain。

## Auth

Worker 使用 ECCAL 既有 SSO：

```text
https://eccal.thinkwithblack.com/api/auth/google-sso?service=adcheck&returnTo=https://adcheck.thinkwithblack.com
```

OAuth callback 回到 `adcheck.thinkwithblack.com?token=...` 後，Worker 會把 token 寫入 `auth_token` HttpOnly cookie。
