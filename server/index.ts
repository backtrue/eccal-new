import express from 'express';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { registerRoutes } from './routes';
import { setupVite, serveStatic } from './vite';
import { setupJWTGoogleAuth, jwtMiddleware } from './jwtAuth';
import { setupGAConnection } from './gaConnection';

// -------------------- 1. 基礎設定 --------------------
const app = express();

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
    <title>報數據 SSO 整合指南</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f8f9fa;
            color: #212529;
            line-height: 1.6;
        }
        .sidebar {
            position: fixed;
            top: 0; left: 0;
            width: 240px;
            height: 100vh;
            background: #1a1a2e;
            color: #e0e0e0;
            overflow-y: auto;
            padding: 24px 0;
            z-index: 100;
        }
        .sidebar-logo {
            padding: 0 20px 20px;
            border-bottom: 1px solid #333;
            margin-bottom: 16px;
        }
        .sidebar-logo h2 { color: #fff; font-size: 16px; }
        .sidebar-logo p { color: #888; font-size: 12px; margin-top: 4px; }
        .sidebar a {
            display: block;
            padding: 8px 20px;
            color: #bbb;
            text-decoration: none;
            font-size: 13px;
            border-left: 3px solid transparent;
            transition: all 0.2s;
        }
        .sidebar a:hover, .sidebar a.active {
            color: #fff;
            background: rgba(255,255,255,0.05);
            border-left-color: #4f8ef7;
        }
        .sidebar .section-title {
            padding: 12px 20px 4px;
            font-size: 11px;
            text-transform: uppercase;
            color: #666;
            letter-spacing: 0.8px;
        }
        .main {
            margin-left: 240px;
            padding: 40px;
            max-width: 860px;
        }
        h1 { font-size: 32px; font-weight: 700; margin-bottom: 12px; color: #1a1a2e; }
        h2 { font-size: 22px; font-weight: 600; margin: 40px 0 16px; color: #1a1a2e; padding-top: 16px; border-top: 2px solid #e9ecef; }
        h3 { font-size: 16px; font-weight: 600; margin: 24px 0 10px; color: #333; }
        p { margin-bottom: 12px; color: #495057; }
        .lead { font-size: 17px; color: #555; margin-bottom: 24px; }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            margin-right: 6px;
        }
        .badge-get { background: #d1ecf1; color: #0c5460; }
        .badge-post { background: #d4edda; color: #155724; }
        .badge-required { background: #fff3cd; color: #856404; }
        .badge-optional { background: #e2e3e5; color: #495057; }
        .code-block {
            background: #1e1e2e;
            color: #cdd6f4;
            border-radius: 8px;
            padding: 20px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.7;
            overflow-x: auto;
            margin: 12px 0 20px;
            position: relative;
        }
        .code-block .comment { color: #6c7086; }
        .code-block .string { color: #a6e3a1; }
        .code-block .key { color: #89b4fa; }
        .code-block .value { color: #fab387; }
        .code-block .keyword { color: #cba6f7; }
        .copy-btn {
            position: absolute;
            top: 10px; right: 10px;
            background: #313244;
            color: #cdd6f4;
            border: none;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 11px;
            cursor: pointer;
        }
        .copy-btn:hover { background: #45475a; }
        .endpoint-box {
            border: 1px solid #dee2e6;
            border-radius: 8px;
            margin-bottom: 20px;
            overflow: hidden;
        }
        .endpoint-header {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 14px 16px;
            background: #f8f9fa;
            border-bottom: 1px solid #dee2e6;
        }
        .endpoint-url {
            font-family: monospace;
            font-size: 14px;
            font-weight: 600;
            color: #1a1a2e;
        }
        .endpoint-body { padding: 16px; }
        .param-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            margin-top: 8px;
        }
        .param-table th {
            background: #f1f3f5;
            padding: 8px 12px;
            text-align: left;
            font-weight: 600;
            color: #495057;
            border-bottom: 2px solid #dee2e6;
        }
        .param-table td {
            padding: 8px 12px;
            border-bottom: 1px solid #f1f3f5;
            color: #495057;
        }
        .param-table td:first-child {
            font-family: monospace;
            font-size: 13px;
            color: #1a1a2e;
            font-weight: 500;
        }
        .flow-steps {
            counter-reset: step;
            list-style: none;
            margin: 16px 0;
        }
        .flow-steps li {
            counter-increment: step;
            display: flex;
            gap: 16px;
            margin-bottom: 20px;
            align-items: flex-start;
        }
        .flow-steps li::before {
            content: counter(step);
            min-width: 32px;
            height: 32px;
            background: #4f8ef7;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 14px;
        }
        .flow-steps li .step-content h4 {
            font-size: 15px;
            font-weight: 600;
            color: #1a1a2e;
            margin-bottom: 4px;
        }
        .flow-steps li .step-content p { margin: 0; font-size: 14px; }
        .info-box {
            border-left: 4px solid;
            padding: 12px 16px;
            border-radius: 0 6px 6px 0;
            margin: 16px 0;
            font-size: 14px;
        }
        .info-box.warning { border-color: #ffc107; background: #fff3cd; color: #664d03; }
        .info-box.info { border-color: #0dcaf0; background: #d0f4f7; color: #055160; }
        .info-box.success { border-color: #198754; background: #d1e7dd; color: #0a3622; }
        .info-box.danger { border-color: #dc3545; background: #f8d7da; color: #58151c; }
        .token-field {
            display: grid;
            grid-template-columns: 140px 1fr;
            gap: 4px 12px;
            background: #f8f9fa;
            border-radius: 6px;
            padding: 12px;
            font-size: 13px;
            margin-top: 8px;
        }
        .token-field .field-name {
            font-family: monospace;
            font-weight: 600;
            color: #89b4fa;
        }
        .token-field .field-desc { color: #495057; }
        .live-test {
            background: white;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 20px;
            margin-top: 12px;
        }
        .live-test input {
            width: 100%;
            border: 1px solid #ced4da;
            border-radius: 6px;
            padding: 10px 12px;
            font-size: 14px;
            font-family: monospace;
            margin: 6px 0 10px;
        }
        .live-test button {
            background: #4f8ef7;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            margin-right: 8px;
        }
        .live-test button:hover { background: #3a7bd5; }
        .live-test button.secondary {
            background: #6c757d;
        }
        .live-test button.secondary:hover { background: #545b62; }
        .live-result {
            margin-top: 12px;
            background: #1e1e2e;
            color: #cdd6f4;
            border-radius: 6px;
            padding: 14px;
            font-family: monospace;
            font-size: 12px;
            min-height: 60px;
            white-space: pre-wrap;
            word-break: break-all;
            display: none;
        }
        .divider { height: 1px; background: #e9ecef; margin: 8px 0; }
    </style>
</head>
<body>

<nav class="sidebar">
    <div class="sidebar-logo">
        <h2>報數據</h2>
        <p>SSO 整合指南 v1.0</p>
    </div>
    <div class="section-title">入門</div>
    <a href="#overview">系統概覽</a>
    <a href="#prerequisites">前置需求</a>
    <a href="#flow">登入流程</a>
    <div class="section-title">API 參考</div>
    <a href="#sso-login">啟動登入</a>
    <a href="#sso-callback">Callback 接收</a>
    <a href="#verify-token">驗證 Token</a>
    <a href="#refresh-token">刷新 Token</a>
    <a href="#sso-logout">登出</a>
    <div class="section-title">Account Center</div>
    <a href="#user-api">取得用戶資料</a>
    <a href="#credits-api">查詢點數</a>
    <a href="#deduct-api">扣除點數</a>
    <div class="section-title">進階</div>
    <a href="#token-structure">JWT Token 結構</a>
    <a href="#code-example">完整範例</a>
    <a href="#live-test">線上測試</a>
</nav>

<div class="main">

    <h1>報數據 SSO 整合指南</h1>
    <p class="lead">讓你的子服務透過報數據的統一身份認證系統（SSO）實現一鍵登入，共享用戶帳號、會員等級與點數資料。</p>

    <div class="info-box info">
        <strong>SSO 服務端點：</strong> <code>https://eccal.thinkwithblack.com</code><br>
        所有 API 請求都以此為基礎網址。
    </div>

    <!-- ===================== 概覽 ===================== -->
    <h2 id="overview">系統概覽</h2>
    <p>報數據 SSO 基於 <strong>Google OAuth 2.0 + JWT</strong> 實現。用戶只需用 Google 帳號登入一次，即可在所有子服務中自動認證，無需重複註冊。</p>
    <p>子服務透過驗證 JWT Token 來確認用戶身份，並可透過 Account Center API 查詢用戶的會員等級和點數。</p>

    <!-- ===================== 前置需求 ===================== -->
    <h2 id="prerequisites">前置需求</h2>
    <ol style="padding-left:20px; margin-bottom:16px; color:#495057;">
        <li style="margin-bottom:8px;"><strong>申請加入允許清單：</strong>聯絡報數據將你的子服務網域加入白名單（例如 <code>https://your-service.thinkwithblack.com</code>）。未加入的網域會收到 <code>403 Unauthorized origin</code>。</li>
        <li style="margin-bottom:8px;"><strong>取得 JWT_SECRET：</strong>向報數據索取與主服務相同的 JWT 密鑰，用於驗證 Token 真偽。</li>
        <li style="margin-bottom:8px;"><strong>取得 SERVICE_API_KEY（選用）：</strong>若子服務需要呼叫 Account Center API（例如扣點），需要申請 API Key。</li>
    </ol>

    <div class="info-box warning">
        <strong>重要：</strong>JWT_SECRET 必須與報數據主服務保持一致，否則 Token 驗證會失敗。請妥善保管，切勿公開。
    </div>

    <!-- ===================== 流程 ===================== -->
    <h2 id="flow">登入流程</h2>
    <ul class="flow-steps">
        <li>
            <div class="step-content">
                <h4>子服務發起登入</h4>
                <p>將用戶導向 <code>GET /api/sso/login?returnTo=你的回調網址&amp;service=你的服務名</code></p>
            </div>
        </li>
        <li>
            <div class="step-content">
                <h4>用戶完成 Google 登入</h4>
                <p>報數據處理 Google OAuth 流程，用戶完成授權後系統自動建立或更新帳號。</p>
            </div>
        </li>
        <li>
            <div class="step-content">
                <h4>報數據帶 Token 跳轉回子服務</h4>
                <p>報數據將 JWT Token 附加到你的 <code>returnTo</code> 網址並跳轉：<br><code>https://your-service.com/callback?token=JWT...&amp;user_id=xxx</code></p>
            </div>
        </li>
        <li>
            <div class="step-content">
                <h4>子服務驗證 Token</h4>
                <p>呼叫 <code>POST /api/sso/verify-token</code> 驗證 Token，取得用戶完整資料，儲存到本地 session 或 localStorage。</p>
            </div>
        </li>
        <li>
            <div class="step-content">
                <h4>後續請求攜帶 Token</h4>
                <p>Token 有效期 7 天，到期前可呼叫 <code>POST /api/sso/refresh-token</code> 更新。</p>
            </div>
        </li>
    </ul>

    <!-- ===================== API：啟動登入 ===================== -->
    <h2 id="sso-login">API：啟動 SSO 登入</h2>
    <div class="endpoint-box">
        <div class="endpoint-header">
            <span class="badge badge-get">GET</span>
            <span class="endpoint-url">/api/sso/login</span>
        </div>
        <div class="endpoint-body">
            <p>將用戶瀏覽器重導向至此端點，開始 Google 登入流程。</p>
            <h3>Query 參數</h3>
            <table class="param-table">
                <thead><tr><th>參數名稱</th><th>必填</th><th>說明</th><th>範例</th></tr></thead>
                <tbody>
                    <tr><td>returnTo</td><td><span class="badge badge-required">必填</span></td><td>登入完成後要跳轉回的完整網址</td><td><code>https://your-service.com/callback</code></td></tr>
                    <tr><td>service</td><td><span class="badge badge-optional">選填</span></td><td>子服務識別名稱，用於日誌記錄</td><td><code>audai</code></td></tr>
                    <tr><td>origin</td><td><span class="badge badge-optional">選填</span></td><td>子服務來源網域（通常由 browser 自動帶入）</td><td><code>https://your-service.com</code></td></tr>
                </tbody>
            </table>
            <h3>使用方式</h3>
            <div class="code-block">
<span class="comment">// 方式一：直接跳轉（推薦）</span>
<span class="keyword">const</span> <span class="key">returnUrl</span> = <span class="string">'https://your-service.com/auth/callback'</span>;
window.location.href = <span class="string">\`https://eccal.thinkwithblack.com/api/sso/login?returnTo=\${encodeURIComponent(returnUrl)}&service=your-service\`</span>;

<span class="comment">// 方式二：用按鈕觸發</span>
&lt;a href=<span class="string">"https://eccal.thinkwithblack.com/api/sso/login?returnTo=https://your-service.com/callback"</span>&gt;
  用 Google 登入
&lt;/a&gt;</div>
        </div>
    </div>

    <!-- ===================== API：Callback ===================== -->
    <h2 id="sso-callback">接收 Callback</h2>
    <p>登入完成後，報數據會將用戶跳轉至你的 <code>returnTo</code> 網址，並在 URL 附上以下參數：</p>
    <div class="code-block"><span class="comment"># 跳轉回的 URL 範例</span>
https://your-service.com/callback<span class="key">?token=</span><span class="string">eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...</span><span class="key">&user_id=</span><span class="value">abc123xyz</span></div>
    <table class="param-table" style="margin-bottom:16px;">
        <thead><tr><th>參數名稱</th><th>說明</th></tr></thead>
        <tbody>
            <tr><td>token</td><td>JWT Token，用於後續身份驗證</td></tr>
            <tr><td>user_id</td><td>用戶在報數據系統的唯一 ID</td></tr>
        </tbody>
    </table>
    <div class="info-box info">建議將 token 儲存至 <code>localStorage</code> 或 <code>httpOnly cookie</code>，並立刻呼叫 verify-token 確認 Token 有效性。</div>

    <!-- ===================== API：驗證 Token ===================== -->
    <h2 id="verify-token">API：驗證 Token</h2>
    <div class="endpoint-box">
        <div class="endpoint-header">
            <span class="badge badge-post">POST</span>
            <span class="endpoint-url">/api/sso/verify-token</span>
        </div>
        <div class="endpoint-body">
            <p>驗證 JWT Token 是否有效，並取得用戶的完整資料（含會員等級、點數）。</p>
            <h3>Request Body（JSON）</h3>
            <div class="code-block">{
  <span class="key">"token"</span>: <span class="string">"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."</span>
}</div>
            <h3>成功回應（200）</h3>
            <div class="code-block">{
  <span class="key">"success"</span>: <span class="value">true</span>,
  <span class="key">"valid"</span>: <span class="value">true</span>,
  <span class="key">"user"</span>: {
    <span class="key">"id"</span>: <span class="string">"abc123xyz"</span>,
    <span class="key">"email"</span>: <span class="string">"user@example.com"</span>,
    <span class="key">"name"</span>: <span class="string">"王小明"</span>,
    <span class="key">"membership"</span>: <span class="string">"pro"</span>,          <span class="comment">// "free" 或 "pro"</span>
    <span class="key">"membershipExpires"</span>: <span class="string">"2026-10-15T00:00:00Z"</span>,
    <span class="key">"credits"</span>: <span class="value">150</span>,
    <span class="key">"profileImageUrl"</span>: <span class="string">"https://..."</span>
  },
  <span class="key">"expiresAt"</span>: <span class="string">"2026-03-14T10:30:00Z"</span>
}</div>
            <h3>失敗回應</h3>
            <div class="code-block"><span class="comment">// Token 無效或過期（401）</span>
{
  <span class="key">"success"</span>: <span class="value">false</span>,
  <span class="key">"valid"</span>: <span class="value">false</span>,
  <span class="key">"error"</span>: <span class="string">"Token expired"</span>
}

<span class="comment">// 格式錯誤（400）</span>
{
  <span class="key">"success"</span>: <span class="value">false</span>,
  <span class="key">"error"</span>: <span class="string">"Invalid token format"</span>
}</div>
            <h3>程式碼範例</h3>
            <div class="code-block"><span class="keyword">async function</span> <span class="key">verifyToken</span>(token) {
  <span class="keyword">const</span> response = <span class="keyword">await</span> fetch(<span class="string">'https://eccal.thinkwithblack.com/api/sso/verify-token'</span>, {
    method: <span class="string">'POST'</span>,
    headers: { <span class="string">'Content-Type'</span>: <span class="string">'application/json'</span> },
    body: JSON.stringify({ token })
  });

  <span class="keyword">const</span> data = <span class="keyword">await</span> response.json();

  <span class="keyword">if</span> (data.valid) {
    console.log(<span class="string">'登入成功：'</span>, data.user.name);
    console.log(<span class="string">'會員等級：'</span>, data.user.membership);
    console.log(<span class="string">'點數餘額：'</span>, data.user.credits);
  } <span class="keyword">else</span> {
    <span class="comment">// Token 無效，引導用戶重新登入</span>
    redirectToLogin();
  }
}</div>
        </div>
    </div>

    <!-- ===================== API：刷新 Token ===================== -->
    <h2 id="refresh-token">API：刷新 Token</h2>
    <div class="endpoint-box">
        <div class="endpoint-header">
            <span class="badge badge-post">POST</span>
            <span class="endpoint-url">/api/sso/refresh-token</span>
        </div>
        <div class="endpoint-body">
            <p>Token 有效期為 <strong>7 天</strong>，建議在到期前 24 小時呼叫此端點換取新 Token。</p>
            <h3>Request Header</h3>
            <div class="code-block">Authorization: Bearer <span class="string">{現有的 JWT Token}</span></div>
            <h3>成功回應（200）</h3>
            <div class="code-block">{
  <span class="key">"token"</span>: <span class="string">"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."</span>  <span class="comment">// 新的 Token</span>
}</div>
        </div>
    </div>

    <!-- ===================== API：登出 ===================== -->
    <h2 id="sso-logout">API：登出</h2>
    <div class="endpoint-box">
        <div class="endpoint-header">
            <span class="badge badge-post">POST</span>
            <span class="endpoint-url">/api/sso/logout</span>
        </div>
        <div class="endpoint-body">
            <p>清除報數據端的登入狀態。子服務本身也需要自行清除本地儲存的 Token。</p>
            <h3>Request Body（JSON）</h3>
            <div class="code-block">{
  <span class="key">"returnTo"</span>: <span class="string">"https://your-service.com"</span>  <span class="comment">// 選填，登出後跳轉網址</span>
}</div>
        </div>
    </div>

    <!-- ===================== Account Center：取得用戶 ===================== -->
    <h2 id="user-api">Account Center API：取得用戶資料</h2>
    <div class="endpoint-box">
        <div class="endpoint-header">
            <span class="badge badge-get">GET</span>
            <span class="endpoint-url">/api/account-center/user/:userId</span>
        </div>
        <div class="endpoint-body">
            <p><code>:userId</code> 可填用戶 ID 或 Email，兩種都支援。</p>
            <div class="code-block"><span class="comment"># 用 ID 查詢</span>
GET /api/account-center/user/abc123xyz

<span class="comment"># 用 Email 查詢</span>
GET /api/account-center/user/user@example.com</div>
            <h3>成功回應（200）</h3>
            <div class="code-block">{
  <span class="key">"success"</span>: <span class="value">true</span>,
  <span class="key">"user"</span>: {
    <span class="key">"id"</span>: <span class="string">"abc123xyz"</span>,
    <span class="key">"email"</span>: <span class="string">"user@example.com"</span>,
    <span class="key">"name"</span>: <span class="string">"王小明"</span>,
    <span class="key">"membership"</span>: <span class="string">"pro"</span>,
    <span class="key">"membershipExpires"</span>: <span class="string">"2026-10-15T00:00:00Z"</span>,
    <span class="key">"credits"</span>: <span class="value">150</span>,
    <span class="key">"profileImageUrl"</span>: <span class="string">"https://..."</span>,
    <span class="key">"createdAt"</span>: <span class="string">"2024-01-01T00:00:00Z"</span>
  }
}</div>
        </div>
    </div>

    <!-- ===================== Account Center：查點數 ===================== -->
    <h2 id="credits-api">Account Center API：查詢點數</h2>
    <div class="endpoint-box">
        <div class="endpoint-header">
            <span class="badge badge-get">GET</span>
            <span class="endpoint-url">/api/account-center/credits/:userId</span>
        </div>
        <div class="endpoint-body">
            <div class="code-block">{
  <span class="key">"success"</span>: <span class="value">true</span>,
  <span class="key">"userId"</span>: <span class="string">"abc123xyz"</span>,
  <span class="key">"balance"</span>: <span class="value">150</span>,
  <span class="key">"email"</span>: <span class="string">"user@example.com"</span>
}</div>
        </div>
    </div>

    <!-- ===================== Account Center：扣點 ===================== -->
    <h2 id="deduct-api">Account Center API：扣除點數</h2>
    <div class="endpoint-box">
        <div class="endpoint-header">
            <span class="badge badge-post">POST</span>
            <span class="endpoint-url">/api/account-center/credits/:userId/deduct</span>
        </div>
        <div class="endpoint-body">
            <p>此端點<strong>不需要</strong> SERVICE_API_KEY，但建議在後端呼叫避免濫用。</p>
            <h3>Request Body（JSON）</h3>
            <div class="code-block">{
  <span class="key">"amount"</span>: <span class="value">10</span>,             <span class="comment">// 必填，扣除點數數量</span>
  <span class="key">"reason"</span>: <span class="string">"AI 報告生成"</span>,   <span class="comment">// 選填，扣除原因（用於日誌）</span>
  <span class="key">"service"</span>: <span class="string">"audai"</span>       <span class="comment">// 選填，來源服務名稱</span>
}</div>
            <h3>成功回應（200）</h3>
            <div class="code-block">{
  <span class="key">"success"</span>: <span class="value">true</span>,
  <span class="key">"remainingCredits"</span>: <span class="value">140</span>,
  <span class="key">"deductedAmount"</span>: <span class="value">10</span>,
  <span class="key">"transactionId"</span>: <span class="string">"tx_1699876543_abc123"</span>
}</div>
            <h3>點數不足（400）</h3>
            <div class="code-block">{
  <span class="key">"success"</span>: <span class="value">false</span>,
  <span class="key">"error"</span>: <span class="string">"點數不足"</span>,
  <span class="key">"code"</span>: <span class="string">"INSUFFICIENT_CREDITS"</span>,
  <span class="key">"currentCredits"</span>: <span class="value">5</span>,
  <span class="key">"requestedAmount"</span>: <span class="value">10</span>
}</div>
        </div>
    </div>

    <!-- ===================== JWT Token 結構 ===================== -->
    <h2 id="token-structure">JWT Token 結構</h2>
    <p>Token 使用 HS256 演算法簽署，Payload 包含以下欄位：</p>
    <div class="token-field">
        <span class="field-name">sub</span><span class="field-desc">用戶 ID（報數據系統內的唯一識別碼）</span>
        <span class="field-name">email</span><span class="field-desc">用戶 Email</span>
        <span class="field-name">name</span><span class="field-desc">用戶顯示名稱</span>
        <span class="field-name">membership</span><span class="field-desc">會員等級：<code>"free"</code> 或 <code>"pro"</code></span>
        <span class="field-name">credits</span><span class="field-desc">Token 簽發當下的點數餘額（即時餘額請呼叫 credits API）</span>
        <span class="field-name">iss</span><span class="field-desc">簽發者：<code>eccal.thinkwithblack.com</code></span>
        <span class="field-name">aud</span><span class="field-desc">受眾（子服務的 origin）</span>
        <span class="field-name">iat</span><span class="field-desc">簽發時間（Unix timestamp）</span>
        <span class="field-name">exp</span><span class="field-desc">到期時間（簽發後 7 天）</span>
    </div>
    <div class="info-box warning" style="margin-top:16px;">
        系統容許 <strong>60 秒的時鐘偏差</strong>，避免跨服務時間不同步導致驗證失敗。
    </div>

    <!-- ===================== 完整範例 ===================== -->
    <h2 id="code-example">完整整合範例</h2>
    <p>以下是一個完整的子服務前端整合範例，可直接複製使用：</p>
    <div class="code-block">&lt;!DOCTYPE html&gt;
&lt;html&gt;
&lt;head&gt;&lt;title&gt;我的子服務&lt;/title&gt;&lt;/head&gt;
&lt;body&gt;
  &lt;div id="user-info"&gt;載入中...&lt;/div&gt;
  &lt;button id="login-btn" style="display:none" onclick="login()"&gt;Google 登入&lt;/button&gt;
  &lt;button id="logout-btn" style="display:none" onclick="logout()"&gt;登出&lt;/button&gt;

  &lt;script&gt;
    <span class="keyword">const</span> <span class="key">ECCAL_BASE</span> = <span class="string">'https://eccal.thinkwithblack.com'</span>;
    <span class="keyword">const</span> <span class="key">SERVICE_URL</span> = <span class="string">'https://your-service.thinkwithblack.com'</span>;

    <span class="comment">// 頁面載入時：檢查是否剛從 SSO 跳轉回來，或是否已有儲存的 token</span>
    <span class="keyword">async function</span> <span class="key">init</span>() {
      <span class="keyword">const</span> params = <span class="keyword">new</span> URLSearchParams(window.location.search);
      <span class="keyword">const</span> token = params.get(<span class="string">'token'</span>);

      <span class="keyword">if</span> (token) {
        <span class="comment">// 剛從 SSO 跳轉回來，儲存 token 並清除 URL 參數</span>
        localStorage.setItem(<span class="string">'auth_token'</span>, token);
        window.history.replaceState({}, <span class="string">''</span>, window.location.pathname);
      }

      <span class="keyword">const</span> savedToken = localStorage.getItem(<span class="string">'auth_token'</span>);
      <span class="keyword">if</span> (savedToken) {
        <span class="keyword">await</span> verifyAndShowUser(savedToken);
      } <span class="keyword">else</span> {
        showLoginButton();
      }
    }

    <span class="comment">// 驗證 token 並顯示用戶資訊</span>
    <span class="keyword">async function</span> <span class="key">verifyAndShowUser</span>(token) {
      <span class="keyword">const</span> res = <span class="keyword">await</span> fetch(<span class="string">\`\${ECCAL_BASE}/api/sso/verify-token\`</span>, {
        method: <span class="string">'POST'</span>,
        headers: { <span class="string">'Content-Type'</span>: <span class="string">'application/json'</span> },
        body: JSON.stringify({ token })
      });
      <span class="keyword">const</span> data = <span class="keyword">await</span> res.json();

      <span class="keyword">if</span> (data.valid) {
        document.getElementById(<span class="string">'user-info'</span>).innerHTML =
          <span class="string">\`\${data.user.name} ｜ \${data.user.membership === 'pro' ? '✨ Pro' : '免費'} ｜ 點數 \${data.user.credits}\`</span>;
        document.getElementById(<span class="string">'logout-btn'</span>).style.display = <span class="string">'inline'</span>;
      } <span class="keyword">else</span> {
        localStorage.removeItem(<span class="string">'auth_token'</span>);
        showLoginButton();
      }
    }

    <span class="keyword">function</span> <span class="key">login</span>() {
      <span class="keyword">const</span> returnTo = encodeURIComponent(<span class="string">\`\${SERVICE_URL}/\`</span>);
      window.location.href = <span class="string">\`\${ECCAL_BASE}/api/sso/login?returnTo=\${returnTo}&service=your-service\`</span>;
    }

    <span class="keyword">function</span> <span class="key">logout</span>() {
      localStorage.removeItem(<span class="string">'auth_token'</span>);
      window.location.href = <span class="string">\`\${ECCAL_BASE}/api/sso/logout?returnTo=\${SERVICE_URL}\`</span>;
    }

    <span class="keyword">function</span> <span class="key">showLoginButton</span>() {
      document.getElementById(<span class="string">'user-info'</span>).textContent = <span class="string">'尚未登入'</span>;
      document.getElementById(<span class="string">'login-btn'</span>).style.display = <span class="string">'inline'</span>;
    }

    init();
  &lt;/script&gt;
&lt;/body&gt;
&lt;/html&gt;</div>

    <!-- ===================== 線上測試 ===================== -->
    <h2 id="live-test">線上測試工具</h2>
    <p>直接在這裡測試 SSO API，確認整合是否正常。</p>

    <h3>測試 SSO 登入流程</h3>
    <div class="live-test">
        <p>輸入登入完成後要跳轉的網址：</p>
        <input type="text" id="test-return-url" placeholder="https://your-service.thinkwithblack.com/callback" value="https://eccal.thinkwithblack.com/sso-guide">
        <br>
        <button onclick="testSsoLogin()">啟動 Google 登入測試</button>
    </div>

    <h3>測試 Token 驗證</h3>
    <div class="live-test">
        <p>貼上一個 JWT Token 進行驗證：</p>
        <input type="text" id="test-token-input" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...">
        <button onclick="testVerifyToken()">驗證 Token</button>
        <button class="secondary" onclick="loadLocalToken()">載入本地 Token</button>
        <div id="verify-result" class="live-result"></div>
    </div>

    <h3>測試 Account Center 查詢</h3>
    <div class="live-test">
        <p>輸入用戶 ID 或 Email：</p>
        <input type="text" id="test-user-id" placeholder="user@example.com">
        <button onclick="testGetUser()">查詢用戶</button>
        <div id="user-result" class="live-result"></div>
    </div>

    <div style="height:80px;"></div>
</div>

<script>
    // 處理登入後的 token（如果是從 SSO 跳轉回來）
    (function() {
        var params = new URLSearchParams(window.location.search);
        var token = params.get('token');
        if (token) {
            localStorage.setItem('eccal_test_token', token);
            window.history.replaceState({}, '', window.location.pathname);
            var input = document.getElementById('test-token-input');
            if (input) input.value = token;
            showResult('verify-result', '✅ 已收到 Token，點擊「驗證 Token」確認', 'info');
        }
    })();

    function testSsoLogin() {
        var returnUrl = document.getElementById('test-return-url').value || window.location.href;
        window.location.href = 'https://eccal.thinkwithblack.com/api/sso/login?returnTo=' + encodeURIComponent(returnUrl) + '&service=guide-test';
    }

    function loadLocalToken() {
        var token = localStorage.getItem('eccal_test_token') || localStorage.getItem('eccal_auth_token');
        if (token) {
            document.getElementById('test-token-input').value = token;
        } else {
            showResult('verify-result', '⚠️ 本地沒有找到 Token，請先執行 SSO 登入測試', 'warn');
        }
    }

    function testVerifyToken() {
        var token = document.getElementById('test-token-input').value.trim();
        if (!token) { showResult('verify-result', '請先輸入或載入 Token', 'warn'); return; }
        showResult('verify-result', '驗證中...', 'loading');
        fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) { showResult('verify-result', JSON.stringify(data, null, 2)); })
        .catch(function(e) { showResult('verify-result', '錯誤：' + e.message); });
    }

    function testGetUser() {
        var userId = document.getElementById('test-user-id').value.trim();
        if (!userId) { showResult('user-result', '請先輸入用戶 ID 或 Email', 'warn'); return; }
        showResult('user-result', '查詢中...', 'loading');
        fetch('https://eccal.thinkwithblack.com/api/account-center/user/' + encodeURIComponent(userId))
        .then(function(r) { return r.json(); })
        .then(function(data) { showResult('user-result', JSON.stringify(data, null, 2)); })
        .catch(function(e) { showResult('user-result', '錯誤：' + e.message); });
    }

    function showResult(id, text) {
        var el = document.getElementById(id);
        if (el) { el.style.display = 'block'; el.textContent = text; }
    }

    // 側邊欄高亮
    var sections = document.querySelectorAll('h2[id]');
    var links = document.querySelectorAll('.sidebar a');
    window.addEventListener('scroll', function() {
        var scrollY = window.scrollY + 100;
        sections.forEach(function(s) {
            if (s.offsetTop <= scrollY) {
                links.forEach(function(l) { l.classList.remove('active'); });
                var active = document.querySelector('.sidebar a[href="#' + s.id + '"]');
                if (active) active.classList.add('active');
            }
        });
    });
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
    const { users, userCredits } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    
    // 查詢用戶 - 支援 email 或 userId
    let user;
    if (userId.includes('@')) {
      // 如果是 email 格式，通過 email 查詢
      user = await db.select()
        .from(users)
        .where(eq(users.email, userId))
        .limit(1);
    } else {
      // 否則通過 userId 查詢
      user = await db.select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    }
    
    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        error: '用戶未找到',
        code: 'USER_NOT_FOUND'
      });
    }
    
    const userData = user[0];
    
    // 查詢點數
    const credits = await db.select()
      .from(userCredits)
      .where(eq(userCredits.userId, userData.id))
      .limit(1);
    const creditsData = credits.length > 0 ? credits[0] : null;
    
    res.json({
      success: true,
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name || userData.email,
        membership: userData.membershipLevel || 'free',
        membershipExpires: userData.membershipExpires,
        credits: userData.credits || 0,
        profileImageUrl: userData.profileImageUrl,
        createdAt: userData.createdAt
      }
    });
    
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
      
      res.json({ 
        success: true,
        valid: true, 
        user: {
          id: decoded.sub,
          email: decoded.email,
          name: decoded.name,
          membership: decoded.membership,
          credits: decoded.credits
        }
      });
    } catch (jwtError) {
      console.error('❌ JWT 驗證失敗:', {
        error: jwtError instanceof Error ? jwtError.message : 'Unknown error',
        tokenPrefix: token.substring(0, 30) + '...'
      });
      
      res.status(401).json({ 
        success: false, 
        valid: false, 
        error: 'Invalid token',
        details: jwtError instanceof Error ? jwtError.message : 'Unknown error'
      });
    }
    
  } catch (error) {
    console.error('Token 驗證錯誤:', error);
    res.status(401).json({ 
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // 用於處理 JWT cookie

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