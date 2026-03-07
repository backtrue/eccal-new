# ECCAL S2S 修復 Ticket

## 標題
修正 ECCAL S2S API 對 Cloudflare Worker 的 redirect loop，並統一 `verify-token` / `account-center` 會員資料來源

## Severity
P0

## 背景
目前 ECCAL 公開 API 從 `curl` 直打已可正常回應，但從 Cloudflare Worker 內部 `fetch()` 呼叫時，仍會在以下端點發生 redirect loop：

- `POST /api/sso/verify-token`
- `GET /api/account-center/user/:id`

另外，目前兩個端點的會員資料不一致：

- `verify-token.user.membership = "free"`
- `account-center.user.membership = "pro"`

這會導致依賴 ECCAL S2S 的子服務在 Worker 環境下判斷錯誤。

## 重現步驟

### Case 1: 直打 ECCAL API
1. `POST https://eccal.thinkwithblack.com/api/sso/verify-token`
2. `GET https://eccal.thinkwithblack.com/api/account-center/user/:id`

### 目前結果
- 兩者都回 `200`
- response header 可見：
  - `x-eccal-version`
  - `x-eccal-route`

### Case 2: 從 Cloudflare Worker 內呼叫
使用任一 Worker：

```js
export default {
  async fetch() {
    const verifyResp = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'REAL_JWT' }),
    });

    const userResp = await fetch('https://eccal.thinkwithblack.com/api/account-center/user/REAL_USER_ID');

    return new Response(JSON.stringify({
      verifyStatus: verifyResp.status,
      userStatus: userResp.status,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

### 目前結果
Worker 端會出現：

```text
TypeError: Too many redirects
```

## 預期行為

### API 層
以下端點在任何非瀏覽器環境下都必須直接回 JSON，不得 redirect：

- `POST /api/sso/verify-token`
- `GET /api/account-center/user/:id`
- `GET /api/account-center/credits/:id`

### 回應規範
- 成功：`200 application/json`
- token 無效：`401 application/json`
- 權限不足：`403 application/json`
- server error：`5xx application/json`
- 不得出現 `301/302/307/308`

### 資料一致性
以下資料必須一致：

- `verify-token.user.membership`
- `account-center.user.membership`
- `verify-token.user.credits`
- `account-center.user.credits`

## 直接修改方案

### 1. `/api/*` 與頁面 redirect middleware 分離
如果目前有 session middleware / page login middleware，必須避免影響 `/api/*`

錯誤模式：

```js
app.use(sessionMiddleware);
app.use(requireLoginRedirect);
app.use('/api', apiRouter);
```

正確模式：

```js
app.use('/api', apiRouter);
app.use(sessionMiddleware);
app.use(pageRouter);
```

或至少：

```js
function requirePageLogin(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }

  return next();
}
```

### 2. API route 禁止 redirect
在 `/api/*` 前掛一層 redirect blocker：

```js
function rejectRedirectOnApi(req, res, next) {
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const originalRedirect = res.redirect.bind(res);

  res.redirect = function patchedRedirect(statusOrUrl, maybeUrl) {
    let statusCode = 302;
    let location = '';

    if (typeof statusOrUrl === 'number') {
      statusCode = statusOrUrl;
      location = String(maybeUrl || '');
    } else {
      location = String(statusOrUrl || '');
    }

    res.set('x-eccal-redirect-bypassed', 'true');

    return res.status(401).json({
      success: false,
      error: 'API_REDIRECT_BLOCKED',
      details: {
        statusCode,
        location,
      },
    });
  };

  return next();
}
```

### 3. `verify-token` 改成純 API 驗證
`POST /api/sso/verify-token` 不可依賴頁面 session / login state，必須只做：

1. 解析 body token
2. 驗證 JWT
3. 讀取帳號快照
4. 回 JSON

範例：

```js
router.post('/verify-token', async (req, res) => {
  try {
    const token = req.body?.token;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        valid: false,
        error: 'TOKEN_REQUIRED',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ECCAL_SERVICE_SECRET, {
        algorithms: ['HS256'],
      });
    } catch (error) {
      return res.status(401).json({
        success: false,
        valid: false,
        error: 'INVALID_TOKEN',
        details: error.message,
      });
    }

    const userId = decoded.id || decoded.sub;
    if (!userId) {
      return res.status(401).json({
        success: false,
        valid: false,
        error: 'INVALID_TOKEN_PAYLOAD',
      });
    }

    const account = await accountService.getAccountSnapshot(userId);
    if (!account) {
      return res.status(404).json({
        success: false,
        valid: false,
        error: 'ACCOUNT_NOT_FOUND',
      });
    }

    return res.status(200).json({
      success: true,
      valid: true,
      user: account,
      expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      valid: false,
      error: 'VERIFY_TOKEN_INTERNAL_ERROR',
      details: error.message,
    });
  }
});
```

### 4. `verify-token` 與 `account-center` 共用同一份 account snapshot
抽成單一 service，不准兩條 route 各自讀不同資料源。

```js
class AccountService {
  constructor(db) {
    this.db = db;
  }

  async getAccountSnapshot(userId) {
    const row = await this.db.getUserAccountById(userId);
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      membership: row.membership || 'free',
      membershipExpires: row.membership_expires || null,
      credits: Number.isFinite(row.credits) ? row.credits : 0,
      profileImageUrl: row.profile_image_url || null,
      createdAt: row.created_at || null,
    };
  }
}
```

`/api/sso/verify-token` 與 `/api/account-center/user/:id` 全部只吃這個 service。

## 驗收條件

### A. API 不再 redirect
以下端點從 `curl` 與 Cloudflare Worker 內部呼叫，都不得回任何 `3xx`：

- `POST /api/sso/verify-token`
- `GET /api/account-center/user/:id`

### B. Worker 內呼叫成功
Cloudflare Worker 內部 `fetch()` 實測：

- `verify-token` 回 `200`
- `account-center/user/:id` 回 `200`

### C. 會員資料一致
同一位使用者：

- `verify-token.user.membership === account-center.user.membership`
- `verify-token.user.credits === account-center.user.credits`

### D. Header 保留
response header 應保留：

- `x-eccal-version`
- `x-eccal-route`
- `x-eccal-redirect-bypassed`

## 驗收腳本

### 1. `curl` 驗證 `verify-token`

```bash
curl -i -sS -X POST 'https://eccal.thinkwithblack.com/api/sso/verify-token' \
  -H 'Content-Type: application/json' \
  --data '{"token":"REAL_JWT"}'
```

驗收重點：
- `HTTP 200`
- `Content-Type: application/json`
- 沒有 `Location` 導向
- body 內有：
  - `success: true`
  - `valid: true`
  - `user.membership`
  - `user.credits`

### 2. `curl` 驗證 `account-center`

```bash
curl -i -sS 'https://eccal.thinkwithblack.com/api/account-center/user/REAL_USER_ID'
```

驗收重點：
- `HTTP 200`
- 沒有 `Location`
- body 內 `user.membership`、`user.credits`

### 3. Cloudflare Worker 驗收腳本

```js
export default {
  async fetch() {
    const token = 'REAL_JWT';
    const userId = 'REAL_USER_ID';

    const verifyResp = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    const verifyText = await verifyResp.text();

    const userResp = await fetch(`https://eccal.thinkwithblack.com/api/account-center/user/${userId}`);
    const userText = await userResp.text();

    return new Response(JSON.stringify({
      verify: {
        status: verifyResp.status,
        location: verifyResp.headers.get('location'),
        route: verifyResp.headers.get('x-eccal-route'),
        version: verifyResp.headers.get('x-eccal-version'),
        redirectBypassed: verifyResp.headers.get('x-eccal-redirect-bypassed'),
        body: JSON.parse(verifyText),
      },
      user: {
        status: userResp.status,
        location: userResp.headers.get('location'),
        route: userResp.headers.get('x-eccal-route'),
        version: userResp.headers.get('x-eccal-version'),
        redirectBypassed: userResp.headers.get('x-eccal-redirect-bypassed'),
        body: JSON.parse(userText),
      },
    }, null, 2), {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  },
};
```

驗收重點：
- `verify.status === 200`
- `user.status === 200`
- `verify.location === null`
- `user.location === null`
- `verify.body.user.membership === user.body.user.membership`
- `verify.body.user.credits === user.body.user.credits`

### 4. Node 驗收腳本

```js
const token = process.env.ECCAL_TEST_TOKEN;
const userId = process.env.ECCAL_TEST_USER_ID;

async function main() {
  const verifyResp = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
    redirect: 'follow',
  });

  const verifyBody = await verifyResp.json();

  const userResp = await fetch(`https://eccal.thinkwithblack.com/api/account-center/user/${userId}`, {
    redirect: 'follow',
  });
  const userBody = await userResp.json();

  console.log(JSON.stringify({
    verifyStatus: verifyResp.status,
    userStatus: userResp.status,
    verifyMembership: verifyBody?.user?.membership,
    userMembership: userBody?.user?.membership,
    verifyCredits: verifyBody?.user?.credits,
    userCredits: userBody?.user?.credits,
  }, null, 2));

  if (verifyResp.status !== 200) process.exit(1);
  if (userResp.status !== 200) process.exit(1);
  if (verifyBody?.user?.membership !== userBody?.user?.membership) process.exit(2);
  if (verifyBody?.user?.credits !== userBody?.user?.credits) process.exit(3);
}

main().catch((error) => {
  console.error(error);
  process.exit(99);
});
```

## 實際觀察到的問題
1. `curl` 直打 ECCAL API 正常
2. Cloudflare Worker 內部仍可能 `Too many redirects`
3. `verify-token` 與 `account-center` 的 `membership` 可能不一致

## 參考資料
- Express middleware 官方文件  
  https://expressjs.com/en/guide/using-middleware.html
- Cloudflare Workers `fetch()` 官方文件  
  https://developers.cloudflare.com/workers/runtime-apis/fetch/
- Cloudflare Workers `Request` 官方文件  
  https://developers.cloudflare.com/workers/runtime-apis/request/
- Cloudflare `workerd` redirect/header 真實議題  
  https://github.com/cloudflare/workerd/issues/2223
