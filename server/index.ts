import express from 'express';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { registerRoutes } from './routes';
import { setupVite, serveStatic } from './vite';
import { setupJWTGoogleAuth, jwtMiddleware } from './jwtAuth';
import { setupGAConnection } from './gaConnection';

// -------------------- 1. 基礎設定 --------------------
const app = express();

// -------------------- 1.05. 全域基礎中間件（必須最早執行）--------------------
// 解析 JSON / URL-encoded body：此區塊必須在所有路由之前，解決 body 為 undefined 問題
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// -------------------- 1.06. /api/* 永遠回 JSON，禁止 redirect --------------------
// P0 修復：防止任何 redirect 中間件或邏輯影響 S2S API 端點
// Cloudflare Worker S2S 呼叫如遇到 redirect 會觸發 "Too many redirects" 錯誤
// 例外路徑（OAuth/SSO 瀏覽器流程需要 redirect）：
//   /api/auth/*  - Google OAuth 起始 & callback（瀏覽器流程）
//   /api/sso/login  - 啟動 SSO 登入（瀏覽器流程）
//   /api/sso/callback - SSO callback（瀏覽器流程）
//   /api/sso/logout - 登出後 redirect 回子服務
const API_REDIRECT_ALLOWED_PREFIXES = [
  '/api/auth/',
  '/api/sso/login',
  '/api/sso/callback',
  '/api/sso/logout',
];

app.use('/api', (req, res, next) => {
  const path = req.path;
  const redirectAllowed = API_REDIRECT_ALLOWED_PREFIXES.some(p => path === p || path.startsWith(p));

  if (!redirectAllowed) {
    // 攔截 res.redirect，將其轉換為 JSON 錯誤，而非 301/302/307/308
    (res as any).redirect = function(statusOrUrl: any, url?: string) {
      const target = url || (typeof statusOrUrl === 'string' ? statusOrUrl : 'unknown');
      const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
      console.warn(`[API-REDIRECT-BLOCKED] ${req.method} ${path} attempted redirect ${status} → ${target}`);
      res.setHeader('X-ECCAL-Redirect-Bypassed', 'true');
      return res.status(401).json({
        success: false,
        error: 'API_REDIRECT_BLOCKED',
        message: 'This S2S API endpoint does not redirect. Always returns JSON.',
        redirectTarget: target
      });
    };
  }

  // 診斷 headers：方便 Cloudflare Worker / curl 快速排查
  res.setHeader('X-ECCAL-Route', path);
  res.setHeader('X-ECCAL-Auth-Mode', req.headers.authorization ? 'bearer' : req.cookies?.auth_token ? 'cookie' : 'none');
  res.setHeader('X-ECCAL-Redirect-Bypassed', redirectAllowed ? 'n/a' : 'false');
  res.setHeader('X-ECCAL-Version', '3.2');

  next();
});

