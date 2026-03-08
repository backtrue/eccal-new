# ECCAL SSO 新子服務模板（Cloudflare Worker）

最後更新：2026-03-08

本模板給新的 Cloudflare Worker 子服務直接複用。目標是最短路徑接上 ECCAL，不再重複踩 `workers.dev`、redirect、cookie、same-site、membership 分叉這些坑。

正式基準說明請搭配：

- [/Users/backtrue/Documents/andromeda/docs/eccal-sso/WORKER_FIRST_GUIDE.md](/Users/backtrue/Documents/andromeda/docs/eccal-sso/WORKER_FIRST_GUIDE.md)

參考來源：

- ECCAL 官方文件：[ECCAL SSO Guide](https://eccal.thinkwithblack.com/sso-guide)
- Cloudflare 官方文件：[Fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
- Cloudflare 官方文件：[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- Cloudflare 官方文件：[Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

## 最小檔案結構

```text
src/
  index.ts
  routes/
    auth.ts
  middleware/
    auth.ts
  utils/
    security.ts
frontend/
  src-shared/
    api/client.ts
    hooks/useAuth.ts
  public/
    oauth-callback.html
wrangler.toml
```

## Worker 必備環境變數

```toml
ECCAL_BASE_URL = "https://eccal.thinkwithblack.com"
PUBLIC_APP_URL = "https://your-app.example.com"
ECCAL_SSO_ORIGIN = "https://audai.thinkwithblack.com"
```

若要本地 HS256 驗簽：

```toml
# 用 secret，不要放 vars
ECCAL_SERVICE_SECRET = "<secret>"
```

## 必備路由

新的子服務至少要有：

- `GET /api/auth/login`
- `GET /api/auth/callback`
- `GET /api/auth/user`
- `POST /api/auth/logout`

## `GET /api/auth/login`

用途：

- 由 Worker 伺服器端啟動 ECCAL SSO
- 不能讓前端直接硬組 ECCAL login URL

完整範例：

```ts
import { Hono } from 'hono';

type Env = {
  ECCAL_BASE_URL: string;
  PUBLIC_APP_URL?: string;
  ECCAL_SSO_ORIGIN?: string;
};

const auth = new Hono<{ Bindings: Env }>();

function getPublicAppUrl(env: Env, requestUrl: string): string {
  if (env.PUBLIC_APP_URL) {
    return env.PUBLIC_APP_URL.replace(/\/$/, '');
  }

  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}`;
}

auth.get('/login', async (c) => {
  const eccalBaseUrl = c.env.ECCAL_BASE_URL;
  const publicAppUrl = getPublicAppUrl(c.env, c.req.url);
  const returnTo = `${publicAppUrl}/auth/callback`;
  const eccalSsoOrigin = c.env.ECCAL_SSO_ORIGIN || 'https://audai.thinkwithblack.com';

  const params = new URLSearchParams({
    service: 'audai',
    returnTo,
  });

  const bootstrapUrl = `${eccalBaseUrl}/api/sso/login?${params.toString()}`;

  const response = await fetch(bootstrapUrl, {
    method: 'GET',
    headers: {
      Origin: eccalSsoOrigin,
    },
    redirect: 'manual',
  });

  const location = response.headers.get('location');
  if (!location || response.status < 300 || response.status >= 400) {
    const errorText = await response.text();
    console.error('[auth] ECCAL login bootstrap failed', {
      status: response.status,
      location,
      errorText,
    });
    return c.json({ error: 'Failed to initialize login' }, 502);
  }

  return c.redirect(new URL(location, eccalBaseUrl).toString());
});

export default auth;
```

## `GET /api/auth/callback`

用途：

- 接 ECCAL 回跳的 `?token=...`
- 寫入自家 token cookie
- 再轉回前端 callback 頁

完整範例：

```ts
function getSharedCookieDomain(publicAppUrl: string): string | null {
  const hostname = new URL(publicAppUrl).hostname.toLowerCase();
  if (hostname === 'example.com' || hostname.endsWith('.example.com')) {
    return 'example.com';
  }
  return null;
}

function buildAuthCookie(token: string, publicAppUrl: string): string {
  const parts = [
    `app-jwt-token=${token}`,
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
  ];

  const domain = getSharedCookieDomain(publicAppUrl);
  if (domain) {
    parts.push(`Domain=${domain}`);
  }

  return parts.join('; ');
}

auth.get('/callback', async (c) => {
  const token = c.req.query('token');
  const publicAppUrl = getPublicAppUrl(c.env, c.req.url);

  if (!token) {
    return c.json({ error: 'No token provided' }, 400);
  }

  c.header('Set-Cookie', buildAuthCookie(token, publicAppUrl));
  return c.redirect(`${publicAppUrl}/auth/callback?token=${encodeURIComponent(token)}`);
});
```

## JWT middleware

用途：

- 讀 `Authorization: Bearer`
- decode payload
- 檢查 `exp`
- 可選本地 HS256 驗簽
- 打 ECCAL `verify-token`

完整範例：

```ts
import { Context, Next } from 'hono';

type JWTUser = {
  id: string;
  email: string;
  name: string;
  membership?: string;
  credits?: number;
};

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeBase64UrlUtf8(input: string): string {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

function extractBearerToken(c: Context): string | null {
  const value = c.req.header('Authorization');
  if (!value || !value.startsWith('Bearer ')) {
    return null;
  }
  return value.slice('Bearer '.length);
}

function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    return JSON.parse(decodeBase64UrlUtf8(parts[1])) as Record<string, unknown>;
  } catch (error) {
    console.error('[auth] decodeJWT failed', error);
    return null;
  }
}

async function verifyTokenWithEccal(token: string, eccalBaseUrl: string): Promise<JWTUser | null> {
  try {
    const response = await fetch(`${eccalBaseUrl}/api/sso/verify-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      console.warn('[auth] ECCAL verify-token failed', response.status);
      return null;
    }

    const data = await response.json() as any;
    if (!data.success || !data.user || data.valid === false) {
      return null;
    }

    return {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      membership: data.user.membership || 'free',
      credits: data.user.credits || 0,
    };
  } catch (error) {
    console.error('[auth] ECCAL verify-token error', error);
    return null;
  }
}

export async function jwtAuth(c: Context, next: Next) {
  const token = extractBearerToken(c);
  if (!token) {
    return c.json({ error: 'Unauthorized - No token provided' }, 401);
  }

  const payload = decodeJWT(token);
  if (!payload) {
    return c.json({ error: 'Unauthorized - Invalid token format' }, 401);
  }

  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    return c.json({ error: 'Unauthorized - Token expired' }, 401);
  }

  const user = await verifyTokenWithEccal(
    token,
    (c.env as { ECCAL_BASE_URL?: string }).ECCAL_BASE_URL || 'https://eccal.thinkwithblack.com'
  );

  if (!user) {
    return c.json({ error: 'Unauthorized - Token verification failed' }, 401);
  }

  c.set('user', user);
  await next();
}
```

## `GET /api/auth/user`

用途：

- 讓前端初始化登入狀態
- 只回目前 Worker context 已驗證過的 user

範例：

```ts
auth.get('/user', jwtAuth, async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    membership: user.membership || 'free',
    credits: user.credits || 0,
  });
});
```

## 前端最小 client

`frontend/src-shared/api/client.ts`

```ts
import axios from 'axios';

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL || 'https://api.example.com';

const apiClient = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('eccal_auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default apiClient;
```

## 前端 callback 頁最小實作

`frontend/public/oauth-callback.html`

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>登入中</title>
  </head>
  <body>
    <script>
      (function () {
        var params = new URLSearchParams(window.location.search);
        var token = params.get('token');

        if (token) {
          localStorage.setItem('eccal_auth_token', token);
        }

        window.location.replace('/');
      })();
    </script>
  </body>
</html>
```

## 上線前檢查清單

1. 子服務正式 API 是否使用 custom domain
2. `/api/auth/login` 是否由 Worker relay，而不是前端直連 ECCAL
3. `verify-token` 是否回 `200` 且有 `x-eccal-version: 3.2`
4. `account-center/user/:id` 是否與 `verify-token` 回同樣 membership / credits
5. `/api/auth/user` 是否與 ECCAL 一致
6. 是否沒有任何 dev bypass header / mock login 殘留

## 驗收命令

### 驗證 `verify-token`

```bash
TOKEN='REAL_JWT'
curl -i -sS -X POST 'https://eccal.thinkwithblack.com/api/sso/verify-token' \
  -H 'Content-Type: application/json' \
  --data "{\"token\":\"$TOKEN\"}"
```

### 驗證 `account-center/user`

```bash
USER_ID='REAL_USER_ID'
curl -i -sS "https://eccal.thinkwithblack.com/api/account-center/user/$USER_ID"
```

### 驗證子服務 `/api/auth/user`

```bash
TOKEN='REAL_JWT'
curl -i -sS 'https://api.example.com/api/auth/user' \
  -H "Authorization: Bearer $TOKEN"
```

## 結論

新的 Cloudflare Worker 子服務，應以這個模板為起點：

- Worker relay login
- Bearer JWT
- ECCAL `verify-token`
- ECCAL `account-center/user`
- custom domain

不要再從舊版文件直接搬前端直連或暫時 workaround。