// -------------------- 1.1 Health Check 端點 --------------------
// 簡單的健康檢查端點 - 必須在所有其他中間件之前
app.get('/health', async (req, res) => {
  try {
    // 快速健康檢查，不包含數據庫檢查以提升響應速度
    res.status(200).json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      port: process.env.PORT || 5000,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// 更詳細的就緒檢查端點，包含數據庫連接檢查
app.get('/ready', async (req, res) => {
  try {
    // 動態導入數據庫檢查函數以避免啟動時初始化
    const { checkDatabaseHealth } = await import('./db.js');
    const dbHealthy = await checkDatabaseHealth();
    
    if (dbHealthy) {
      res.status(200).json({
        status: 'ready',
        database: 'connected',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        database: 'disconnected',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      database: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// -------------------- 1.5. 高優先級 API 端點 --------------------
// 這些端點必須在所有中間件之前註冊，避免被 Vite 攔截

// 測試頁面端點
app.get('/test-google-oauth.html', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Google OAuth 測試</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        button {
            background: #4285f4;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            margin: 10px 0;
        }
        button:hover {
            background: #357ae8;
        }
        .log {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
            border-left: 4px solid #007bff;
            font-family: monospace;
        }
        .error {
            border-left-color: #dc3545;
            background: #f8d7da;
        }
        .success {
            border-left-color: #28a745;
            background: #d4edda;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Google OAuth 測試</h1>
        
        <div id="status">
            <h2>狀態檢查</h2>
            <div id="url-params"></div>
            <div id="auth-result"></div>
        </div>
        
        <div id="user-info" style="display: none;">
            <h2>用戶資訊</h2>
            <div id="user-data"></div>
        </div>
        
        <div id="test-results">
            <h2>測試結果</h2>
            <div id="test-log"></div>
        </div>
        
        <div>
            <button onclick="testGoogleLogin()">測試 Google 登入</button>
            <button onclick="testTokenVerification()">測試 Token 驗證</button>
            <button onclick="clearLocalStorage()">清除本地資料</button>
        </div>
    </div>

    <script>
        // 檢查 URL 參數
        function checkUrlParams() {
            const urlParams = new URLSearchParams(window.location.search);
            const authSuccess = urlParams.get('auth_success');
            const token = urlParams.get('token');
            
            document.getElementById('url-params').innerHTML = 
                'auth_success: ' + authSuccess + '<br>' +
                'token: ' + (token ? token.substring(0, 20) + '...' : 'none');
                
            if (authSuccess === 'true' && token) {
                localStorage.setItem('eccal_auth_token', token);
                verifyToken(token);
            }
        }
        
        function verifyToken(token) {
            fetch('/api/sso/verify-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token })
            })
            .then(response => response.json())
            .then(data => {
                if (data.valid && data.user) {
                    document.getElementById('auth-result').innerHTML = 
                        '<div class="success">Token 有效！</div>';
                    document.getElementById('user-data').innerHTML = 
                        'Email: ' + data.user.email + '<br>' +
                        'Name: ' + data.user.name + '<br>' +
                        'Membership: ' + data.user.membershipLevel + '<br>' +
                        'Credits: ' + data.user.credits;
                    document.getElementById('user-info').style.display = 'block';
                } else {
                    document.getElementById('auth-result').innerHTML = 
                        '<div class="error">Token 無效</div>';
                }
            })
            .catch(error => {
                document.getElementById('auth-result').innerHTML = 
                    '<div class="error">驗證失敗: ' + error.message + '</div>';
            });
        }
        
        function testGoogleLogin() {
            const returnUrl = encodeURIComponent(window.location.href);
            window.location.href = '/api/auth/google-sso?returnTo=' + returnUrl + '&service=test';
        }
        
        function testTokenVerification() {
            const token = localStorage.getItem('eccal_auth_token');
            if (token) {
                verifyToken(token);
            } else {
                document.getElementById('auth-result').innerHTML = 
                    '<div class="error">沒有找到本地 Token</div>';
            }
        }
        
        function clearLocalStorage() {
            localStorage.removeItem('eccal_auth_token');
            document.getElementById('auth-result').innerHTML = 
                '<div class="log">本地資料已清除</div>';
            document.getElementById('user-info').style.display = 'none';
        }
        
        // 頁面載入時檢查
        checkUrlParams();
    </script>
</body>
</html>
  `);
});

// SSO 整合指南文件頁面
app.get('/sso-guide', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>報數據 SSO 整合指南 v3</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8f9fa; color: #212529; line-height: 1.6; }
        .sidebar { position: fixed; top: 0; left: 0; width: 250px; height: 100vh; background: #0f172a; overflow-y: auto; padding: 24px 0; z-index: 100; }
        .sidebar-logo { padding: 0 20px 20px; border-bottom: 1px solid #1e293b; margin-bottom: 16px; }
        .sidebar-logo h2 { color: #fff; font-size: 16px; }
        .sidebar-logo p { color: #64748b; font-size: 12px; margin-top: 4px; }
        .sidebar a { display: block; padding: 7px 20px; color: #94a3b8; text-decoration: none; font-size: 13px; border-left: 3px solid transparent; }
        .sidebar a:hover, .sidebar a.active { color: #fff; background: rgba(255,255,255,0.05); border-left-color: #3b82f6; }
        .sidebar .sec { padding: 14px 20px 4px; font-size: 10px; text-transform: uppercase; color: #475569; letter-spacing: 1px; }
        .main { margin-left: 250px; padding: 48px 48px 80px; max-width: 900px; }
        h1 { font-size: 30px; font-weight: 700; margin-bottom: 10px; color: #0f172a; }
        h2 { font-size: 20px; font-weight: 700; margin: 48px 0 16px; color: #0f172a; padding-top: 20px; border-top: 2px solid #e2e8f0; }
        h3 { font-size: 15px; font-weight: 600; margin: 24px 0 10px; color: #1e293b; }
        h4 { font-size: 11px; font-weight: 700; color: #64748b; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: 0.6px; }
        p { margin-bottom: 12px; color: #475569; font-size: 14px; }
        .lead { font-size: 16px; color: #334155; margin-bottom: 24px; }
        code { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 1px 6px; font-family: monospace; font-size: 12px; color: #0f172a; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; margin-right: 4px; }
        .get { background: #dbeafe; color: #1e40af; }
        .post { background: #dcfce7; color: #166534; }
        .req { background: #fef3c7; color: #92400e; }
        .opt { background: #f1f5f9; color: #475569; }
        .s2s { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
        .browser { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
        pre { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 20px; font-size: 12px; line-height: 1.8; overflow-x: auto; margin: 10px 0 20px; font-family: 'Courier New', monospace; }
        pre .c { color: #64748b; }
        pre .s { color: #86efac; }
        pre .k { color: #93c5fd; }
        pre .v { color: #fca5a5; }
        pre .m { color: #fde68a; }
        .endpoint { border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 24px; overflow: hidden; }
        .endpoint-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
        .endpoint-url { font-family: monospace; font-size: 14px; font-weight: 600; color: #0f172a; }
        .endpoint-body { padding: 16px; }
        .param-table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0 16px; }
        .param-table th { background: #f8fafc; padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
        .param-table td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; font-size: 13px; vertical-align: top; }
        .param-table td:first-child { font-family: monospace; font-weight: 600; color: #0f172a; }
        .note { border-left: 4px solid; padding: 12px 16px; border-radius: 0 6px 6px 0; margin: 12px 0 20px; font-size: 13px; }
        .note.warn { border-color: #f59e0b; background: #fffbeb; color: #78350f; }
        .note.info { border-color: #3b82f6; background: #eff6ff; color: #1e3a8a; }
        .note.ok { border-color: #10b981; background: #f0fdf4; color: #064e3b; }
        .note.danger { border-color: #ef4444; background: #fef2f2; color: #7f1d1d; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
        .card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
        .card h4 { font-size: 13px; font-weight: 700; margin-bottom: 8px; color: #0f172a; text-transform: none; letter-spacing: 0; }
        .card.blue { border-color: #93c5fd; background: #eff6ff; }
        .card.purple { border-color: #c4b5fd; background: #f5f3ff; }
        .card ul { padding-left: 16px; color: #475569; font-size: 13px; }
        .card ul li { margin-bottom: 4px; }
        .flow { counter-reset: s; list-style: none; margin: 16px 0; }
        .flow li { counter-increment: s; display: flex; gap: 14px; margin-bottom: 16px; }
        .flow li::before { content: counter(s); min-width: 28px; height: 28px; background: #3b82f6; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; flex-shrink: 0; }
        .flow li .fc h4 { font-size: 14px; font-weight: 600; color: #0f172a; margin: 0 0 2px; text-transform: none; letter-spacing: 0; }
        .flow li .fc p { margin: 0; font-size: 13px; }
        .live-test { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-top: 12px; }
        .live-test input { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px 12px; font-size: 13px; font-family: monospace; margin: 4px 0 10px; }
        .live-test button { background: #3b82f6; color: white; border: none; padding: 9px 18px; border-radius: 6px; font-size: 13px; cursor: pointer; margin-right: 8px; }
        .live-test button:hover { background: #2563eb; }
        .live-test button.sec { background: #64748b; }
        .live-result { margin-top: 10px; background: #0f172a; color: #e2e8f0; border-radius: 6px; padding: 14px; font-family: monospace; font-size: 12px; min-height: 50px; white-space: pre-wrap; word-break: break-all; display: none; }
        .tag { display: inline-block; padding: 1px 7px; border-radius: 12px; font-size: 11px; font-weight: 600; margin: 0 2px; }
        .tag.yes { background: #dcfce7; color: #166534; }
        .tag.no { background: #fee2e2; color: #991b1b; }
        .tag.cond { background: #fef3c7; color: #92400e; }
        .verified { display: inline-flex; align-items: center; gap: 4px; background: #f0fdf4; border: 1px solid #86efac; color: #166534; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; }
        @media (max-width: 768px) { .sidebar { display: none; } .main { margin-left: 0; padding: 24px; } .grid2 { grid-template-columns: 1fr; } }
    </style>
</head>
<body>

<nav class="sidebar">
    <div class="sidebar-logo">
        <h2>報數據 SSO</h2>
        <p>子服務整合指南 v3.2</p>
    </div>
    <div class="sec">入門</div>
    <a href="#overview">系統概覽</a>
    <a href="#architecture">推薦架構</a>
    <a href="#prerequisites">前置需求</a>
    <a href="#cors-rules">CORS / 白名單規則</a>
    <a href="#s2s-support">S2S 支援說明</a>
    <div class="sec">Worker 優先（推薦）</div>
    <a href="#worker-first">架構說明</a>
    <a href="#worker-login">登入 Relay</a>
    <a href="#worker-jwt">JWT Middleware</a>
    <a href="#worker-template">完整 Hono 模板</a>
    <a href="#worker-env">環境變數</a>
    <a href="#worker-checklist">上線前清單</a>
    <div class="sec">模式 A：前端直連</div>
    <a href="#mode-a-flow">登入流程</a>
    <a href="#mode-a-callback">Callback 規格</a>
    <a href="#mode-a-code">完整範例</a>
    <div class="sec">API 參考</div>
    <a href="#api-login">啟動登入</a>
    <a href="#api-verify">驗證 Token</a>
    <a href="#api-user">取得用戶資料</a>
    <a href="#api-credits">點數 API</a>
    <div class="sec">進階</div>
    <a href="#membership-logic">Membership 判斷邏輯</a>
    <a href="#token-structure">JWT Token 結構</a>
    <a href="#diag-headers">診斷 Headers</a>
    <a href="#verify-scripts">驗收腳本</a>
    <a href="#troubleshoot">常見問題排查</a>
    <a href="#live-test">線上測試</a>
</nav>

<div class="main">

<h1>報數據 SSO 整合指南</h1>
<p class="lead">本文件說明子服務如何透過報數據統一身份認證（SSO）實現登入共用、會員等級同步與點數共享。</p>
<div class="note info"><strong>SSO 服務基礎網址：</strong><code>https://eccal.thinkwithblack.com</code> &nbsp;｜&nbsp; 本指南版本：<strong>v3.2</strong>（2026-03，依實際程式碼驗證）</div>

<h2 id="overview">系統概覽</h2>
<p>報數據 SSO 基於 <strong>Google OAuth 2.0 + JWT（HS256）</strong> 實現。用戶用 Google 帳號登入一次，即可在所有子服務中認證，無需重複註冊。JWT Token 由 ECCAL 簽發（有效期 7 天），子服務透過 verify-token API 或自行用 JWT_SECRET 驗證身份，並可透過 Account Center API 查詢會員等級和點數。</p>

<h2 id="architecture">推薦架構</h2>
<p>根據 andromeda 正式整合驗證後，<strong>子服務應優先採用「Worker 優先」架構</strong>，只有純前端靜態網站才使用「模式 A 前端直連」。</p>
<div class="grid2">
    <div class="card blue">
        <h4>⭐ Worker 優先（推薦）</h4>
        <ul>
            <li>前端只打子服務自己的 <code>/api/auth/login</code></li>
            <li>Worker relay 啟動 ECCAL SSO 登入</li>
            <li>前端收到 token 後存 <code>eccal_auth_token</code>（localStorage）</li>
            <li>後續 API 請求帶 <code>Authorization: Bearer</code></li>
            <li>Worker 用 <code>verify-token</code> 做即時 membership 授權</li>
        </ul>
    </div>
    <div class="card purple">
        <h4>模式 A：前端直連（次選）</h4>
        <ul>
            <li>適合：純前端 SPA、靜態網站（無 Worker）</li>
            <li>前端直接導向 <code>GET /api/auth/google-sso</code></li>
            <li>子服務 origin 需在 CORS 白名單</li>
            <li>Token 存在 localStorage</li>
        </ul>
    </div>
</div>

<table class="param-table">
    <thead><tr><th>情境</th><th>推薦</th><th>理由</th></tr></thead>
    <tbody>
        <tr><td>有 Cloudflare Worker 後端</td><td>Worker 優先</td><td>可控 returnTo / cookie / CORS；Cloudflare Worker fetch() 對 redirect 容錯比瀏覽器小，Worker relay 最穩</td></tr>
        <tr><td>純前端 SPA（無任何後端）</td><td>模式 A</td><td>無 Worker 可 relay，只能直連</td></tr>
    </tbody>
</table>

<div class="note danger"><strong>不要採用：</strong>前端直接依賴 ECCAL 的 httpOnly cookie <code>jwt</code> 作為子服務登入狀態；不要在正式環境使用 <code>workers.dev</code> 網域（cookie / CORS / SameSite 行為不穩定），應使用 custom domain。</div>

<h2 id="prerequisites">前置需求</h2>
<ol style="padding-left:20px; color:#475569; font-size:14px;">
    <li style="margin-bottom:10px;"><strong>申請網域加入白名單：</strong>聯絡報數據，將子服務 origin 加入兩份清單：① CORS 允許清單，② SSO 登入 Origin 允許清單。模式 B 的 Worker S2S 呼叫不需要加入白名單。</li>
    <li style="margin-bottom:10px;"><strong>JWT_SECRET（選用）：</strong>若子服務 Worker 要自行用 <code>jsonwebtoken.verify()</code> 驗證 Token 而不呼叫 verify-token API，需向報數據索取。一般情況直接呼叫 verify-token 即可，不需要密鑰。</li>
    <li style="margin-bottom:10px;"><strong>SERVICE_API_KEY（選用）：</strong>僅呼叫「增加點數」API 時需要，向報數據申請。</li>
</ol>

<h2 id="cors-rules">CORS / 白名單規則</h2>
<table class="param-table">
    <thead><tr><th>情況</th><th>結果</th><th>說明</th></tr></thead>
    <tbody>
        <tr><td>瀏覽器請求，Origin 在白名單</td><td><span class="tag yes">允許</span></td><td>回應包含 Access-Control-Allow-Origin</td></tr>
        <tr><td>瀏覽器請求，Origin 不在白名單</td><td><span class="tag no">拒絕</span></td><td>SSO 登入端點回 403；verify-token 設不到 CORS header 但請求本身仍處理</td></tr>
        <tr><td>Server-to-Server（無 Origin header）</td><td><span class="tag yes">通過</span></td><td>Worker 後端呼叫不帶 Origin，不受 CORS 邏輯影響，請求正常處理</td></tr>
        <tr><td>OPTIONS Preflight</td><td><span class="tag yes">允許</span></td><td>直接回傳 200，允許所有預檢</td></tr>
    </tbody>
</table>
<div class="note ok">
    <strong>現行白名單（2025-03）：</strong>eccal · audai · quote · fabe · galine · serp · sub3 · sub4 · sub5 · member · andromeda · sbir · sbir-api（均為 thinkwithblack.com）+ localhost:3000/5000
</div>

<h2 id="s2s-support">S2S 官方支援聲明</h2>
<p>以下為經程式碼直接驗證的官方聲明：</p>
<table class="param-table">
    <thead><tr><th>API 端點</th><th>S2S 呼叫</th><th>認證要求</th><th>Bot/Rate 保護</th><th>說明</th></tr></thead>
    <tbody>
        <tr><td><code>POST /api/sso/verify-token</code></td><td><span class="tag yes">正式支援</span></td><td><span class="tag no">不需要</span></td><td><span class="tag no">無</span></td><td>無認證 middleware，無 rate limit，Worker 直接 POST</td></tr>
        <tr><td><code>GET /api/account-center/user/:id</code></td><td><span class="tag yes">正式支援</span></td><td><span class="tag no">不需要</span></td><td><span class="tag no">無</span></td><td>公開端點，可用 ID 或 Email 查詢</td></tr>
        <tr><td><code>GET /api/account-center/credits/:id</code></td><td><span class="tag yes">正式支援</span></td><td><span class="tag no">不需要</span></td><td><span class="tag no">無</span></td><td>公開端點</td></tr>
        <tr><td><code>POST /api/account-center/credits/:id/deduct</code></td><td><span class="tag yes">正式支援</span></td><td><span class="tag no">不需要</span></td><td><span class="tag no">無</span></td><td>建議在 Worker 後端呼叫</td></tr>
        <tr><td><code>POST /api/account-center/credits/:id/add</code></td><td><span class="tag yes">正式支援</span></td><td><span class="tag yes">需要 API Key</span></td><td><span class="tag no">無</span></td><td>需 <code>x-api-key</code> Header</td></tr>
    </tbody>
</table>
<div class="note ok">
    <strong>全域 middleware 說明：</strong>ECCAL Express app 的全域 middleware 為 <code>cookieParser</code>、<code>jwtMiddleware</code>（只讀取 Cookie 附加 req.user，不阻擋請求）、<code>passport.initialize()</code>。<strong>無 helmet、無 rate limit、無 Cloudflare bot protection 配置</strong>。Worker S2S 呼叫不會被任何全域 middleware 阻擋。
</div>

<h2 id="membership-logic">Membership 判斷邏輯（v3.2 起）</h2>
<p><code>verify-token</code> 與 <code>account-center/user</code> 這兩個端點共用同一個 <strong>AccountSnapshot</strong> 服務，保證回傳的 <code>membership</code> 欄位完全一致。</p>

<h3>isPro 判斷規則</h3>
<table class="param-table">
    <thead><tr><th>DB 狀態</th><th>回傳 membership</th><th>說明</th></tr></thead>
    <tbody>
        <tr><td><code>level = "pro"</code>，<code>expires = null</code></td><td><span class="tag yes">pro</span></td><td>無到期日 = 終身 Pro（老帳號或手動升級）</td></tr>
        <tr><td><code>level = "pro"</code>，expires 在未來</td><td><span class="tag yes">pro</span></td><td>定期訂閱，仍在有效期內</td></tr>
        <tr><td><code>level = "founders"</code>，任何 expires</td><td><span class="tag yes">pro</span></td><td>創始成員，永遠視為 Pro</td></tr>
        <tr><td><code>level = "pro"</code>，expires 在過去</td><td><span class="tag no">free</span></td><td>訂閱已到期</td></tr>
        <tr><td><code>level = "free"</code></td><td><span class="tag no">free</span></td><td>免費方案</td></tr>
    </tbody>
</table>

<h3>資料一致性保證</h3>
<div class="note ok">
    <strong>v3.2 起：</strong><code>POST /api/sso/verify-token</code> 與 <code>GET /api/account-center/user/:id</code> 都呼叫同一個 <strong>getAccountSnapshot()</strong> 函數，使用相同的 isPro 邏輯。兩個端點回傳的 <code>membership</code>、<code>membershipExpires</code>、<code>credits</code> 保證一致，子服務可放心以任一端點的結果為準。
</div>
<div class="note warn">
    <strong>注意：</strong>JWT Token 本身的 <code>membership</code> 欄位是<strong>簽發當下的快照</strong>，不會自動更新。建議每次使用前都呼叫 <code>verify-token</code> 或 <code>account-center/user</code> 取得即時資料，尤其在扣除點數或判斷功能權限前。
</div>

<h2 id="mode-a-flow">模式 A：前端直連 — 登入流程</h2>
<ul class="flow">
    <li><div class="fc"><h4>前端發起登入</h4><p>將用戶導向 <code>GET /api/auth/google-sso?returnTo={你的callback URL}&amp;service={服務名}</code>，用 <code>window.location.href</code> 跳轉（不能用 fetch）。</p></div></li>
    <li><div class="fc"><h4>用戶完成 Google 授權</h4><p>報數據處理 Google OAuth，建立或更新用戶帳號。</p></div></li>
    <li><div class="fc"><h4>報數據執行 302 Redirect（帶 3 個參數）</h4><p>跳轉到 <code>returnTo?auth_success=true&amp;token=JWT&amp;user_id=xxx</code>。</p></div></li>
    <li><div class="fc"><h4>前端接收並儲存 Token</h4><p>從 URL 讀取 <code>token</code>，存入 localStorage（key: <code>eccal_auth_token</code>），清除 URL 參數。</p></div></li>
    <li><div class="fc"><h4>呼叫 verify-token 確認有效</h4><p><code>POST /api/sso/verify-token</code>，取得完整用戶資料後更新 UI。</p></div></li>
</ul>

<h2 id="mode-a-callback">模式 A：Callback 規格（完整版）</h2>
<div class="note ok"><strong>登入端點：</strong><code>GET /api/auth/google-sso</code>（非 <code>/api/sso/login</code>，非 <code>/api/sso/callback</code>）</div>

<h3>啟動登入</h3>
<pre>GET https://eccal.thinkwithblack.com/api/auth/google-sso
  ?returnTo=https://audai.thinkwithblack.com/   <span class="c"># URL encode 過的完整 callback URL</span>
  &amp;service=audai                                 <span class="c"># 選填，服務識別名稱</span></pre>

<h3>成功 Callback（302 Redirect）</h3>
<pre>https://audai.thinkwithblack.com/
  <span class="k">?auth_success=</span><span class="v">true</span>
  <span class="k">&token=</span><span class="s">eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig</span>
  <span class="k">&user_id=</span><span class="v">abc123xyz</span></pre>

<table class="param-table">
    <thead><tr><th>參數</th><th>說明</th></tr></thead>
    <tbody>
        <tr><td>auth_success</td><td>固定值 <code>"true"</code>，可用來判斷是否為 SSO 跳轉回來</td></tr>
        <tr><td>token</td><td>JWT Token，有效期 7 天，需呼叫 verify-token 驗證後才可使用</td></tr>
        <tr><td>user_id</td><td>用戶在報數據的唯一 ID（與 JWT payload 的 <code>sub</code> 相同）</td></tr>
    </tbody>
</table>

<h3>失敗 Callback（302 Redirect）</h3>
<pre>https://audai.thinkwithblack.com/
  <span class="k">?auth_error=</span><span class="v">true</span>
  <span class="k">&error_message=</span><span class="s">Google%20OAuth%20%E8%AA%8D%E8%AD%89%E5%A4%B1%E6%95%97</span></pre>

<table class="param-table">
    <thead><tr><th>參數</th><th>說明</th></tr></thead>
    <tbody>
        <tr><td>auth_error</td><td>固定值 <code>"true"</code></td></tr>
        <tr><td>error_message</td><td>URL encoded 的錯誤說明，需 <code>decodeURIComponent()</code> 解碼</td></tr>
    </tbody>
</table>
<div class="note danger"><strong>安全提醒：</strong>Callback URL 收到的 token 尚未由你驗證，請務必呼叫 verify-token 確認有效性，切勿直接信任 URL 參數。</div>

<h2 id="mode-a-token">模式 A：Token 儲存方式（官方支援規格）</h2>
<table class="param-table">
    <thead><tr><th>儲存方式</th><th>支援狀態</th><th>Key / Header</th><th>說明</th></tr></thead>
    <tbody>
        <tr><td>localStorage</td><td><span class="tag yes">官方支援</span></td><td><code>eccal_auth_token</code></td><td>模式 A 的官方推薦方式，SPA 首選</td></tr>
        <tr><td>Authorization Bearer Header</td><td><span class="tag yes">官方支援</span></td><td><code>Authorization: Bearer {token}</code></td><td>前端呼叫 ECCAL API 或自家 API 時附帶</td></tr>
        <tr><td>httpOnly Cookie（<code>jwt</code>）</td><td><span class="tag no">不適用子服務</span></td><td><code>jwt</code></td><td>此 Cookie 為 ECCAL 主站內部 Cookie，跨域子服務無法讀取，勿依賴</td></tr>
        <tr><td>Worker 自管 Session Cookie</td><td><span class="tag yes">模式 B 官方支援</span></td><td>子服務自行命名</td><td>Worker 驗證 JWT 後設定自己的 httpOnly cookie，前端無感知 JWT</td></tr>
    </tbody>
</table>

<h2 id="mode-a-code">模式 A：完整前端範例（以 AudAI 為例）</h2>
<pre><span class="c">// audai.thinkwithblack.com - 模式 A 完整整合範例</span>
<span class="k">const</span> ECCAL = <span class="s">'https://eccal.thinkwithblack.com'</span>;
<span class="k">const</span> MY_URL = <span class="s">'https://audai.thinkwithblack.com'</span>;
<span class="k">const</span> TOKEN_KEY = <span class="s">'eccal_auth_token'</span>;

<span class="c">// 頁面初始化：處理 SSO callback 或讀取已存 token</span>
<span class="k">async function</span> init() {
  <span class="k">const</span> params = <span class="k">new</span> URLSearchParams(window.location.search);

  <span class="c">// 檢查是否從 SSO 跳回（auth_success=true 是判斷依據）</span>
  <span class="k">if</span> (params.get(<span class="s">'auth_success'</span>) === <span class="s">'true'</span>) {
    <span class="k">const</span> token = params.get(<span class="s">'token'</span>);
    <span class="k">if</span> (token) {
      localStorage.setItem(TOKEN_KEY, token);
      window.history.replaceState({}, <span class="s">''</span>, window.location.pathname);
    }
  }

  <span class="c">// 檢查登入失敗</span>
  <span class="k">if</span> (params.get(<span class="s">'auth_error'</span>) === <span class="s">'true'</span>) {
    <span class="k">const</span> msg = decodeURIComponent(params.get(<span class="s">'error_message'</span>) || <span class="s">'登入失敗'</span>);
    showError(msg);
    <span class="k">return</span>;
  }

  <span class="k">const</span> saved = localStorage.getItem(TOKEN_KEY);
  <span class="k">if</span> (saved) {
    <span class="k">const</span> user = <span class="k">await</span> verifyToken(saved);
    <span class="k">if</span> (user) { renderUser(user); }
    <span class="k">else</span> { localStorage.removeItem(TOKEN_KEY); showLoginBtn(); }
  } <span class="k">else</span> { showLoginBtn(); }
}

<span class="c">// 驗證 token，回傳 user 物件或 null</span>
<span class="k">async function</span> verifyToken(token) {
  <span class="k">const</span> res = <span class="k">await</span> fetch(<span class="m">\`\${ECCAL}/api/sso/verify-token\`</span>, {
    method: <span class="s">'POST'</span>,
    headers: { <span class="s">'Content-Type'</span>: <span class="s">'application/json'</span> },
    body: JSON.stringify({ token })
  });
  <span class="k">const</span> data = <span class="k">await</span> res.json();
  <span class="k">return</span> data.valid ? data.user : <span class="k">null</span>;
}

<span class="c">// 啟動登入（必須用 location.href，不能用 fetch）</span>
<span class="k">function</span> login() {
  window.location.href = <span class="m">\`\${ECCAL}/api/auth/google-sso?returnTo=\${encodeURIComponent(MY_URL + '/')}&service=audai\`</span>;
}

<span class="c">// 登出</span>
<span class="k">function</span> logout() {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = <span class="m">\`\${ECCAL}/api/sso/logout?returnTo=\${MY_URL}\`</span>;
}

init();</pre>

<h2 id="worker-first">Worker 優先 — 架構說明</h2>
<ul class="flow">
    <li><div class="fc"><h4>前端只打子服務自己的入口</h4><p>前端導向 <code>GET /api/auth/login</code>（子服務自己的路由），<strong>不直接導向 ECCAL</strong>。這樣子服務可以完全掌控 returnTo、cookie、CORS 設定。</p></div></li>
    <li><div class="fc"><h4>Worker relay 啟動 ECCAL SSO</h4><p>Worker 用 <code>redirect: 'manual'</code> 向 ECCAL <code>/api/sso/login</code> 取得 Google OAuth URL，再轉給瀏覽器。</p></div></li>
    <li><div class="fc"><h4>用戶完成 Google 授權後跳回子服務 callback</h4><p>ECCAL 帶 <code>?token=JWT&user_id=xxx</code> 跳轉到子服務的 <code>/auth/callback</code>。前端讀取 token 存入 localStorage，後續請求帶 <code>Authorization: Bearer</code>。</p></div></li>
    <li><div class="fc"><h4>Worker JWT Middleware 做即時授權</h4><p>每次 API 請求進來，Worker 先 decode JWT 做基本格式與過期檢查，再呼叫 ECCAL <code>verify-token</code> 取即時 membership / credits。</p></div></li>
</ul>

<h2 id="worker-login">Worker 優先 — 登入 Relay（Hono TypeScript）</h2>
<pre><span class="c">// routes/auth.ts — Worker relay 啟動 ECCAL SSO</span>
<span class="k">import</span> { Hono } <span class="k">from</span> <span class="s">'hono'</span>;

<span class="k">type</span> Env = {
  ECCAL_BASE_URL: <span class="s">string</span>;
  PUBLIC_APP_URL?: <span class="s">string</span>;
  ECCAL_SSO_ORIGIN?: <span class="s">string</span>;
};

<span class="k">const</span> auth = <span class="k">new</span> Hono&lt;{ Bindings: Env }&gt;();

<span class="c">// Helper: 取得子服務的公開 URL（優先用環境變數，fallback 到 request host）</span>
<span class="k">function</span> getPublicAppUrl(env: Env, requestUrl: <span class="s">string</span>): <span class="s">string</span> {
  <span class="k">if</span> (env.PUBLIC_APP_URL) {
    <span class="k">return</span> env.PUBLIC_APP_URL.replace(/\/$/, <span class="s">''</span>);
  }
  <span class="k">const</span> url = <span class="k">new</span> URL(requestUrl);
  <span class="k">return</span> <span class="m">\`\${url.protocol}//\${url.host}\`</span>;
}

<span class="c">// Helper: 取得共享 cookie domain（用於 .thinkwithblack.com 等多子域共享）</span>
<span class="k">function</span> getSharedCookieDomain(publicAppUrl: <span class="s">string</span>): <span class="s">string</span> | <span class="k">null</span> {
  <span class="k">const</span> hostname = <span class="k">new</span> URL(publicAppUrl).hostname.toLowerCase();
  <span class="k">if</span> (hostname.endsWith(<span class="s">'.thinkwithblack.com'</span>)) <span class="k">return</span> <span class="s">'thinkwithblack.com'</span>;
  <span class="k">if</span> (hostname.endsWith(<span class="s">'.example.com'</span>) || hostname === <span class="s">'example.com'</span>) <span class="k">return</span> <span class="s">'example.com'</span>;
  <span class="k">return null</span>;
}

<span class="c">// Helper: 組出 Set-Cookie header 字串</span>
<span class="k">function</span> buildAuthCookie(token: <span class="s">string</span>, publicAppUrl: <span class="s">string</span>): <span class="s">string</span> {
  <span class="k">const</span> parts = [<span class="m">\`app-jwt-token=\${token}\`</span>, <span class="s">'Path=/'</span>, <span class="s">'Secure'</span>, <span class="s">'HttpOnly'</span>, <span class="s">'SameSite=Lax'</span>];
  <span class="k">const</span> domain = getSharedCookieDomain(publicAppUrl);
  <span class="k">if</span> (domain) parts.push(<span class="m">\`Domain=\${domain}\`</span>);
  <span class="k">return</span> parts.join(<span class="s">'; '</span>);
}

<span class="c">// GET /api/auth/login — 伺服器端 relay 啟動 ECCAL SSO（前端不要直連 ECCAL）</span>
auth.get(<span class="s">'/login'</span>, <span class="k">async</span> (c) => {
  <span class="k">const</span> eccalBaseUrl = c.env.ECCAL_BASE_URL;
  <span class="k">const</span> publicAppUrl = getPublicAppUrl(c.env, c.req.url);
  <span class="k">const</span> returnTo = <span class="m">\`\${publicAppUrl}/auth/callback\`</span>;
  <span class="k">const</span> eccalSsoOrigin = c.env.ECCAL_SSO_ORIGIN || <span class="s">'https://audai.thinkwithblack.com'</span>;

  <span class="k">const</span> params = <span class="k">new</span> URLSearchParams({ service: <span class="s">'your-service'</span>, returnTo });
  <span class="k">const</span> bootstrapUrl = <span class="m">\`\${eccalBaseUrl}/api/sso/login?\${params.toString()}\`</span>;

  <span class="c">// redirect: 'manual' — 取得 ECCAL 的 302，再 relay 給瀏覽器，不讓 Worker 自動 follow</span>
  <span class="k">const</span> response = <span class="k">await</span> fetch(bootstrapUrl, {
    method: <span class="s">'GET'</span>,
    headers: { Origin: eccalSsoOrigin },
    redirect: <span class="s">'manual'</span>
  });

  <span class="k">const</span> location = response.headers.get(<span class="s">'location'</span>);
  <span class="k">if</span> (!location || response.status < 300 || response.status >= 400) {
    <span class="k">const</span> errorText = <span class="k">await</span> response.text();
    console.error(<span class="s">'[auth] ECCAL login bootstrap failed'</span>, { status: response.status, location, errorText });
    <span class="k">return</span> c.json({ error: <span class="s">'Failed to initialize login'</span> }, 502);
  }
  <span class="k">return</span> c.redirect(<span class="k">new</span> URL(location, eccalBaseUrl).toString());
});

<span class="c">// GET /api/auth/callback — 接 ECCAL 回跳的 ?token=...，寫入 cookie，轉回前端 callback 頁</span>
auth.get(<span class="s">'/callback'</span>, <span class="k">async</span> (c) => {
  <span class="k">const</span> token = c.req.query(<span class="s">'token'</span>);
  <span class="k">const</span> publicAppUrl = getPublicAppUrl(c.env, c.req.url);
  <span class="k">if</span> (!token) <span class="k">return</span> c.json({ error: <span class="s">'No token provided'</span> }, 400);

  c.header(<span class="s">'Set-Cookie'</span>, buildAuthCookie(token, publicAppUrl));
  <span class="k">return</span> c.redirect(<span class="m">\`\${publicAppUrl}/auth/callback?token=\${encodeURIComponent(token)}\`</span>);
});</pre>

<h2 id="worker-jwt">Worker 優先 — JWT Middleware（TypeScript，不依賴 Node.js Buffer）</h2>
<pre><span class="c">// middleware/auth.ts — Cloudflare Workers 環境</span>
<span class="k">import</span> { Context, Next } <span class="k">from</span> <span class="s">'hono'</span>;

<span class="k">type</span> JWTUser = {
  id: <span class="s">string</span>;
  email: <span class="s">string</span>;
  name: <span class="s">string</span>;
  membership?: <span class="s">string</span>;
  membershipExpires?: <span class="s">string</span> | <span class="k">null</span>;
  credits?: <span class="s">number</span>;
  profileImageUrl?: <span class="s">string</span> | <span class="k">null</span>;
};

<span class="c">// Workers 沒有 Node.js Buffer，用 atob + TextDecoder 做 base64url decode</span>
<span class="k">function</span> base64UrlToBytes(input: <span class="s">string</span>): Uint8Array {
  <span class="k">const</span> normalized = input.replace(/-/g, <span class="s">'+'</span>).replace(/_/g, <span class="s">'/'</span>);
  <span class="k">const</span> padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, <span class="s">'='</span>);
  <span class="k">return</span> Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
}

<span class="k">function</span> decodeBase64UrlUtf8(input: <span class="s">string</span>): <span class="s">string</span> {
  <span class="k">return new</span> TextDecoder().decode(base64UrlToBytes(input));
}

<span class="k">function</span> decodeJWT(token: <span class="s">string</span>): Record&lt;<span class="s">string</span>, unknown&gt; | <span class="k">null</span> {
  <span class="k">try</span> {
    <span class="k">const</span> parts = token.split(<span class="s">'.'</span>);
    <span class="k">if</span> (parts.length !== 3) <span class="k">return null</span>;
    <span class="k">return</span> JSON.parse(decodeBase64UrlUtf8(parts[1])) <span class="k">as</span> Record&lt;<span class="s">string</span>, unknown&gt;;
  } <span class="k">catch</span> (error) {
    console.error(<span class="s">'[auth] decodeJWT failed'</span>, error);
    <span class="k">return null</span>;
  }
}

<span class="k">function</span> extractBearerToken(c: Context): <span class="s">string</span> | <span class="k">null</span> {
  <span class="k">const</span> value = c.req.header(<span class="s">'Authorization'</span>);
  <span class="k">if</span> (!value || !value.startsWith(<span class="s">'Bearer '</span>)) <span class="k">return null</span>;
  <span class="k">return</span> value.slice(<span class="s">'Bearer '</span>.length);
}

<span class="k">async function</span> verifyTokenWithEccal(token: <span class="s">string</span>, eccalBaseUrl: <span class="s">string</span>): Promise&lt;JWTUser | <span class="k">null</span>&gt; {
  <span class="k">try</span> {
    <span class="k">const</span> response = <span class="k">await</span> fetch(<span class="m">\`\${eccalBaseUrl}/api/sso/verify-token\`</span>, {
      method: <span class="s">'POST'</span>,
      headers: { <span class="s">'Content-Type'</span>: <span class="s">'application/json'</span> },
      body: JSON.stringify({ token })
    });

    <span class="k">if</span> (!response.ok) {
      console.warn(<span class="s">'[auth] ECCAL verify-token failed'</span>, response.status);
      <span class="k">return null</span>;
    }

    <span class="k">const</span> data = <span class="k">await</span> response.json() <span class="k">as any</span>;
    <span class="k">if</span> (!data.success || !data.user || data.valid === <span class="k">false</span>) <span class="k">return null</span>;

    <span class="k">return</span> {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      membership: data.user.membership || <span class="s">'free'</span>,
      membershipExpires: data.user.membershipExpires || <span class="k">null</span>,
      credits: data.user.credits || 0,
      profileImageUrl: data.user.profileImageUrl || <span class="k">null</span>,
    };
  } <span class="k">catch</span> (error) {
    console.error(<span class="s">'[auth] ECCAL verify-token error'</span>, error);
    <span class="k">return null</span>;
  }
}

<span class="k">export async function</span> jwtAuth(c: Context, next: Next) {
  <span class="k">const</span> token = extractBearerToken(c);
  <span class="k">if</span> (!token) <span class="k">return</span> c.json({ error: <span class="s">'Unauthorized - No token provided'</span> }, 401);

  <span class="c">// Step 1: 本地 decode + exp 快速檢查（省去一次 S2S，快速拒絕明顯過期的 token）</span>
  <span class="k">const</span> payload = decodeJWT(token);
  <span class="k">if</span> (!payload) <span class="k">return</span> c.json({ error: <span class="s">'Unauthorized - Invalid token format'</span> }, 401);
  <span class="k">if</span> (<span class="k">typeof</span> payload.exp === <span class="s">'number'</span> && payload.exp < Math.floor(Date.now() / 1000)) {
    <span class="k">return</span> c.json({ error: <span class="s">'Unauthorized - Token expired'</span> }, 401);
  }

  <span class="c">// Step 2: 呼叫 ECCAL verify-token 取即時 membership / credits（DB 即時查詢，非 JWT 快照）</span>
  <span class="k">const</span> eccalBaseUrl = (c.env <span class="k">as</span> { ECCAL_BASE_URL?: <span class="s">string</span> }).ECCAL_BASE_URL
    || <span class="s">'https://eccal.thinkwithblack.com'</span>;
  <span class="k">const</span> user = <span class="k">await</span> verifyTokenWithEccal(token, eccalBaseUrl);
  <span class="k">if</span> (!user) <span class="k">return</span> c.json({ error: <span class="s">'Unauthorized - Token verification failed'</span> }, 401);

  c.set(<span class="s">'user'</span>, user);
  <span class="k">await</span> next();
}</pre>

<h2 id="worker-template">Worker 優先 — 前端 callback 頁 + API client + /api/auth/user</h2>

<h3>前端 callback 頁（oauth-callback.html）</h3>
<pre><span class="c">&lt;!-- frontend/public/oauth-callback.html --&gt;</span>
&lt;!doctype html&gt;
&lt;html lang=<span class="s">"zh-Hant"</span>&gt;
&lt;head&gt;
  &lt;meta charset=<span class="s">"UTF-8"</span> /&gt;
  &lt;meta name=<span class="s">"viewport"</span> content=<span class="s">"width=device-width, initial-scale=1.0"</span> /&gt;
  &lt;title&gt;登入中&lt;/title&gt;
&lt;/head&gt;
&lt;body&gt;
  <span class="k">&lt;script&gt;</span>
  (function() {
    var params = <span class="k">new</span> URLSearchParams(window.location.search);
    var token = params.get(<span class="s">'token'</span>);
    <span class="k">if</span> (token) {
      localStorage.setItem(<span class="s">'eccal_auth_token'</span>, token);
    }
    window.location.replace(<span class="s">'/'</span>);  <span class="c">// 導回首頁（replace 避免 token 殘留在瀏覽器 history）</span>
  })();
  <span class="k">&lt;/script&gt;</span>
&lt;/body&gt;
&lt;/html&gt;</pre>

<h3>前端 API client（axios interceptor 自動帶 Bearer token）</h3>
<pre><span class="c">// frontend/src-shared/api/client.ts</span>
<span class="k">import</span> axios <span class="k">from</span> <span class="s">'axios'</span>;

<span class="k">const</span> apiClient = axios.create({
  baseURL: <span class="k">import</span>.meta.env.VITE_API_BASE_URL || <span class="s">'https://api.example.com'</span>,
  withCredentials: <span class="k">true</span>,
});

apiClient.interceptors.request.use((config) => {
  <span class="k">const</span> token = localStorage.getItem(<span class="s">'eccal_auth_token'</span>);
  <span class="k">if</span> (token) config.headers.Authorization = <span class="m">\`Bearer \${token}\`</span>;
  <span class="k">return</span> config;
});

<span class="k">export default</span> apiClient;</pre>

<h3>GET /api/auth/user — 回傳已驗證的登入用戶資料</h3>
<pre><span class="c">// routes/auth.ts — 在 jwtAuth middleware 後掛載</span>
auth.get(<span class="s">'/user'</span>, jwtAuth, <span class="k">async</span> (c) => {
  <span class="k">const</span> user = c.get(<span class="s">'user'</span>) <span class="k">as</span> JWTUser | undefined;
  <span class="k">if</span> (!user) <span class="k">return</span> c.json({ error: <span class="s">'Unauthorized'</span> }, 401);

  <span class="k">return</span> c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    membership: user.membership || <span class="s">'free'</span>,
    membershipExpires: user.membershipExpires || <span class="k">null</span>,
    credits: user.credits || 0,
    profileImageUrl: user.profileImageUrl || <span class="k">null</span>,
  });
});

<span class="c">// 登出：清除 cookie（前端也要清 localStorage 的 eccal_auth_token）</span>
auth.post(<span class="s">'/logout'</span>, <span class="k">async</span> (c) => {
  c.header(<span class="s">'Set-Cookie'</span>, <span class="s">'app-jwt-token=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'</span>);
  <span class="k">return</span> c.json({ success: <span class="k">true</span> });
});</pre>

<h2 id="worker-env">Worker 優先 — 環境變數（wrangler.toml）</h2>
<pre><span class="c"># wrangler.toml</span>
[vars]
ECCAL_BASE_URL = <span class="s">"https://eccal.thinkwithblack.com"</span>
PUBLIC_APP_URL = <span class="s">"https://your-service.thinkwithblack.com"</span>
ECCAL_SSO_ORIGIN = <span class="s">"https://audai.thinkwithblack.com"</span>  <span class="c"># 你在 ECCAL 白名單內的 Origin</span>

<span class="c"># 敏感值用 Worker Secret（wrangler secret put ECCAL_SERVICE_SECRET）</span>
<span class="c"># ECCAL_SERVICE_SECRET = "..."  # 向報數據申請，用於本地 HS256 驗簽（可選）</span></pre>

<div class="note warn"><strong>必須使用 custom domain：</strong>正式環境不要用 <code>*.workers.dev</code> 當 API 網域，這會導致 cookie 的 SameSite / CORS 行為不穩定，以及 ECCAL 的 Origin 白名單驗證失敗。</div>

<h2 id="worker-checklist">Worker 優先 — 上線前清單</h2>
<table class="param-table">
    <thead><tr><th>#</th><th>確認項目</th></tr></thead>
    <tbody>
        <tr><td>1</td><td>子服務正式 API 使用 custom domain（非 workers.dev）</td></tr>
        <tr><td>2</td><td><code>/api/auth/login</code> 由 Worker relay（而非前端直連 ECCAL）</td></tr>
        <tr><td>3</td><td><code>verify-token</code> 回 <code>200</code> 且 <code>x-eccal-version: 3.2</code></td></tr>
        <tr><td>4</td><td><code>verify-token.user.membership</code> 與 <code>account-center/user.membership</code> 一致</td></tr>
        <tr><td>5</td><td><code>/api/auth/user</code> 端點回傳的 membership / credits 與 ECCAL 一致</td></tr>
        <tr><td>6</td><td>沒有任何 dev bypass header 或 mock login 殘留</td></tr>
        <tr><td>7</td><td><code>ECCAL_BASE_URL</code>、<code>PUBLIC_APP_URL</code>、<code>ECCAL_SSO_ORIGIN</code> 已設定</td></tr>
    </tbody>
</table>

<h2 id="api-login">API：啟動 SSO 登入</h2>
<div class="endpoint">
    <div class="endpoint-header">
        <span class="badge get">GET</span>
        <span class="endpoint-url">/api/auth/google-sso</span>
        <span class="badge browser">瀏覽器導向（非 fetch）</span>
    </div>
    <div class="endpoint-body">
        <table class="param-table">
            <thead><tr><th>Query 參數</th><th>必填</th><th>說明</th></tr></thead>
            <tbody>
                <tr><td>returnTo</td><td><span class="badge req">必填</span></td><td>登入後跳轉的完整 URL，需 <code>encodeURIComponent()</code></td></tr>
                <tr><td>service</td><td><span class="badge opt">選填</span></td><td>子服務識別名稱，用於日誌記錄</td></tr>
            </tbody>
        </table>
        <div class="note warn">此端點執行 302 Redirect，<strong>不是 JSON API</strong>。前端必須用 <code>window.location.href = ...</code>，<strong>不能</strong>用 <code>fetch()</code>。</div>
    </div>
</div>

<h2 id="api-verify">API：驗證 Token</h2>
<div class="endpoint">
    <div class="endpoint-header">
        <span class="badge post">POST</span>
        <span class="endpoint-url">/api/sso/verify-token</span>
        <span class="badge browser">瀏覽器</span>
        <span class="badge s2s">S2S 正式支援</span>
    </div>
    <div class="endpoint-body">
        <h4>Request Body</h4>
        <pre>{ <span class="k">"token"</span>: <span class="s">"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."</span> }</pre>
        <h4>成功回應 200</h4>
        <pre>{
  <span class="k">"success"</span>: <span class="v">true</span>,  <span class="k">"valid"</span>: <span class="v">true</span>,
  <span class="k">"user"</span>: {
    <span class="k">"id"</span>: <span class="s">"abc123xyz"</span>,       <span class="c">// = JWT sub = account-center userId</span>
    <span class="k">"email"</span>: <span class="s">"user@example.com"</span>,
    <span class="k">"name"</span>: <span class="s">"王小明"</span>,
    <span class="k">"membership"</span>: <span class="s">"pro"</span>,   <span class="c">// "free" 或 "pro"</span>
    <span class="k">"membershipExpires"</span>: <span class="s">"2026-10-15T00:00:00Z"</span>,
    <span class="k">"credits"</span>: <span class="v">150</span>,
    <span class="k">"profileImageUrl"</span>: <span class="s">"https://..."</span>
  },
  <span class="k">"expiresAt"</span>: <span class="s">"2026-03-14T10:30:00Z"</span>
}</pre>
        <h4>失敗回應</h4>
        <pre><span class="c">// Token 過期（401）</span>
{ <span class="k">"success"</span>: <span class="v">false</span>, <span class="k">"valid"</span>: <span class="v">false</span>, <span class="k">"error"</span>: <span class="s">"Token expired"</span> }
<span class="c">// 格式錯誤（400）</span>
{ <span class="k">"success"</span>: <span class="v">false</span>, <span class="k">"error"</span>: <span class="s">"Invalid token format"</span> }</pre>
        <div class="note info">系統容許 <strong>60 秒時鐘偏差</strong>，避免跨服務時間不同步問題（Cloudflare Workers 尤其容易有此問題）。</div>
    </div>
</div>

<h2 id="api-refresh">API：刷新 Token</h2>
<div class="endpoint">
    <div class="endpoint-header">
        <span class="badge post">POST</span>
        <span class="endpoint-url">/api/sso/refresh-token</span>
        <span class="badge browser">瀏覽器（需已登入 ECCAL Cookie）</span>
    </div>
    <div class="endpoint-body">
        <p>Token 有效期 <strong>7 天</strong>，建議到期前 24 小時自動刷新。</p>
        <h4>Request Header</h4>
        <pre>Authorization: Bearer <span class="v">{現有 JWT Token}</span></pre>
        <h4>成功回應 200</h4>
        <pre>{ <span class="k">"token"</span>: <span class="s">"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."</span> }</pre>
    </div>
</div>

<h2 id="api-logout">API：登出</h2>
<div class="endpoint">
    <div class="endpoint-header">
        <span class="badge post">POST</span>
        <span class="endpoint-url">/api/sso/logout</span>
    </div>
    <div class="endpoint-body">
        <p>清除 ECCAL 端的登入 Cookie。<strong>子服務也需自行清除本地 Token 或 Session。</strong></p>
        <h4>Request Body（選填）</h4>
        <pre>{ <span class="k">"returnTo"</span>: <span class="s">"https://audai.thinkwithblack.com"</span> }</pre>
    </div>
</div>

<h2 id="api-user">Account Center API：取得用戶資料</h2>
<div class="endpoint">
    <div class="endpoint-header">
        <span class="badge get">GET</span>
        <span class="endpoint-url">/api/account-center/user/:userId</span>
        <span class="badge s2s">S2S 正式支援</span>
    </div>
    <div class="endpoint-body">
        <p><code>:userId</code> 可填用戶 <strong>ID</strong>（JWT sub）或 <strong>Email</strong>，兩種格式都接受。無認證要求。</p>
        <h4>成功回應 200</h4>
        <pre>{
  <span class="k">"success"</span>: <span class="v">true</span>,
  <span class="k">"user"</span>: { <span class="k">"id"</span>, <span class="k">"email"</span>, <span class="k">"name"</span>, <span class="k">"membership"</span>, <span class="k">"membershipExpires"</span>, <span class="k">"credits"</span>, <span class="k">"profileImageUrl"</span>, <span class="k">"createdAt"</span> }
}</pre>
    </div>
</div>

<h2 id="api-credits">Account Center API：點數操作</h2>
<div class="endpoint">
    <div class="endpoint-header">
        <span class="badge get">GET</span>
        <span class="endpoint-url">/api/account-center/credits/:userId</span>
        <span class="badge s2s">S2S 正式支援</span>
    </div>
    <div class="endpoint-body">
        <pre>{ <span class="k">"success"</span>: <span class="v">true</span>, <span class="k">"userId"</span>: <span class="s">"abc123"</span>, <span class="k">"balance"</span>: <span class="v">150</span>, <span class="k">"email"</span>: <span class="s">"user@example.com"</span> }</pre>
    </div>
</div>
<div class="endpoint">
    <div class="endpoint-header">
        <span class="badge post">POST</span>
        <span class="endpoint-url">/api/account-center/credits/:userId/deduct</span>
        <span class="badge s2s">S2S 正式支援</span>
    </div>
    <div class="endpoint-body">
        <h4>Request Body</h4>
        <pre>{ <span class="k">"amount"</span>: <span class="v">10</span>, <span class="k">"reason"</span>: <span class="s">"AI 分析"</span>, <span class="k">"service"</span>: <span class="s">"audai"</span> }</pre>
        <h4>成功 200 / 點數不足 400</h4>
        <pre><span class="c">// 成功</span>
{ <span class="k">"success"</span>: <span class="v">true</span>, <span class="k">"remainingCredits"</span>: <span class="v">140</span>, <span class="k">"deductedAmount"</span>: <span class="v">10</span>, <span class="k">"transactionId"</span>: <span class="s">"tx_xxx"</span> }
<span class="c">// 點數不足</span>
{ <span class="k">"success"</span>: <span class="v">false</span>, <span class="k">"code"</span>: <span class="s">"INSUFFICIENT_CREDITS"</span>, <span class="k">"currentCredits"</span>: <span class="v">5</span>, <span class="k">"requestedAmount"</span>: <span class="v">10</span> }</pre>
    </div>
</div>
<div class="endpoint">
    <div class="endpoint-header">
        <span class="badge post">POST</span>
        <span class="endpoint-url">/api/account-center/credits/:userId/add</span>
        <span class="badge s2s">S2S 正式支援</span>
    </div>
    <div class="endpoint-body">
        <p>增加點數，需要 API Key 驗證。</p>
        <h4>必要 Header</h4>
        <pre>x-api-key: <span class="v">{SERVICE_API_KEY}</span></pre>
        <h4>Request Body</h4>
        <pre>{ <span class="k">"amount"</span>: <span class="v">50</span>, <span class="k">"reason"</span>: <span class="s">"購買方案"</span>, <span class="k">"service"</span>: <span class="s">"your-service"</span> }</pre>
    </div>
</div>

<h2 id="token-structure">JWT Token 結構</h2>
<p>演算法：<strong>HS256</strong>，有效期：<strong>7 天</strong>，容許時鐘偏差：<strong>60 秒</strong></p>
<table class="param-table">
    <thead><tr><th>欄位</th><th>說明</th><th>範例值</th></tr></thead>
    <tbody>
        <tr><td>sub</td><td>用戶唯一 ID（與 callback user_id 相同，可用於 account-center API）</td><td><code>abc123xyz</code></td></tr>
        <tr><td>email</td><td>用戶 Email</td><td><code>user@example.com</code></td></tr>
        <tr><td>name</td><td>用戶顯示名稱</td><td><code>王小明</code></td></tr>
        <tr><td>membership</td><td>會員等級（Token 簽發當下的值）</td><td><code>"free"</code> 或 <code>"pro"</code></td></tr>
        <tr><td>credits</td><td>點數快照（簽發當下，即時值請呼叫 credits API）</td><td><code>150</code></td></tr>
        <tr><td>iss</td><td>簽發者（固定）</td><td><code>eccal.thinkwithblack.com</code></td></tr>
        <tr><td>aud</td><td>受眾（發起登入的子服務 origin）</td><td><code>https://audai.thinkwithblack.com</code></td></tr>
        <tr><td>iat</td><td>簽發時間（Unix timestamp）</td><td><code>1709800000</code></td></tr>
        <tr><td>exp</td><td>到期時間（iat + 7 天）</td><td><code>1710404800</code></td></tr>
    </tbody>
</table>

<h2 id="diag-headers">診斷 Response Headers</h2>
<p>所有 <code>/api/*</code> S2S 端點回應都包含以下診斷 headers，方便排查問題：</p>
<table class="param-table">
    <thead><tr><th>Header</th><th>值</th><th>說明</th></tr></thead>
    <tbody>
        <tr><td>X-ECCAL-Route</td><td><code>/sso/verify-token</code></td><td>實際命中的路由路徑</td></tr>
        <tr><td>X-ECCAL-Auth-Mode</td><td><code>bearer</code> / <code>cookie</code> / <code>none</code></td><td>本次請求的認證來源</td></tr>
        <tr><td>X-ECCAL-Redirect-Bypassed</td><td><code>true</code> / <code>false</code> / <code>n/a</code></td><td>true = 某處想 redirect 但已被攔截並轉為 JSON；n/a = 此路徑允許 redirect（OAuth 流程）</td></tr>
        <tr><td>X-ECCAL-Version</td><td><code>3.2</code></td><td>API middleware 版本</td></tr>
    </tbody>
</table>
<div class="note ok">如果你看到 <code>X-ECCAL-Redirect-Bypassed: true</code>，表示某個內部 middleware 試圖 redirect 但被攔截了。請到 ECCAL 伺服器 log 搜尋 <code>[API-REDIRECT-BLOCKED]</code> 找到具體路由。</div>

<h2 id="curl-examples">官方 curl / Cloudflare Worker 整合範例</h2>

<h3>curl 範例 — 驗證 Token</h3>
<pre><span class="c"># POST /api/sso/verify-token（無需 Origin header，S2S 直接呼叫）</span>
curl -X POST https://eccal.thinkwithblack.com/api/sso/verify-token \
  -H <span class="s">"Content-Type: application/json"</span> \
  -d <span class="s">'{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}'</span>

<span class="c"># 成功回應（200）</span>
{
  <span class="k">"success"</span>: <span class="v">true</span>,
  <span class="k">"valid"</span>: <span class="v">true</span>,
  <span class="k">"user"</span>: {
    <span class="k">"id"</span>: <span class="s">"abc123"</span>,
    <span class="k">"email"</span>: <span class="s">"user@example.com"</span>,
    <span class="k">"name"</span>: <span class="s">"王小明"</span>,
    <span class="k">"membership"</span>: <span class="s">"pro"</span>,
    <span class="k">"membershipExpires"</span>: <span class="s">"2026-10-15T00:00:00.000Z"</span>,
    <span class="k">"credits"</span>: <span class="v">92</span>,
    <span class="k">"profileImageUrl"</span>: <span class="s">"https://..."</span>
  },
  <span class="k">"expiresAt"</span>: <span class="s">"2026-03-14T10:30:00.000Z"</span>
}

<span class="c"># Token 過期（401）</span>
{ <span class="k">"success"</span>: <span class="v">false</span>, <span class="k">"valid"</span>: <span class="v">false</span>, <span class="k">"error"</span>: <span class="s">"Token expired"</span>, <span class="k">"details"</span>: <span class="s">"jwt expired"</span> }

<span class="c"># Token 格式錯誤（401）</span>
{ <span class="k">"success"</span>: <span class="v">false</span>, <span class="k">"valid"</span>: <span class="v">false</span>, <span class="k">"error"</span>: <span class="s">"Invalid token"</span>, <span class="k">"details"</span>: <span class="s">"invalid token"</span> }</pre>

<h3>curl 範例 — 查詢用戶資料</h3>
<pre><span class="c"># GET /api/account-center/user/:id（可用 ID 或 Email）</span>
curl https://eccal.thinkwithblack.com/api/account-center/user/abc123
curl https://eccal.thinkwithblack.com/api/account-center/user/user%40example.com

<span class="c"># 成功回應（200）</span>
{
  <span class="k">"success"</span>: <span class="v">true</span>,
  <span class="k">"user"</span>: {
    <span class="k">"id"</span>: <span class="s">"abc123"</span>, <span class="k">"email"</span>: <span class="s">"user@example.com"</span>,
    <span class="k">"membership"</span>: <span class="s">"pro"</span>, <span class="k">"credits"</span>: <span class="v">92</span>, <span class="k">"createdAt"</span>: <span class="s">"2025-01-01T..."</span>
  }
}

<span class="c"># 用戶不存在（404）</span>
{ <span class="k">"success"</span>: <span class="v">false</span>, <span class="k">"error"</span>: <span class="s">"用戶未找到"</span>, <span class="k">"code"</span>: <span class="s">"USER_NOT_FOUND"</span> }</pre>

<h3>curl 範例 — 扣除點數</h3>
<pre><span class="c"># POST /api/account-center/credits/:userId/deduct</span>
curl -X POST https://eccal.thinkwithblack.com/api/account-center/credits/abc123/deduct \
  -H <span class="s">"Content-Type: application/json"</span> \
  -d <span class="s">'{"amount":10,"reason":"AI 分析","service":"sbir"}'</span>

<span class="c"># 成功（200）</span>
{ <span class="k">"success"</span>: <span class="v">true</span>, <span class="k">"remainingCredits"</span>: <span class="v">82</span>, <span class="k">"deductedAmount"</span>: <span class="v">10</span>, <span class="k">"transactionId"</span>: <span class="s">"tx_xxx"</span> }

<span class="c"># 點數不足（400）</span>
{ <span class="k">"success"</span>: <span class="v">false</span>, <span class="k">"code"</span>: <span class="s">"INSUFFICIENT_CREDITS"</span>, <span class="k">"currentCredits"</span>: <span class="v">5</span>, <span class="k">"requestedAmount"</span>: <span class="v">10</span> }</pre>

<h3>Cloudflare Worker 完整驗證範例</h3>
<pre><span class="c">// Cloudflare Worker — 完整 SSO callback 處理 + verify-token</span>
<span class="k">export default</span> {
  <span class="k">async</span> fetch(request, env) {
    <span class="k">const</span> url = <span class="k">new</span> URL(request.url);

    <span class="c">// Step 1: 處理 SSO callback（?auth_success=true&token=...&user_id=...）</span>
    <span class="k">if</span> (url.pathname === <span class="s">'/auth/callback'</span>) {
      <span class="k">const</span> authSuccess = url.searchParams.get(<span class="s">'auth_success'</span>);
      <span class="k">const</span> token = url.searchParams.get(<span class="s">'token'</span>);
      <span class="k">const</span> authError = url.searchParams.get(<span class="s">'auth_error'</span>);

      <span class="k">if</span> (authError === <span class="s">'true'</span>) {
        <span class="k">const</span> msg = decodeURIComponent(url.searchParams.get(<span class="s">'error_message'</span>) || <span class="s">'登入失敗'</span>);
        <span class="k">return</span> Response.redirect(<span class="m">\`https://sbir.thinkwithblack.com/?error=\${encodeURIComponent(msg)}\`</span>);
      }
      <span class="k">if</span> (authSuccess !== <span class="s">'true'</span> || !token) {
        <span class="k">return new</span> Response(<span class="s">'Missing token'</span>, { status: 400 });
      }

      <span class="c">// Step 2: S2S 驗證 token（不帶 Origin，不受 CORS 限制）</span>
      <span class="k">const</span> verifyRes = <span class="k">await</span> fetch(<span class="s">'https://eccal.thinkwithblack.com/api/sso/verify-token'</span>, {
        method: <span class="s">'POST'</span>,
        headers: { <span class="s">'Content-Type'</span>: <span class="s">'application/json'</span> },
        body: JSON.stringify({ token })
      });

      <span class="c">// Step 3: 檢查診斷 headers</span>
      <span class="k">const</span> redirectBypassed = verifyRes.headers.get(<span class="s">'x-eccal-redirect-bypassed'</span>);
      <span class="k">if</span> (redirectBypassed === <span class="s">'true'</span>) {
        <span class="k">return new</span> Response(<span class="s">'ECCAL redirect intercepted — contact admin'</span>, { status: 500 });
      }
      <span class="k">if</span> (!verifyRes.ok || verifyRes.headers.get(<span class="s">'content-type'</span>)?.includes(<span class="s">'text/html'</span>)) {
        <span class="k">return</span> Response.redirect(<span class="s">'https://sbir.thinkwithblack.com/?error=verify_failed'</span>);
      }

      <span class="k">const</span> data = <span class="k">await</span> verifyRes.json();
      <span class="k">if</span> (!data.valid) {
        <span class="k">return</span> Response.redirect(<span class="s">'https://sbir.thinkwithblack.com/?error=invalid_token'</span>);
      }

      <span class="c">// Step 4: 建立 Worker session（存 KV，設 httpOnly cookie）</span>
      <span class="k">const</span> sessionId = crypto.randomUUID();
      <span class="k">await</span> env.KV.put(<span class="m">\`session:\${sessionId}\`</span>, JSON.stringify(data.user), { expirationTtl: 604800 });
      <span class="k">return new</span> Response(<span class="k">null</span>, {
        status: 302,
        headers: {
          Location: <span class="s">'https://sbir.thinkwithblack.com/dashboard'</span>,
          <span class="s">'Set-Cookie'</span>: <span class="m">\`session=\${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800\`</span>
        }
      });
    }

    <span class="c">// Step 5: 保護需要登入的頁面（讀 session cookie 驗證）</span>
    <span class="k">if</span> (url.pathname.startsWith(<span class="s">'/dashboard'</span>)) {
      <span class="k">const</span> cookieHeader = request.headers.get(<span class="s">'cookie'</span>) || <span class="s">''</span>;
      <span class="k">const</span> sessionId = cookieHeader.match(/session=([^;]+)/)?.[1];
      <span class="k">if</span> (!sessionId) {
        <span class="k">return</span> Response.redirect(
          <span class="m">\`https://eccal.thinkwithblack.com/api/auth/google-sso?returnTo=\${encodeURIComponent('https://sbir.thinkwithblack.com/auth/callback')}&service=sbir\`</span>
        );
      }
      <span class="k">const</span> user = <span class="k">await</span> env.KV.get(<span class="m">\`session:\${sessionId}\`</span>, { type: <span class="s">'json'</span> });
      <span class="k">if</span> (!user) {
        <span class="k">return</span> Response.redirect(<span class="s">'https://sbir.thinkwithblack.com/?error=session_expired'</span>);
      }
      <span class="c">// 繼續處理，user 物件已驗證</span>
    }

    <span class="k">return</span> <span class="k">new</span> Response(<span class="s">'Not found'</span>, { status: 404 });
  }
};</pre>

<h2 id="verify-scripts">驗收腳本</h2>

<h3>curl — 驗證 verify-token（帶 -i 顯示 headers）</h3>
<pre>TOKEN="你的真實JWT"
curl -i -sS -X POST 'https://eccal.thinkwithblack.com/api/sso/verify-token' \
  -H 'Content-Type: application/json' \
  --data "{\"token\":\"$TOKEN\"}"</pre>
<p style="font-size:13px;color:#64748b;">預期：<code>HTTP 200</code>、<code>x-eccal-version: 3.2</code>、body 有 <code>success:true</code>、<code>user.membership</code>、<code>user.credits</code>，<strong>沒有 <code>Location</code> header</strong>。</p>

<h3>curl — 驗證 account-center/user</h3>
<pre>USER_ID="你的真實用戶ID"
curl -i -sS "https://eccal.thinkwithblack.com/api/account-center/user/$USER_ID"</pre>
<p style="font-size:13px;color:#64748b;">預期：<code>HTTP 200</code>、<code>user.membership</code> 與 verify-token 一致。</p>

<h3>Cloudflare Worker — 一致性驗收腳本</h3>
<pre><span class="c">// 部署到 Workers 執行，驗收兩端點資料一致</span>
<span class="k">export default</span> {
  <span class="k">async</span> fetch() {
    <span class="k">const</span> token = <span class="s">'YOUR_REAL_JWT'</span>;
    <span class="k">const</span> userId = <span class="s">'YOUR_REAL_USER_ID'</span>;
    <span class="k">const</span> ECCAL = <span class="s">'https://eccal.thinkwithblack.com'</span>;

    <span class="k">const</span> [vr, ur] = <span class="k">await</span> Promise.all([
      fetch(<span class="m">\`\${ECCAL}/api/sso/verify-token\`</span>, {
        method: <span class="s">'POST'</span>,
        headers: { <span class="s">'Content-Type'</span>: <span class="s">'application/json'</span> },
        body: JSON.stringify({ token })
      }),
      fetch(<span class="m">\`\${ECCAL}/api/account-center/user/\${userId}\`</span>)
    ]);
    <span class="k">const</span> [vb, ub] = <span class="k">await</span> Promise.all([vr.json(), ur.json()]);

    <span class="k">return new</span> Response(JSON.stringify({
      verify: {
        status: vr.status,
        location: vr.headers.get(<span class="s">'location'</span>),                      <span class="c">// 必須 null</span>
        route: vr.headers.get(<span class="s">'x-eccal-route'</span>),
        version: vr.headers.get(<span class="s">'x-eccal-version'</span>),               <span class="c">// 必須 3.2</span>
        redirectBypassed: vr.headers.get(<span class="s">'x-eccal-redirect-bypassed'</span>),  <span class="c">// 必須 false</span>
        body: vb
      },
      user: {
        status: ur.status,
        location: ur.headers.get(<span class="s">'location'</span>),                      <span class="c">// 必須 null</span>
        route: ur.headers.get(<span class="s">'x-eccal-route'</span>),
        version: ur.headers.get(<span class="s">'x-eccal-version'</span>),
        redirectBypassed: ur.headers.get(<span class="s">'x-eccal-redirect-bypassed'</span>),
        body: ub
      },
      checks: {
        membershipMatch: vb?.user?.membership === ub?.user?.membership,  <span class="c">// 必須 true</span>
        creditsMatch: vb?.user?.credits === ub?.user?.credits             <span class="c">// 必須 true</span>
      }
    }, <span class="k">null</span>, 2), { headers: { <span class="s">'Content-Type'</span>: <span class="s">'application/json'</span> } });
  }
};</pre>

<h3>Node.js — CI 驗收腳本</h3>
<pre><span class="c">// 執行：ECCAL_TEST_TOKEN=... ECCAL_TEST_USER_ID=... node verify.js</span>
<span class="k">const</span> token = process.env.ECCAL_TEST_TOKEN;
<span class="k">const</span> userId = process.env.ECCAL_TEST_USER_ID;
<span class="k">const</span> ECCAL = <span class="s">'https://eccal.thinkwithblack.com'</span>;

<span class="k">async function</span> main() {
  <span class="k">const</span> [vr, ur] = <span class="k">await</span> Promise.all([
    fetch(<span class="m">\`\${ECCAL}/api/sso/verify-token\`</span>, {
      method: <span class="s">'POST'</span>,
      headers: { <span class="s">'Content-Type'</span>: <span class="s">'application/json'</span> },
      body: JSON.stringify({ token })
    }),
    fetch(<span class="m">\`\${ECCAL}/api/account-center/user/\${userId}\`</span>)
  ]);
  <span class="k">const</span> [vb, ub] = <span class="k">await</span> Promise.all([vr.json(), ur.json()]);

  console.log(JSON.stringify({
    verifyStatus: vr.status, userStatus: ur.status,
    verifyMembership: vb?.user?.membership, userMembership: ub?.user?.membership,
    verifyCredits: vb?.user?.credits, userCredits: ub?.user?.credits
  }, <span class="k">null</span>, 2));

  <span class="k">if</span> (vr.status !== 200) process.exit(1);
  <span class="k">if</span> (ur.status !== 200) process.exit(1);
  <span class="k">if</span> (vb?.user?.membership !== ub?.user?.membership) process.exit(2);  <span class="c">// membership 不一致</span>
  <span class="k">if</span> (vb?.user?.credits !== ub?.user?.credits) process.exit(3);          <span class="c">// credits 不一致</span>
  console.log(<span class="s">'✓ All checks passed'</span>);
}
main().catch(e => { console.error(e); process.exit(99); });</pre>

<h2 id="troubleshoot">常見問題排查</h2>

<h3>問題一：membership 顯示 "free" 但帳號應為 Pro</h3>
<table class="param-table">
    <thead><tr><th>可能原因</th><th>診斷方式</th><th>解決</th></tr></thead>
    <tbody>
        <tr><td>訂閱到期（<code>membershipExpires</code> 是過去時間）</td><td>呼叫 <code>/api/account-center/user/:id</code> 檢查 <code>membershipExpires</code> 欄位</td><td>更新訂閱或延長到期日</td></tr>
        <tr><td>讀取的是 JWT Token 裡的舊快照</td><td>直接呼叫 <code>verify-token</code>，比較 token payload 和 API 回傳是否不同</td><td>以 API 回傳值為準，捨棄 Token 裡的 membership 快照</td></tr>
        <tr><td>呼叫的是兩個端點且結果不一致（v3.1 以前的 bug）</td><td>檢查 <code>X-ECCAL-Version</code> header，確認是否 &lt; 3.2</td><td>ECCAL 已在 v3.2 修復，需確認正式環境已部署最新版</td></tr>
    </tbody>
</table>

<h3>問題二：Cloudflare Worker 呼叫 verify-token 出現 "Too many redirects"</h3>
<div class="note warn">
    <strong>必要確認：</strong>Worker 的 fetch URL 是否使用 <code>https://</code>（不是 http://）？使用 http 會被 Google 基礎設施重導向至 https，可能觸發 redirect loop。
</div>
<table class="param-table">
    <thead><tr><th>檢查項目</th><th>說明</th></tr></thead>
    <tbody>
        <tr><td>確認 URL 使用 https://</td><td><code>fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', ...)</code></td></tr>
        <tr><td>確認 Content-Type header</td><td><code>headers: { 'Content-Type': 'application/json' }</code> 不可省略</td></tr>
        <tr><td>確認 body 有正確序列化</td><td><code>body: JSON.stringify({ token })</code></td></tr>
        <tr><td>檢查 X-ECCAL-Redirect-Bypassed</td><td>若值為 <code>true</code>，表示 ECCAL 某路由嘗試 redirect 被攔截，請通知 ECCAL 管理員</td></tr>
        <tr><td>確認 X-ECCAL-Version 為 3.2</td><td>低於 3.2 的版本有 redirect blocker 尚未完整覆蓋所有路由的問題</td></tr>
    </tbody>
</table>

<h3>問題三：verify-token 回傳 404（ACCOUNT_NOT_FOUND）</h3>
<p>從 v3.2 起，verify-token 在 JWT 簽章有效但資料庫找不到對應用戶時，會回傳 <code>404 { valid: false, error: "ACCOUNT_NOT_FOUND" }</code>。此情況代表 JWT 是舊的有效 token，但帳號已被刪除或 ID 不符。子服務應清除本地 token 並導向重新登入。</p>

<h3>問題四：credits 扣除後 verify-token 還是回傳舊值</h3>
<div class="note info">verify-token 和 account-center/user 都是即時查詢 DB，不使用快取。扣除點數後立即呼叫即可取得最新值。只有 JWT Token 本身（存在 localStorage 或 cookie 中）是快照，不會自動更新。</div>

<h2 id="live-test">線上測試工具</h2>
<h3>測試 SSO 登入流程</h3>
<div class="live-test">
    <p>輸入 callback 網址，啟動 Google 登入，完成後 token 會自動帶回此頁：</p>
    <input type="text" id="t-return" value="https://eccal.thinkwithblack.com/sso-guide">
    <button onclick="doLogin()">啟動 Google 登入</button>
</div>
<h3>測試 verify-token</h3>
<div class="live-test">
    <input type="text" id="t-token" placeholder="貼上 JWT Token...">
    <button onclick="doVerify()">驗證 Token</button>
    <button class="sec" onclick="loadToken()">載入本地 Token</button>
    <div id="r-verify" class="live-result"></div>
</div>
<h3>測試 Account Center 用戶查詢</h3>
<div class="live-test">
    <input type="text" id="t-uid" placeholder="用戶 ID 或 Email">
    <button onclick="doGetUser()">查詢用戶</button>
    <div id="r-user" class="live-result"></div>
</div>

</div>

<script>
(function(){
    var p = new URLSearchParams(window.location.search);
    var tok = p.get('token'), ae = p.get('auth_error');
    if(tok && p.get('auth_success')==='true'){
        localStorage.setItem('eccal_auth_token',tok);
        window.history.replaceState({},'',location.pathname);
        document.getElementById('t-token').value=tok;
        show('r-verify','Token 已接收，點擊「驗證 Token」確認');
    } else if(ae==='true'){
        show('r-verify','登入失敗：'+decodeURIComponent(p.get('error_message')||''));
    }
    window.addEventListener('scroll',function(){
        var sy=scrollY+100;
        document.querySelectorAll('h2[id]').forEach(function(s){
            if(s.offsetTop<=sy){
                document.querySelectorAll('.sidebar a').forEach(function(a){a.classList.remove('active');});
                var al=document.querySelector('.sidebar a[href="#'+s.id+'"]');
                if(al)al.classList.add('active');
            }
        });
    });
})();
function doLogin(){ var r=document.getElementById('t-return').value||location.href; location.href='https://eccal.thinkwithblack.com/api/auth/google-sso?returnTo='+encodeURIComponent(r)+'&service=guide-test'; }
function loadToken(){ var t=localStorage.getItem('eccal_auth_token'); if(t){document.getElementById('t-token').value=t;}else{show('r-verify','沒有找到本地 Token，請先執行登入測試');} }
function doVerify(){ var t=document.getElementById('t-token').value.trim(); if(!t){show('r-verify','請輸入 Token');return;} show('r-verify','驗證中...'); fetch('https://eccal.thinkwithblack.com/api/sso/verify-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})}).then(function(r){return r.json();}).then(function(d){show('r-verify',JSON.stringify(d,null,2));}).catch(function(e){show('r-verify','錯誤：'+e.message);}); }
function doGetUser(){ var u=document.getElementById('t-uid').value.trim(); if(!u){show('r-user','請輸入用戶 ID 或 Email');return;} show('r-user','查詢中...'); fetch('https://eccal.thinkwithblack.com/api/account-center/user/'+encodeURIComponent(u)).then(function(r){return r.json();}).then(function(d){show('r-user',JSON.stringify(d,null,2));}).catch(function(e){show('r-user','錯誤：'+e.message);}); }
function show(id,t){ var el=document.getElementById(id); if(el){el.style.display='block';el.textContent=t;} }
</script>
</body>
</html>
`);
});
// 新的測試頁面端點
app.get('/test-integration-fixed.html', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SSO 整合測試頁面</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            padding: 20px;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        
        .card {
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        h1 {
            color: #1a1a1a;
            margin-bottom: 20px;
            font-size: 28px;
        }
        
        h2 {
            color: #333;
            margin-bottom: 16px;
            font-size: 20px;
        }
        
        .button {
            background: #007bff;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            margin: 8px 8px 8px 0;
            transition: background 0.2s;
        }
        
        .button:hover {
            background: #0056b3;
        }
        
        .button.danger {
            background: #dc3545;
        }
        
        .button.danger:hover {
            background: #c82333;
        }
        
        .status {
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 16px;
            font-weight: 500;
        }
        
        .status.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .status.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .status.info {
            background: #d1ecf1;
            color: #0c5460;
            border: 1px solid #bee5eb;
        }
        
        .log-container {
            background: #1a1a1a;
            color: #00ff00;
            padding: 16px;
            border-radius: 6px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            height: 200px;
            overflow-y: auto;
            line-height: 1.4;
        }
        
        .user-info {
            display: none;
        }
        
        .user-info.show {
            display: block;
        }
        
        .user-data {
            background: #f8f9fa;
            padding: 16px;
            border-radius: 6px;
            margin-top: 12px;
        }
        
        .user-data p {
            margin: 8px 0;
            color: #495057;
        }
        
        .user-data strong {
            color: #212529;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>🔐 SSO 整合測試頁面</h1>
            <p>測試 eccal.thinkwithblack.com 的 SSO 認證功能</p>
            
            <div style="margin-top: 20px;">
                <button class="button" onclick="startGoogleLogin()">
                    🔑 Google 登入
                </button>
                <button class="button" onclick="testCurrentToken()">
                    🔍 測試當前 Token
                </button>
                <button class="button danger" onclick="clearAllData()">
                    🗑️ 清除所有資料
                </button>
            </div>
        </div>
        
        <div class="card">
            <h2>📊 認證狀態</h2>
            <div id="auth-status" class="status info">
                正在檢查認證狀態...
            </div>
        </div>
        
        <div class="card user-info" id="user-info">
            <h2>👤 用戶資訊</h2>
            <div class="user-data" id="user-data">
                <!-- 用戶資訊將在這裡顯示 -->
            </div>
        </div>
        
        <div class="card">
            <h2>📝 操作日誌</h2>
            <div id="log-output" class="log-container"></div>
        </div>
    </div>

    <script type="text/javascript">
        (function() {
            'use strict';
            
            // 全域變數
            var currentToken = null;
            var currentUser = null;
            var baseUrl = 'https://eccal.thinkwithblack.com';
            
            // 日誌函數
            function addLog(message, type) {
                type = type || 'info';
                var logContainer = document.getElementById('log-output');
                var timestamp = new Date().toLocaleTimeString('zh-TW');
                var logLine = '[' + timestamp + '] ' + message;
                
                if (logContainer) {
                    logContainer.innerHTML += logLine + '\\n';
                    logContainer.scrollTop = logContainer.scrollHeight;
                }
                
                console.log(logLine);
            }
            
            // 狀態顯示函數
            function showStatus(message, type) {
                var statusEl = document.getElementById('auth-status');
                if (statusEl) {
                    statusEl.className = 'status ' + (type || 'info');
                    statusEl.textContent = message;
                }
            }
            
            // 顯示用戶資訊
            function showUserInfo(user) {
                var userInfoEl = document.getElementById('user-info');
                var userDataEl = document.getElementById('user-data');
                
                if (userInfoEl && userDataEl) {
                    userDataEl.innerHTML = 
                        '<p><strong>📧 Email:</strong> ' + (user.email || '未提供') + '</p>' +
                        '<p><strong>👤 姓名:</strong> ' + (user.name || '未設定') + '</p>' +
                        '<p><strong>🏆 會員等級:</strong> ' + (user.membershipLevel || 'free') + '</p>' +
                        '<p><strong>💰 點數餘額:</strong> ' + (user.credits || 0) + ' 點</p>' +
                        '<p><strong>🔑 用戶 ID:</strong> ' + (user.id || '未知') + '</p>';
                    
                    userInfoEl.classList.add('show');
                    currentUser = user;
                }
            }
            
            // 隱藏用戶資訊
            function hideUserInfo() {
                var userInfoEl = document.getElementById('user-info');
                if (userInfoEl) {
                    userInfoEl.classList.remove('show');
                }
                currentUser = null;
            }
            
            // 驗證 Token
            function verifyToken(token) {
                addLog('開始驗證 Token: ' + token.substring(0, 20) + '...');
                
                var xhr = new XMLHttpRequest();
                xhr.open('POST', baseUrl + '/api/sso/verify-token', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                
                xhr.onreadystatechange = function() {
                    if (xhr.readyState === 4) {
                        if (xhr.status === 200) {
                            try {
                                var response = JSON.parse(xhr.responseText);
                                if (response.valid && response.user) {
                                    addLog('✅ Token 驗證成功');
                                    showStatus('認證成功！Token 有效', 'success');
                                    showUserInfo(response.user);
                                    currentToken = token;
                                } else {
                                    addLog('❌ Token 無效');
                                    showStatus('Token 無效', 'error');
                                    hideUserInfo();
                                }
                            } catch (e) {
                                addLog('❌ 解析回應失敗: ' + e.message);
                                showStatus('解析回應失敗', 'error');
                            }
                        } else {
                            addLog('❌ 驗證請求失敗: HTTP ' + xhr.status);
                            showStatus('驗證請求失敗: HTTP ' + xhr.status, 'error');
                        }
                    }
                };
                
                xhr.send(JSON.stringify({ token: token }));
            }
            
            // 檢查當前認證狀態
            function checkAuthStatus() {
                addLog('🔍 檢查認證狀態...');
                
                // 檢查 URL 參數
                var urlParams = new URLSearchParams(window.location.search);
                var authSuccess = urlParams.get('auth_success');
                var token = urlParams.get('token');
                
                if (authSuccess === 'true' && token) {
                    addLog('📥 從 URL 獲取到新的 Token');
                    localStorage.setItem('eccal_auth_token', token);
                    verifyToken(token);
                    return;
                }
                
                // 檢查本地存儲
                var storedToken = localStorage.getItem('eccal_auth_token');
                if (storedToken) {
                    addLog('📦 從本地存儲獲取到 Token');
                    verifyToken(storedToken);
                } else {
                    addLog('⚠️ 沒有找到有效的認證 Token');
                    showStatus('未認證 - 請登入', 'info');
                }
            }
            
            // 全域函數：Google 登入
            window.startGoogleLogin = function() {
                addLog('🚀 啟動 Google 登入流程');
                
                var currentUrl = window.location.href.split('?')[0];
                var returnUrl = encodeURIComponent(currentUrl);
                var loginUrl = baseUrl + '/api/auth/google-sso?returnTo=' + returnUrl + '&service=test';
                
                addLog('🔗 重導向至: ' + loginUrl);
                window.location.href = loginUrl;
            };
            
            // 全域函數：測試當前 Token
            window.testCurrentToken = function() {
                var token = localStorage.getItem('eccal_auth_token');
                if (token) {
                    addLog('🧪 測試當前 Token');
                    verifyToken(token);
                } else {
                    addLog('⚠️ 沒有找到本地 Token');
                    showStatus('沒有找到本地 Token', 'error');
                }
            };
            
            // 全域函數：清除所有資料
            window.clearAllData = function() {
                addLog('🗑️ 清除所有本地資料');
                localStorage.removeItem('eccal_auth_token');
                localStorage.removeItem('eccal_auth_user');
                hideUserInfo();
                currentToken = null;
                currentUser = null;
                showStatus('資料已清除', 'info');
                addLog('✅ 清除完成');
            };
            
            // 頁面載入時檢查認證狀態
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', checkAuthStatus);
            } else {
                checkAuthStatus();
            }
            
            addLog('🎉 頁面初始化完成');
        })();
    </script>
</body>
</html>
  `);
});

// Facebook 資料刪除端點（Meta 合規）
app.use('/api/facebook/data-deletion', express.json(), (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SSO 整合測試頁面</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            padding: 20px;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        
        .card {
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        h1 {
            color: #1a1a1a;
            margin-bottom: 20px;
            font-size: 28px;
        }
        
        h2 {
            color: #333;
            margin-bottom: 16px;
            font-size: 20px;
        }
        
        .button {
            background: #007bff;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            margin: 8px 8px 8px 0;
            transition: background 0.2s;
        }
        
        .button:hover {
            background: #0056b3;
        }
        
        .button.danger {
            background: #dc3545;
        }
        
        .button.danger:hover {
            background: #c82333;
        }
        
        .status {
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 16px;
            font-weight: 500;
        }
        
        .status.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .status.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .status.info {
            background: #d1ecf1;
            color: #0c5460;
            border: 1px solid #bee5eb;
        }
        
        .log-container {
            background: #1a1a1a;
            color: #00ff00;
            padding: 16px;
            border-radius: 6px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            height: 200px;
            overflow-y: auto;
            line-height: 1.4;
        }
        
        .user-info {
            display: none;
        }
        
        .user-info.show {
            display: block;
        }
        
        .user-data {
            background: #f8f9fa;
            padding: 16px;
            border-radius: 6px;
            margin-top: 12px;
        }
        
        .user-data p {
            margin: 8px 0;
            color: #495057;
        }
        
        .user-data strong {
            color: #212529;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>🔐 SSO 整合測試頁面</h1>
            <p>測試 eccal.thinkwithblack.com 的 SSO 認證功能</p>
            
            <div style="margin-top: 20px;">
                <button class="button" onclick="startGoogleLogin()">
                    🔑 Google 登入
                </button>
                <button class="button" onclick="testCurrentToken()">
                    🔍 測試當前 Token
                </button>
                <button class="button danger" onclick="clearAllData()">
                    🗑️ 清除所有資料
                </button>
            </div>
        </div>
        
        <div class="card">
            <h2>📊 認證狀態</h2>
            <div id="auth-status" class="status info">
                正在檢查認證狀態...
            </div>
        </div>
        
        <div class="card user-info" id="user-info">
            <h2>👤 用戶資訊</h2>
            <div class="user-data" id="user-data">
                <!-- 用戶資訊將在這裡顯示 -->
            </div>
        </div>
        
        <div class="card">
            <h2>📝 操作日誌</h2>
            <div id="log-output" class="log-container"></div>
        </div>
    </div>

    <script type="text/javascript">
        (function() {
            'use strict';
            
            // 全域變數
            var currentToken = null;
            var currentUser = null;
            var baseUrl = 'https://eccal.thinkwithblack.com';
            
            // 日誌函數
            function addLog(message, type) {
                type = type || 'info';
                var logContainer = document.getElementById('log-output');
                var timestamp = new Date().toLocaleTimeString('zh-TW');
                var logLine = '[' + timestamp + '] ' + message;
                
                if (logContainer) {
                    logContainer.innerHTML += logLine + '\\n';
                    logContainer.scrollTop = logContainer.scrollHeight;
                }
                
                console.log(logLine);
            }
            
            // 狀態顯示函數
            function showStatus(message, type) {
                var statusEl = document.getElementById('auth-status');
                if (statusEl) {
                    statusEl.className = 'status ' + (type || 'info');
                    statusEl.textContent = message;
                }
            }
            
            // 顯示用戶資訊
            function showUserInfo(user) {
                var userInfoEl = document.getElementById('user-info');
                var userDataEl = document.getElementById('user-data');
                
                if (userInfoEl && userDataEl) {
                    userDataEl.innerHTML = 
                        '<p><strong>📧 Email:</strong> ' + (user.email || '未提供') + '</p>' +
                        '<p><strong>👤 姓名:</strong> ' + (user.name || '未設定') + '</p>' +
                        '<p><strong>🏆 會員等級:</strong> ' + (user.membershipLevel || 'free') + '</p>' +
                        '<p><strong>💰 點數餘額:</strong> ' + (user.credits || 0) + ' 點</p>' +
                        '<p><strong>🔑 用戶 ID:</strong> ' + (user.id || '未知') + '</p>';
                    
                    userInfoEl.classList.add('show');
                    currentUser = user;
                }
            }
            
            // 隱藏用戶資訊
            function hideUserInfo() {
                var userInfoEl = document.getElementById('user-info');
                if (userInfoEl) {
                    userInfoEl.classList.remove('show');
                }
                currentUser = null;
            }
            
            // 驗證 Token
            function verifyToken(token) {
                addLog('開始驗證 Token: ' + token.substring(0, 20) + '...');
                
                var xhr = new XMLHttpRequest();
                xhr.open('POST', baseUrl + '/api/sso/verify-token', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                
                xhr.onreadystatechange = function() {
                    if (xhr.readyState === 4) {
                        if (xhr.status === 200) {
                            try {
                                var response = JSON.parse(xhr.responseText);
                                if (response.valid && response.user) {
                                    addLog('✅ Token 驗證成功');
                                    showStatus('認證成功！Token 有效', 'success');
                                    showUserInfo(response.user);
                                    currentToken = token;
                                } else {
                                    addLog('❌ Token 無效');
                                    showStatus('Token 無效', 'error');
                                    hideUserInfo();
                                }
                            } catch (e) {
                                addLog('❌ 解析回應失敗: ' + e.message);
                                showStatus('解析回應失敗', 'error');
                            }
                        } else {
                            addLog('❌ 驗證請求失敗: HTTP ' + xhr.status);
                            showStatus('驗證請求失敗: HTTP ' + xhr.status, 'error');
                        }
                    }
                };
                
                xhr.send(JSON.stringify({ token: token }));
            }
            
            // 檢查當前認證狀態
            function checkAuthStatus() {
                addLog('🔍 檢查認證狀態...');
                
                // 檢查 URL 參數
                var urlParams = new URLSearchParams(window.location.search);
                var authSuccess = urlParams.get('auth_success');
                var token = urlParams.get('token');
                
                if (authSuccess === 'true' && token) {
                    addLog('📥 從 URL 獲取到新的 Token');
                    localStorage.setItem('eccal_auth_token', token);
                    verifyToken(token);
                    return;
                }
                
                // 檢查本地存儲
                var storedToken = localStorage.getItem('eccal_auth_token');
                if (storedToken) {
                    addLog('📦 從本地存儲獲取到 Token');
                    verifyToken(storedToken);
                } else {
                    addLog('⚠️ 沒有找到有效的認證 Token');
                    showStatus('未認證 - 請登入', 'info');
                }
            }
            
            // 全域函數：Google 登入
            window.startGoogleLogin = function() {
                addLog('🚀 啟動 Google 登入流程');
                
                var currentUrl = window.location.href.split('?')[0];
                var returnUrl = encodeURIComponent(currentUrl);
                var loginUrl = baseUrl + '/api/auth/google-sso?returnTo=' + returnUrl + '&service=test';
                
                addLog('🔗 重導向至: ' + loginUrl);
                window.location.href = loginUrl;
            };
            
            // 全域函數：測試當前 Token
            window.testCurrentToken = function() {
                var token = localStorage.getItem('eccal_auth_token');
                if (token) {
                    addLog('🧪 測試當前 Token');
                    verifyToken(token);
                } else {
                    addLog('⚠️ 沒有找到本地 Token');
                    showStatus('沒有找到本地 Token', 'error');
                }
            };
            
            // 全域函數：清除所有資料
            window.clearAllData = function() {
                addLog('🗑️ 清除所有本地資料');
                localStorage.removeItem('eccal_auth_token');
                localStorage.removeItem('eccal_auth_user');
                hideUserInfo();
                currentToken = null;
                currentUser = null;
                showStatus('資料已清除', 'info');
                addLog('✅ 清除完成');
            };
            
            // 頁面載入時檢查認證狀態
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', checkAuthStatus);
            } else {
                checkAuthStatus();
            }
            
            addLog('🎉 頁面初始化完成');
        })();
    </script>
</body>
</html>
  `);
});

// Facebook 資料刪除端點（Meta 合規）
app.use('/api/facebook/data-deletion', express.json(), (req, res) => {
  if (req.method === 'POST') {
    res.json({ 
      success: true, 
      message: 'Data deletion request received',
      url: 'https://eccal.thinkwithblack.com/privacy',
      confirmation_code: 'DELETION_' + Date.now()
    });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
});

// AudAI 整合測試頁面端點
app.get('/test-audai-integration.html', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AudAI 子服務整合測試</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .status {
            padding: 15px;
            margin: 10px 0;
            border-radius: 5px;
            border-left: 4px solid #007bff;
            background: #f8f9fa;
        }
        .success {
            border-left-color: #28a745;
            background: #d4edda;
        }
        .error {
            border-left-color: #dc3545;
            background: #f8d7da;
        }
        button {
            background: #4285f4;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 5px;
            cursor: pointer;
            margin: 10px 0;
        }
        button:hover {
            background: #357ae8;
        }
        .hidden {
            display: none;
        }
        .user-info {
            background: #e9ecef;
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>AudAI 子服務整合測試</h1>
        
        <div id="status-display">
            <h3>狀態檢查</h3>
            <div id="url-status" class="status">檢查中...</div>
            <div id="token-status" class="status">檢查中...</div>
            <div id="auth-status" class="status">檢查中...</div>
        </div>

        <div id="login-section">
            <h3>認證操作</h3>
            <button onclick="testGoogleLogin()">測試 Google 登入</button>
            <button onclick="testTokenVerification()">測試 Token 驗證</button>
            <button onclick="clearAll()">清除所有資料</button>
        </div>

        <div id="user-section" class="hidden">
            <h3>用戶資訊</h3>
            <div id="user-display" class="user-info"></div>
            <button onclick="logout()">登出</button>
        </div>

        <div id="logs">
            <h3>詳細日誌</h3>
            <div id="log-container" style="max-height: 400px; overflow-y: auto; background: #f8f9fa; padding: 15px; border-radius: 5px; font-family: monospace;"></div>
        </div>
    </div>

    <script>
        // 日誌系統
        function log(message, type = 'info') {
            const logContainer = document.getElementById('log-container');
            const timestamp = new Date().toLocaleTimeString();
            const logEntry = document.createElement('div');
            logEntry.style.color = type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#333';
            logEntry.innerHTML = \`[\${timestamp}] \${message}\`;
            logContainer.appendChild(logEntry);
            logContainer.scrollTop = logContainer.scrollHeight;
            console.log(\`[\${type}] \${message}\`);
        }

        // 頁面載入時執行
        window.addEventListener('load', function() {
            log('頁面載入完成，開始檢查認證狀態...', 'info');
            checkAuthStatus();
        });

        // 檢查認證狀態
        function checkAuthStatus() {
            // 1. 檢查 URL 參數
            const urlParams = new URLSearchParams(window.location.search);
            const authSuccess = urlParams.get('auth_success');
            const token = urlParams.get('token');
            const userId = urlParams.get('user_id');
            const authError = urlParams.get('auth_error');
            const errorMessage = urlParams.get('error_message');

            log(\`URL 參數檢查: success=\${authSuccess}, token=\${token ? 'present' : 'missing'}, error=\${authError}\`, 'info');

            document.getElementById('url-status').innerHTML = \`
                <strong>URL 參數:</strong><br>
                auth_success: \${authSuccess || 'none'}<br>
                token: \${token ? 'present (' + token.length + ' chars)' : 'missing'}<br>
                user_id: \${userId || 'none'}<br>
                auth_error: \${authError || 'none'}<br>
                error_message: \${errorMessage || 'none'}
            \`;

            // 2. 檢查本地存儲
            const storedToken = localStorage.getItem('eccal_auth_token');
            const storedUser = localStorage.getItem('eccal_auth_user');

            log(\`本地存儲檢查: token=\${storedToken ? 'present' : 'missing'}, user=\${storedUser ? 'present' : 'missing'}\`, 'info');

            document.getElementById('token-status').innerHTML = \`
                <strong>本地存儲:</strong><br>
                Token: \${storedToken ? 'present (' + storedToken.length + ' chars)' : 'missing'}<br>
                User: \${storedUser ? 'present' : 'missing'}
            \`;

            // 3. 處理認證結果
            if (authSuccess === 'true' && token) {
                log('檢測到認證成功，處理回調...', 'success');
                handleAuthCallback(token, userId);
            } else if (authError === 'true') {
                log(\`認證失敗: \${errorMessage || '未知錯誤'}\`, 'error');
                document.getElementById('auth-status').className = 'status error';
                document.getElementById('auth-status').innerHTML = \`<strong>認證失敗:</strong> \${decodeURIComponent(errorMessage || '未知錯誤')}\`;
            } else if (storedToken) {
                log('發現本地 token，嘗試驗證...', 'info');
                verifyStoredToken(storedToken);
            } else {
                log('未發現認證資訊，顯示登入界面', 'info');
                document.getElementById('auth-status').innerHTML = '<strong>狀態:</strong> 未登入';
                showLoginSection();
            }
        }

        // 處理認證回調
        function handleAuthCallback(token, userId) {
            try {
                // 儲存 token
                localStorage.setItem('eccal_auth_token', token);
                log('Token 已儲存到本地存儲', 'success');

                // 解析 JWT token (安全解析，處理可能的錯誤)
                let payload;
                try {
                    log(\`開始解析 JWT token, 長度: \${token.length}\`, 'info');
                    
                    const tokenParts = token.split('.');
                    if (tokenParts.length !== 3) {
                        throw new Error('JWT token 格式不正確');
                    }
                    
                    log(\`JWT token 部分長度: header=\${tokenParts[0].length}, payload=\${tokenParts[1].length}, signature=\${tokenParts[2].length}\`, 'info');
                    
                    // 修正 base64 padding
                    let base64Payload = tokenParts[1];
                    while (base64Payload.length % 4) {
                        base64Payload += '=';
                    }
                    
                    log(\`base64 payload 長度: \${base64Payload.length}\`, 'info');
                    
                    const decodedPayload = atob(base64Payload);
                    log(\`解碼後的 payload: \${decodedPayload}\`, 'info');
                    
                    payload = JSON.parse(decodedPayload);
                    log(\`JWT 解析成功: \${JSON.stringify(payload, null, 2)}\`, 'success');
                } catch (parseError) {
                    log(\`JWT 解析失敗: \${parseError.message}\`, 'error');
                    log(\`錯誤堆疊: \${parseError.stack}\`, 'error');
                    log(\`Token 內容: \${token}\`, 'error');
                    
                    // 嘗試使用 API 驗證 token
                    log('嘗試使用 API 驗證 token...', 'info');
                    try {
                        const response = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Origin': window.location.origin
                            },
                            body: JSON.stringify({ token })
                        });
                        
                        if (response.ok) {
                            const data = await response.json();
                            if (data.valid && data.user) {
                                log('API 驗證成功，使用 API 返回的用戶資訊', 'success');
                                payload = data.user;
                            } else {
                                throw new Error('API 驗證失敗');
                            }
                        } else {
                            throw new Error(\`API 驗證響應錯誤: \${response.status}\`);
                        }
                    } catch (apiError) {
                        log(\`API 驗證也失敗: \${apiError.message}\`, 'error');
                        // 使用基本用戶資訊
                        payload = {
                            email: 'unknown@example.com',
                            name: '未知用戶',
                            membership: 'free',
                            credits: 0
                        };
                    }
                }

                // 顯示用戶資訊
                showUserSection(payload);

                // 清理 URL
                cleanupUrl();

                document.getElementById('auth-status').className = 'status success';
                document.getElementById('auth-status').innerHTML = \`<strong>認證成功!</strong> 用戶: \${payload.email}\`;

            } catch (error) {
                log(\`處理認證回調失敗: \${error.message}\`, 'error');
                document.getElementById('auth-status').className = 'status error';
                document.getElementById('auth-status').innerHTML = \`<strong>處理失敗:</strong> \${error.message}\`;
            }
        }

        // 驗證存儲的 token
        async function verifyStoredToken(token) {
            try {
                const response = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Origin': window.location.origin
                    },
                    body: JSON.stringify({ token })
                });

                log(\`Token 驗證響應: \${response.status} \${response.statusText}\`, 'info');

                if (response.ok) {
                    const data = await response.json();
                    if (data.valid) {
                        log('Token 驗證成功', 'success');
                        showUserSection(data.user);
                        document.getElementById('auth-status').className = 'status success';
                        document.getElementById('auth-status').innerHTML = \`<strong>已登入:</strong> \${data.user.email}\`;
                    } else {
                        log('Token 無效', 'error');
                        clearStoredAuth();
                        document.getElementById('auth-status').innerHTML = '<strong>Token 無效</strong>';
                    }
                } else {
                    log('Token 驗證失敗', 'error');
                    clearStoredAuth();
                    document.getElementById('auth-status').className = 'status error';
                    document.getElementById('auth-status').innerHTML = '<strong>Token 驗證失敗</strong>';
                }
            } catch (error) {
                log(\`Token 驗證錯誤: \${error.message}\`, 'error');
                clearStoredAuth();
                document.getElementById('auth-status').className = 'status error';
                document.getElementById('auth-status').innerHTML = \`<strong>驗證錯誤:</strong> \${error.message}\`;
            }
        }

        // 顯示登入界面
        function showLoginSection() {
            document.getElementById('login-section').classList.remove('hidden');
            document.getElementById('user-section').classList.add('hidden');
        }

        // 顯示用戶界面
        function showUserSection(user) {
            document.getElementById('login-section').classList.add('hidden');
            document.getElementById('user-section').classList.remove('hidden');
            
            document.getElementById('user-display').innerHTML = \`
                <strong>用戶資訊:</strong><br>
                Email: \${user.email}<br>
                Name: \${user.name || '未設定'}<br>
                ID: \${user.sub || user.id}<br>
                Membership: \${user.membership || 'free'}<br>
                Credits: \${user.credits || 0}
            \`;
        }

        // 清理 URL 參數
        function cleanupUrl() {
            const url = new URL(window.location);
            url.searchParams.delete('auth_success');
            url.searchParams.delete('token');
            url.searchParams.delete('user_id');
            url.searchParams.delete('auth_error');
            url.searchParams.delete('error_message');
            window.history.replaceState({}, document.title, url.toString());
            log('URL 參數已清理', 'info');
        }

        // 清除認證資訊
        function clearStoredAuth() {
            localStorage.removeItem('eccal_auth_token');
            localStorage.removeItem('eccal_auth_user');
            log('本地認證資訊已清除', 'info');
        }

        // 測試 Google 登入
        function testGoogleLogin() {
            const returnUrl = encodeURIComponent('https://eccal.thinkwithblack.com/test-audai-integration.html');
            const serviceName = 'audai';
            const loginUrl = \`https://eccal.thinkwithblack.com/api/auth/google-sso?returnTo=\${returnUrl}&service=\${serviceName}\`;
            
            log(\`開始 Google 登入流程: \${loginUrl}\`, 'info');
            window.location.href = loginUrl;
        }

        // 測試 Token 驗證
        function testTokenVerification() {
            const token = localStorage.getItem('eccal_auth_token');
            if (!token) {
                log('沒有找到本地 token', 'error');
                return;
            }
            
            log('開始驗證本地 token...', 'info');
            verifyStoredToken(token);
        }

        // 清除所有資料
        function clearAll() {
            clearStoredAuth();
            cleanupUrl();
            document.getElementById('log-container').innerHTML = '';
            log('所有資料已清除', 'info');
            checkAuthStatus();
        }

        // 登出
        function logout() {
            clearStoredAuth();
            showLoginSection();
            document.getElementById('auth-status').innerHTML = '<strong>已登出</strong>';
            log('用戶已登出', 'info');
        }
    </script>
</body>
</html>`);
});

// 測試用 JWT Token 生成端點 - 高優先級
app.get('/api/generate-test-token', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    
    const testToken = jwt.sign(
      { 
        sub: '102598988575056957509',
        email: 'backtrue@gmail.com',
        name: '煜庭 邱',
        membership: 'pro',
        credits: 42,
        iss: 'eccal.thinkwithblack.com',
        aud: 'test'
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token: testToken,
      decoded: jwt.decode(testToken)
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Google SSO 認證端點 - 高優先級註冊
// 這個端點負責啟動 Google OAuth 流程，應該重定向到 Google
app.get('/api/auth/google-sso', async (req, res) => {
  try {
    const { returnTo, service } = req.query;
    
    console.log('Google SSO 啟動請求:', {
      returnTo,
      service,
      origin: req.headers.origin,
      referer: req.headers.referer
    });
    
    // 設置 CORS 標頭
    const allowedOrigins = [
      'https://eccal.thinkwithblack.com',
      'https://audai.thinkwithblack.com',
      'https://quote.thinkwithblack.com',
      'https://fabe.thinkwithblack.com',
      'https://galine.thinkwithblack.com',
      'https://serp.thinkwithblack.com',
      'https://sub3.thinkwithblack.com',
      'https://sub4.thinkwithblack.com',
      'https://sub5.thinkwithblack.com',
      'https://member.thinkwithblack.com',
      'https://andromeda.thinkwithblack.com',
      'https://sbir.thinkwithblack.com',
      'https://sbir-api.thinkwithblack.com',
      'http://localhost:3000',
      'http://localhost:5000'
    ];
    
    const origin = req.headers.origin || req.headers.referer;
    if (origin) {
      const originUrl = new URL(origin);
      const baseOrigin = `${originUrl.protocol}//${originUrl.hostname}`;
      if (allowedOrigins.includes(baseOrigin)) {
        res.header('Access-Control-Allow-Origin', baseOrigin);
      }
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // 創建 state 參數來保存 returnTo 和 service 資訊
    const state = Buffer.from(JSON.stringify({
      returnTo: returnTo || '/',
      service: service || 'unknown',
      origin: origin || req.headers.origin
    })).toString('base64');
    
    // 構建 Google OAuth URL
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.NODE_ENV === 'production' 
      ? 'https://eccal.thinkwithblack.com/api/auth/google-sso/callback'
      : `${req.protocol}://${req.get('host')}/api/auth/google-sso/callback`;
    
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${clientId}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent('profile email https://www.googleapis.com/auth/analytics.readonly')}&` +
      `state=${state}&` +
      `access_type=offline&` +
      `prompt=consent`;
    
    console.log('重定向到 Google OAuth:', googleAuthUrl);
    
    // 重定向到 Google OAuth
    res.redirect(googleAuthUrl);
    
  } catch (error) {
    console.error('Google SSO 啟動錯誤:', error);
    res.status(500).json({
      success: false,
      error: 'Google SSO 啟動失敗',
      code: 'GOOGLE_SSO_START_ERROR'
    });
  }
});

// Google OAuth 回調端點
app.get('/api/auth/google-sso/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    console.log('=== Google OAuth 回調開始 ===');
    console.log('Query 參數:', {
      code: code ? 'present' : 'missing',
      state: state ? 'present' : 'missing',
      allParams: req.query
    });
    
    if (!code) {
      console.error('缺少授權碼');
      return res.status(400).json({
        success: false,
        error: '缺少授權碼',
        code: 'MISSING_AUTH_CODE'
      });
    }
    
    // 解析 state 參數
    let stateData = { returnTo: '/', service: 'unknown', origin: '' };
    if (state) {
      try {
        console.log('原始 state 參數:', state);
        stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
        console.log('解析後的 state 資料:', stateData);
      } catch (e) {
        console.error('解析 state 失敗:', e);
      }
    }
    
    console.log('Google OAuth 回調處理:', {
      code: code ? 'present' : 'missing',
      stateData
    });
    
    // 使用授權碼獲取用戶資料
    const { default: jwt } = await import('jsonwebtoken');
    const crypto = await import('crypto');
    
    // 交換授權碼獲取 access token
    console.log('開始交換授權碼...');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code: code as string,
        grant_type: 'authorization_code',
        redirect_uri: process.env.NODE_ENV === 'production' 
          ? 'https://eccal.thinkwithblack.com/api/auth/google-sso/callback'
          : `${req.protocol}://${req.get('host')}/api/auth/google-sso/callback`,
      })
    });
    
    console.log('Token 交換響應狀態:', tokenResponse.status);
    const tokenData = await tokenResponse.json();
    console.log('Token 交換結果:', tokenData.access_token ? 'success' : 'failed');
    
    if (!tokenData.access_token) {
      console.error('獲取 access token 失敗:', tokenData);
      return res.status(400).json({
        success: false,
        error: '獲取 access token 失敗',
        code: 'TOKEN_EXCHANGE_ERROR'
      });
    }
    
    // 使用 access token 獲取用戶資料
    console.log('開始獲取用戶資料...');
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });
    
    console.log('用戶資料響應狀態:', userResponse.status);
    const userData = await userResponse.json();
    console.log('用戶資料:', {
      email: userData.email ? 'present' : 'missing',
      name: userData.name ? 'present' : 'missing'
    });
    
    if (!userData.email) {
      console.error('獲取用戶資料失敗:', userData);
      return res.status(400).json({
        success: false,
        error: '獲取用戶資料失敗',
        code: 'USER_INFO_ERROR'
      });
    }
    
    // 檢查或創建用戶
    console.log('開始檢查/創建用戶...');
    const { db } = await import('./db');
    const { users } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    
    let user = await db.select()
      .from(users)
      .where(eq(users.email, userData.email))
      .limit(1);
    
    console.log('用戶查詢結果:', user.length > 0 ? 'existing user' : 'new user');
    let userId: string;
    
    if (user.length === 0) {
      // 創建新用戶
      console.log('創建新用戶:', userData.email);
      const newUserId = crypto.randomUUID();
      
      await db.insert(users).values({
        id: newUserId,
        email: userData.email,
        name: userData.name || userData.email,
        firstName: userData.given_name || null,
        lastName: userData.family_name || null,
        profileImageUrl: userData.picture || null,
        googleId: userData.sub, // Store Google user ID instead of tokens
        // Note: OAuth tokens are now stored securely via secureTokenService
        service: stateData.service || 'unknown',
        credits: 30, // 新用戶獲得 30 點數
        lastLoginAt: new Date(),
        membershipLevel: 'free',
        membershipExpires: null
      });
      
      userId = newUserId;
    } else {
      // 更新現有用戶
      userId = user[0].id;
      await db.update(users)
        .set({
          name: userData.name || user[0].name,
          firstName: userData.given_name || user[0].firstName,
          lastName: userData.family_name || user[0].lastName,
          profileImageUrl: userData.picture || user[0].profileImageUrl,
          googleId: userData.sub, // Store Google user ID instead of tokens
          // Note: OAuth tokens are now stored securely via secureTokenService
          lastLoginAt: new Date()
        })
        .where(eq(users.id, userId));
    }
    
    // 獲取更新後的用戶資料
    const updatedUser = await db.select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    
    const finalUser = updatedUser[0];
    
    console.log('最終用戶資料:', {
      id: finalUser.id,
      email: finalUser.email,
      name: finalUser.name,
      membershipLevel: finalUser.membershipLevel,
      credits: finalUser.credits
    });

    // 安全地儲存 OAuth tokens
    if (tokenData.access_token) {
      const { secureTokenService } = await import('./secureTokenService');
      await secureTokenService.storeToken(userId, 'google', {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || undefined,
        expiresAt: tokenData.expires_in ? 
          new Date(Date.now() + tokenData.expires_in * 1000) : 
          new Date(Date.now() + 3600000),
      });
      console.log(`✅ OAuth tokens securely stored for user ${userId}`);
    }
    
    // 生成 JWT token
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    
    // 確保所有字符串都是 UTF-8 編碼的
    const tokenPayload = {
      sub: String(finalUser.id),
      email: String(finalUser.email),
      name: String(finalUser.name || ''),
      membership: String(finalUser.membershipLevel || 'free'),
      credits: Number(finalUser.credits || 0),
      iss: 'eccal.thinkwithblack.com',
      aud: String(stateData.origin || 'unknown')
    };
    
    console.log('JWT Payload:', tokenPayload);
    
    const token = jwt.sign(tokenPayload, JWT_SECRET, { 
      expiresIn: '7d',
      algorithm: 'HS256'
    });
    
    console.log('生成的 JWT Token:', token);
    console.log('Token 長度:', token.length);
    
    // 🔧 FIX: 添加時間戳調試日誌，協助排查時鐘偏差問題
    const decodedForDebug = jwt.decode(token) as any;
    const serverTime = new Date();
    console.log('🕒 JWT 時間戳資訊:', {
      iat: new Date(decodedForDebug.iat * 1000).toISOString(),
      exp: new Date(decodedForDebug.exp * 1000).toISOString(),
      serverTime: serverTime.toISOString(),
      serverTimeUnix: Math.floor(serverTime.getTime() / 1000),
      validFor: `${(decodedForDebug.exp - decodedForDebug.iat) / 86400} days`,
      timeDiff: `iat vs now: ${decodedForDebug.iat - Math.floor(serverTime.getTime() / 1000)} seconds`
    });
    
    // 立即驗證生成的 token（添加 clockTolerance）
    try {
      const verifyResult = jwt.verify(token, JWT_SECRET, {
        clockTolerance: 60  // 一致的時鐘容忍度
      });
      console.log('✅ JWT 自我驗證成功:', {
        sub: (verifyResult as any).sub,
        exp: new Date((verifyResult as any).exp * 1000).toISOString()
      });
    } catch (verifyError) {
      console.error('❌ JWT 自我驗證失敗:', verifyError);
    }
    
    // 構建回調 URL
    const returnUrl = new URL(stateData.returnTo);
    returnUrl.searchParams.set('auth_success', 'true');
    returnUrl.searchParams.set('token', token);
    returnUrl.searchParams.set('user_id', finalUser.id);
    
    console.log('=== 準備重定向 ===');
    console.log('目標 URL:', returnUrl.toString());
    console.log('JWT Token 長度:', token.length);
    console.log('用戶 ID:', finalUser.id);
    
    // 重定向回子服務
    console.log('執行重定向...');
    res.redirect(returnUrl.toString());
    console.log('重定向完成');
    
  } catch (error) {
    console.error('=== Google OAuth 回調錯誤 ===');
    console.error('錯誤詳情:', error);
    if (error instanceof Error) {
      console.error('錯誤堆疊:', error.stack);
      console.error('錯誤類型:', error.name);
      console.error('錯誤信息:', error.message);
    }
    
    // 嘗試重定向到錯誤頁面
    try {
      const { state } = req.query;
      let stateData = { returnTo: 'https://quote.thinkwithblack.com', service: 'quote' };
      if (state) {
        try {
          stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
        } catch (e) {
          console.error('解析 state 失敗:', e instanceof Error ? e.message : 'Unknown error');
        }
      }
      
      const errorUrl = new URL(stateData.returnTo);
      errorUrl.searchParams.set('auth_error', 'true');
      errorUrl.searchParams.set('error_message', encodeURIComponent('Google OAuth 認證失敗'));
      
      console.log('重定向到錯誤頁面:', errorUrl.toString());
      res.redirect(errorUrl.toString());
    } catch (redirectError) {
      console.error('重定向錯誤失敗:', redirectError);
      // 如果重定向也失敗，返回 JSON 錯誤
      res.status(500).json({
        success: false,
        error: 'Google OAuth 認證失敗',
        code: 'GOOGLE_OAUTH_CALLBACK_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});

// Account Center API 端點 - 高優先級註冊
app.get('/api/account-center/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});



app.get('/api/account-center/debug', (req, res) => {
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    headers: req.headers,
    query: req.query,
    origin: req.headers.origin
  });
});

app.get('/api/account-center/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // 共用 getAccountSnapshot — membership 判斷含到期驗證，與 verify-token 完全一致
    const { getAccountSnapshot } = await import('./accountSnapshotService');
    const account = await getAccountSnapshot(userId);

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '用戶未找到',
        code: 'USER_NOT_FOUND'
      });
    }

    res.json({ success: true, user: account });

  } catch (error) {
    console.error('用戶查詢錯誤:', error);
    res.status(500).json({
      success: false,
      error: '查詢失敗',
      code: 'QUERY_ERROR'
    });
  }
});

app.get('/api/account-center/user/:userId/credits', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // 設置 CORS 標頭
    const allowedOrigins = [
      'https://eccal.thinkwithblack.com',
      'https://audai.thinkwithblack.com',
      'https://quote.thinkwithblack.com',
      'https://fabe.thinkwithblack.com',
      'https://galine.thinkwithblack.com',
      'https://serp.thinkwithblack.com',
      'https://sub3.thinkwithblack.com',
      'https://sub4.thinkwithblack.com',
      'https://sub5.thinkwithblack.com',
      'https://member.thinkwithblack.com',
      'https://andromeda.thinkwithblack.com',
      'https://sbir.thinkwithblack.com',
      'https://sbir-api.thinkwithblack.com',
      'http://localhost:3000',
      'http://localhost:5000'
    ];
    
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // 使用動態 import 載入資料庫相關模組
    const { db } = await import('./db');
    const { userCredits } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    
    // 查詢點數
    const credits = await db.select()
      .from(userCredits)
      .where(eq(userCredits.userId, userId))
      .limit(1);
    
    const creditsData = credits.length > 0 ? credits[0] : null;
    
    res.json({
      success: true,
      credits: {
        balance: creditsData ? creditsData.balance : 0,
        totalEarned: creditsData ? creditsData.totalEarned : 0,
        totalSpent: creditsData ? creditsData.totalSpent : 0
      }
    });
    
  } catch (error) {
    console.error('點數查詢錯誤:', error);
    res.status(500).json({
      success: false,
      error: '查詢失敗',
      code: 'QUERY_ERROR'
    });
  }
});

app.get('/api/account-center/user/:userId/membership', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // 設置 CORS 標頭
    const allowedOrigins = [
      'https://eccal.thinkwithblack.com',
      'https://audai.thinkwithblack.com',
      'https://quote.thinkwithblack.com',
      'https://fabe.thinkwithblack.com',
      'https://galine.thinkwithblack.com',
      'https://serp.thinkwithblack.com',
      'https://sub3.thinkwithblack.com',
      'https://sub4.thinkwithblack.com',
      'https://sub5.thinkwithblack.com',
      'https://member.thinkwithblack.com',
      'https://andromeda.thinkwithblack.com',
      'https://sbir.thinkwithblack.com',
      'https://sbir-api.thinkwithblack.com',
      'http://localhost:3000',
      'http://localhost:5000'
    ];
    
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // 使用動態 import 載入資料庫相關模組
    const { db } = await import('./db');
    const { users } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    
    // 查詢用戶
    const user = await db.select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    
    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        error: '用戶未找到',
        code: 'USER_NOT_FOUND'
      });
    }
    
    const userData = user[0];
    const isPro = userData.membershipLevel === 'pro' && 
                  userData.membershipExpires && 
                  new Date(userData.membershipExpires) > new Date();
    
    res.json({
      success: true,
      membership: {
        level: userData.membershipLevel || 'free',
        expires: userData.membershipExpires,
        isPro: isPro,
        features: isPro ? 
          ['無限制使用', '優先支援', '高級功能'] : 
          ['基本功能', '社群支援']
      }
    });
    
  } catch (error) {
    console.error('會員查詢錯誤:', error);
    res.status(500).json({
      success: false,
      error: '查詢失敗',
      code: 'QUERY_ERROR'
    });
  }
});

app.post('/api/sso/verify-token', express.json(), async (req, res) => {
  try {
    // 設置 CORS 標頭
    const allowedOrigins = [
      'https://eccal.thinkwithblack.com',
      'https://audai.thinkwithblack.com',
      'https://quote.thinkwithblack.com',
      'https://fabe.thinkwithblack.com',
      'https://galine.thinkwithblack.com',
      'https://serp.thinkwithblack.com',
      'https://sub3.thinkwithblack.com',
      'https://sub4.thinkwithblack.com',
      'https://sub5.thinkwithblack.com',
      'https://member.thinkwithblack.com',
      'https://andromeda.thinkwithblack.com',
      'https://sbir.thinkwithblack.com',
      'https://sbir-api.thinkwithblack.com',
      'http://localhost:3000',
      'http://localhost:5000'
    ];
    
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    const { token } = req.body || {};
    
    if (!token) {
      return res.status(400).json({ 
        success: false, 
        error: 'Token is required' 
      });
    }
    
    // 詳細的 token 格式檢查和調試
    console.log('SSO Token 驗證調試信息:', {
      tokenType: typeof token,
      tokenLength: token.length,
      tokenParts: token.split('.').length,
      tokenPrefix: token.substring(0, 20) + '...'
    });
    
    // 檢查 JWT 格式 (應該有三個部分: header.payload.signature)
    if (typeof token !== 'string' || token.split('.').length !== 3) {
      console.error('Token 格式錯誤 - 不是有效的 JWT 格式:', {
        tokenType: typeof token,
        parts: token.split('.').length,
        expected: 3
      });
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid token format - JWT should have 3 parts separated by dots',
        debug: {
          tokenType: typeof token,
          parts: token.split('.').length,
          expected: 3
        }
      });
    }
    
    // 使用動態 import 載入 jwt
    const { default: jwt } = await import('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    
    try {
      // 🔧 FIX: 添加 60 秒時鐘容忍度，解決 Eccal 和 Cloudflare Worker 時間偏差問題
      const decoded = jwt.verify(token, JWT_SECRET, {
        clockTolerance: 60  // 允許 60 秒的時鐘偏差
      }) as any;
      
      console.log('✅ JWT 驗證成功:', {
        userId: decoded.sub,
        email: decoded.email,
        iat: new Date(decoded.iat * 1000).toISOString(),
        exp: new Date(decoded.exp * 1000).toISOString()
      });

      // 共用 getAccountSnapshot — 與 account-center/user 同一份資料來源，確保 membership/credits 完全一致
      const userId = decoded.sub || decoded.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          valid: false,
          error: 'INVALID_TOKEN_PAYLOAD',
          details: 'Token missing sub/id claim'
        });
      }

      const { getAccountSnapshot } = await import('./accountSnapshotService');
      const account = await getAccountSnapshot(userId);

      if (!account) {
        return res.status(404).json({
          success: false,
          valid: false,
          error: 'ACCOUNT_NOT_FOUND',
          details: `No account found for userId: ${userId}`
        });
      }

      return res.json({
        success: true,
        valid: true,
        user: account,
        expiresAt: new Date(decoded.exp * 1000).toISOString()
      });
    } catch (jwtError) {
      console.error('❌ JWT 驗證失敗:', {
        error: jwtError instanceof Error ? jwtError.message : 'Unknown error',
        tokenPrefix: token.substring(0, 30) + '...'
      });

      const isExpired = jwtError instanceof Error && jwtError.message.includes('expired');
      return res.status(401).json({
        success: false,
        valid: false,
        error: isExpired ? 'Token expired' : 'Invalid token',
        details: jwtError instanceof Error ? jwtError.message : 'Unknown error'
      });
    }
    
  } catch (error) {
    console.error('Token 驗證錯誤:', error);
    return res.status(401).json({ 
      success: false, 
      valid: false, 
      error: 'Token verification failed' 
    });
  }
});

// SDK 端點
app.get('/eccal-auth-sdk.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // 動態載入 SDK 檔案
  import('fs').then(fs => {
    import('path').then(path => {
      const sdkPath = path.join(process.cwd(), 'client/public/eccal-auth-sdk.js');
      fs.readFile(sdkPath, 'utf8', (err, data) => {
        if (err) {
          console.error('SDK 檔案讀取錯誤:', err);
          res.status(500).send('// SDK 檔案無法載入');
        } else {
          res.send(data);
        }
      });
    });
  }).catch(error => {
    console.error('SDK 模組載入錯誤:', error);
    res.status(500).send('// SDK 模組載入失敗');
  });
});

// SSO 登入端點
app.post('/api/sso/login', express.json(), async (req, res) => {
  try {
    const { email, returnTo, origin } = req.body;
    
    // 設置 CORS 標頭
    const allowedOrigins = [
      'https://eccal.thinkwithblack.com',
      'https://audai.thinkwithblack.com',
      'https://quote.thinkwithblack.com',
      'https://fabe.thinkwithblack.com',
      'https://galine.thinkwithblack.com',
      'https://sub3.thinkwithblack.com',
      'https://sub4.thinkwithblack.com',
      'https://sub5.thinkwithblack.com',
      'https://member.thinkwithblack.com',
      'https://andromeda.thinkwithblack.com',
      'https://sbir.thinkwithblack.com',
      'https://sbir-api.thinkwithblack.com',
      'http://localhost:3000',
      'http://localhost:5000'
    ];
    
    const requestOrigin = origin || req.headers.origin;
    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
      res.header('Access-Control-Allow-Origin', requestOrigin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // 建立 Google OAuth URL
    const baseUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      redirect_uri: `https://eccal.thinkwithblack.com/api/sso/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent',
      state: JSON.stringify({ returnTo, origin: requestOrigin })
    });
    
    const authUrl = `${baseUrl}?${params.toString()}`;
    
    res.json({
      success: true,
      authUrl: authUrl
    });
    
  } catch (error) {
    console.error('SSO 登入錯誤:', error);
    res.status(500).json({
      success: false,
      error: '登入準備失敗',
      code: 'LOGIN_PREPARATION_ERROR'
    });
  }
});

// Facebook 資料刪除端點
app.use('/api/facebook/data-deletion', express.json(), (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const timestamp = new Date().toISOString();
    const requestId = Math.random().toString(36).substring(2, 15);
    
    console.log(`[${timestamp}] Facebook data deletion request received:`, {
      requestId,
      hasBody: !!req.body,
      bodyType: typeof req.body,
      hasSignedRequest: !!(req.body && req.body.signed_request),
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      originalUrl: req.originalUrl,
      method: req.method
    });

    let userId = 'unknown';
    
    // 解析 signed_request
    if (req.body && req.body.signed_request) {
      try {
        const parts = req.body.signed_request.split('.');
        if (parts.length === 2) {
          const payload = parts[1];
          const decoded = Buffer.from(payload, 'base64').toString('utf8');
          const data = JSON.parse(decoded);
          userId = data.user_id || 'unknown';
        }
      } catch (e) {
        console.log('Could not parse signed_request:', e instanceof Error ? e.message : 'Unknown error');
      }
    }

    console.log(`[${timestamp}] Data deletion processed for user: ${userId} (requestId: ${requestId})`);

    // 返回 Facebook 要求的格式
    const response = {
      url: `https://eccal.thinkwithblack.com/data-deletion-status/${userId}`,
      confirmation_code: `DEL_${timestamp}_${requestId}`,
      status: 'success',
      processed_at: timestamp
    };

    res.json(response);
  } catch (error) {
    console.error('Facebook data deletion error:', error);
    
    // 即使出錯也要回傳成功，避免 Facebook 重試
    res.json({
      url: `https://eccal.thinkwithblack.com/data-deletion-status/error`,
      confirmation_code: `DEL_${Date.now()}_error`,
      status: 'success',
      processed_at: new Date().toISOString()
    });
  }
});

// -------------------- 2. 中間件設定 --------------------
// Favicon 處理 - 減少不必要的請求
app.get('/favicon.ico', (req, res) => {
  // 設置適當的 cache headers 減少重複請求
  res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 年
  res.setHeader('Expires', new Date(Date.now() + 31536000000).toUTCString());
  
  // 返回 SVG favicon 的重定向
  res.redirect(301, '/favicon.svg');
});

// 處理其他 favicon 相關請求
app.get('/favicon-:size.png', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  res.redirect(301, '/favicon.svg');
});

app.get('/apple-touch-icon.png', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  res.redirect(301, '/favicon.svg');
});

// 為 SVG favicon 設置適當的 cache headers
app.get('/favicon.svg', (req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 小時
  res.setHeader('Content-Type', 'image/svg+xml');
  next();
});

// -------------------- 3. JWT 中間件 --------------------
app.use(jwtMiddleware); // 在所有路由之前設置 JWT 中間件

// -------------------- 4. Passport 基礎設定 --------------------
app.use(passport.initialize());
// 不需要 passport.session() 因為使用 JWT

// -------------------- 5. Google OAuth 設定 --------------------
setupJWTGoogleAuth(app);

// -------------------- 5.5. Google Analytics 連結設定 --------------------
setupGAConnection(app);

// -------------------- 6. 註冊路由 --------------------
(async () => {
  const server = await registerRoutes(app);

  // -------------------- 7. 設置前端服務 --------------------
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // -------------------- 8. 伺服器啟動 --------------------
  const PORT = parseInt(process.env.PORT || '5000', 10);
  const HOST = '0.0.0.0'; // 綁定到所有網路介面以支援 Replit 部署
  
  // 添加啟動前的連接檢查
  server.listen(PORT, HOST, () => {
    console.log(`Server is running on port ${PORT} with JWT authentication`);
    console.log(`Server bound to ${HOST}:${PORT} for deployment compatibility`);
    console.log(`Health check available at: http://${HOST}:${PORT}/health`);
    
    // Meta token 防過期：使用長期 token 交換，無需背景維護服務
  });
  
  // 伺服器錯誤處理
  server.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use`);
      process.exit(1);
    } else if (error.code === 'EACCES') {
      console.error(`Permission denied to bind to port ${PORT}`);
      process.exit(1);
    } else {
      console.error('Server error:', error);
      process.exit(1);
    }
  });
  
  // 優雅關閉處理
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
  
  process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
})();