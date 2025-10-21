# SSO Token 驗證 API 規格說明

## 🎯 端點資訊

**端點 URL**: `https://eccal.thinkwithblack.com/api/sso/verify-token`  
**HTTP Method**: `POST`  
**用途**: 驗證 JWT token 並返回用戶資訊

---

## ⚠️ 開發前必讀

### Token 從哪裡來？

在調用此 API 之前，你需要先讓用戶完成 Google SSO 登入流程：

```javascript
// 步驟 1: 引導用戶到 Google 登入
const returnUrl = encodeURIComponent(window.location.href);
const serviceName = 'serp'; // 你的子服務名稱
window.location.href = `https://eccal.thinkwithblack.com/api/auth/google-sso?returnTo=${returnUrl}&service=${serviceName}`;

// 步驟 2: Google 登入完成後，用戶會被重定向回你的網站，URL 會包含 token
// 範例: https://serp.thinkwithblack.com/?auth_success=true&token=eyJhbGci...&user_id=123

// 步驟 3: 從 URL 取得 token 並儲存
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('auth_success') === 'true') {
  const token = urlParams.get('token');
  localStorage.setItem('eccal_auth_token', token);
  // 清除 URL 參數
  window.history.replaceState({}, document.title, window.location.pathname);
}

// 步驟 4: 現在你可以使用此 token 調用驗證 API
const savedToken = localStorage.getItem('eccal_auth_token');
// 使用下方的 API 進行驗證...
```

### 完整整合流程圖

```
┌─────────────────┐
│  用戶點擊登入    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 重定向到 Eccal Google SSO            │
│ /api/auth/google-sso?returnTo=...   │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────┐
│ Google 授權頁面  │
└────────┬────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ Eccal 處理回調並生成 JWT token        │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ 重定向回子服務並附帶 token            │
│ ?auth_success=true&token=...&user_id=│
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ 子服務儲存 token 到 localStorage      │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ 調用 /api/sso/verify-token 驗證 token │  ← 本文件描述的 API
└──────────────────────────────────────┘
```

---

## 📋 必需的 Headers

```http
Content-Type: application/json
Origin: https://[your-subdomain].thinkwithblack.com
```

**說明**:
- ✅ `Content-Type` 必須是 `application/json`
- ✅ `Origin` 必須是允許清單中的子域名（見下方）
- ❌ **不需要** `Authorization` header
- ❌ **不需要** Cookies
- ⚠️ **瀏覽器會自動發送 OPTIONS 預檢請求**（CORS preflight），伺服器已處理

### CORS 預檢請求（自動處理）

如果你從瀏覽器發送跨域 POST 請求，瀏覽器會先發送一個 OPTIONS 請求：

```http
OPTIONS /api/sso/verify-token HTTP/1.1
Host: eccal.thinkwithblack.com
Origin: https://serp.thinkwithblack.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type
```

**伺服器會返回**:
```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://serp.thinkwithblack.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type, Accept, Authorization
Access-Control-Allow-Credentials: true
```

**你不需要手動處理 OPTIONS 請求** - 瀏覽器和伺服器會自動完成。

---

## 🔧 允許的 Origin 域名

```
https://eccal.thinkwithblack.com
https://audai.thinkwithblack.com
https://quote.thinkwithblack.com
https://fabe.thinkwithblack.com
https://galine.thinkwithblack.com
https://serp.thinkwithblack.com
https://sub3.thinkwithblack.com
https://sub4.thinkwithblack.com
https://sub5.thinkwithblack.com
https://member.thinkwithblack.com
http://localhost:3000 (開發環境)
http://localhost:5000 (開發環境)
```

---

## 📤 Request Body 格式

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI..."
}
```

**欄位說明**:
- `token` (string, 必需): JWT token 字串
  - 必須是標準 JWT 格式
  - 包含三個部分：`header.payload.signature`
  - 用 `.` 分隔

---

## 📥 成功響應（HTTP 200）

```json
{
  "success": true,
  "valid": true,
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "name": "張三",
    "membership": "pro",
    "credits": 150
  }
}
```

**欄位說明**:
- `success` (boolean): 請求是否成功
- `valid` (boolean): Token 是否有效
- `user.id` (string): 用戶唯一識別碼（UUID）
- `user.email` (string): 用戶 Email
- `user.name` (string): 用戶姓名
- `user.membership` (string): 會員等級（`"free"` 或 `"pro"`）
- `user.credits` (number): 可用點數

---

## ❌ 錯誤響應

### 1. Token 缺失（HTTP 400）

```json
{
  "success": false,
  "error": "Token is required"
}
```

### 2. Token 格式錯誤（HTTP 400）

```json
{
  "success": false,
  "error": "Invalid token format - JWT should have 3 parts separated by dots",
  "debug": {
    "tokenType": "string",
    "parts": 2,
    "expected": 3
  }
}
```

### 3. Token 無效或過期（HTTP 401）

```json
{
  "success": false,
  "valid": false,
  "error": "Invalid token",
  "details": "jwt expired"
}
```

**常見錯誤原因**:
- `jwt expired`: Token 已過期（超過 7 天）
- `invalid signature`: Token 簽名不正確
- `jwt malformed`: Token 格式不正確

---

## 💻 完整程式碼範例

### JavaScript (fetch)

```javascript
async function verifyToken(token) {
  try {
    const response = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': window.location.origin
      },
      body: JSON.stringify({ token })
    });
    
    const data = await response.json();
    
    if (data.success && data.valid) {
      console.log('Token 有效，用戶資訊:', data.user);
      return data.user;
    } else {
      console.error('Token 驗證失敗:', data.error);
      return null;
    }
  } catch (error) {
    console.error('請求錯誤:', error);
    return null;
  }
}

// 使用範例
const user = await verifyToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
if (user) {
  console.log('會員等級:', user.membership);
  console.log('點數餘額:', user.credits);
}
```

### cURL

```bash
curl -X POST https://eccal.thinkwithblack.com/api/sso/verify-token \
  -H "Content-Type: application/json" \
  -H "Origin: https://serp.thinkwithblack.com" \
  -d '{
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

### Python (requests)

```python
import requests

def verify_token(token):
    url = 'https://eccal.thinkwithblack.com/api/sso/verify-token'
    headers = {
        'Content-Type': 'application/json',
        'Origin': 'https://serp.thinkwithblack.com'
    }
    data = {'token': token}
    
    response = requests.post(url, headers=headers, json=data)
    result = response.json()
    
    if result.get('success') and result.get('valid'):
        return result['user']
    else:
        print(f"驗證失敗: {result.get('error')}")
        return None

# 使用範例
user = verify_token('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...')
if user:
    print(f"會員等級: {user['membership']}")
    print(f"點數餘額: {user['credits']}")
```

### PHP

```php
<?php
function verifyToken($token) {
    $url = 'https://eccal.thinkwithblack.com/api/sso/verify-token';
    $data = json_encode(['token' => $token]);
    
    $options = [
        'http' => [
            'method'  => 'POST',
            'header'  => [
                'Content-Type: application/json',
                'Origin: https://serp.thinkwithblack.com'
            ],
            'content' => $data
        ]
    ];
    
    $context  = stream_context_create($options);
    $result = file_get_contents($url, false, $context);
    $response = json_decode($result, true);
    
    if ($response['success'] && $response['valid']) {
        return $response['user'];
    } else {
        error_log('驗證失敗: ' . $response['error']);
        return null;
    }
}

// 使用範例
$user = verifyToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
if ($user) {
    echo "會員等級: " . $user['membership'] . "\n";
    echo "點數餘額: " . $user['credits'] . "\n";
}
?>
```

---

## 🔐 重要技術細節

### JWT 格式要求
- Token 必須包含三個部分，用 `.` 分隔
- 格式：`header.payload.signature`
- 範例：`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`

### 時鐘容忍度
- 伺服器設定 **60 秒 clockTolerance**
- 允許 ±60 秒的時間偏差
- 解決不同系統時鐘不同步的問題

### CORS 政策
- Origin header 是必需的
- 只接受允許清單中的域名
- 跨域請求會被自動處理

### Token 位置
- ✅ Token 必須在 **request body** 中
- ❌ 不支援 `Authorization: Bearer <token>` header
- ❌ 不使用 cookies 傳遞 token

---

## 🧪 測試建議

### 開發環境快速測試

#### 方法 1: 使用測試 HTML 頁面（最快）

創建一個測試 HTML 文件：

```html
<!DOCTYPE html>
<html>
<head>
  <title>SSO Token 驗證測試</title>
</head>
<body>
  <h1>SSO Token 驗證測試</h1>
  
  <div id="step1">
    <h2>步驟 1: 獲取 Token</h2>
    <button onclick="startLogin()">開始 Google 登入</button>
    <p>點擊後會跳轉到 Google 登入，完成後會返回本頁面</p>
  </div>
  
  <div id="step2" style="display:none;">
    <h2>步驟 2: Token 已獲取</h2>
    <p>Token: <span id="tokenDisplay"></span></p>
    <button onclick="verifyToken()">驗證 Token</button>
  </div>
  
  <div id="result"></div>
  
  <script>
    // 步驟 1: 啟動登入
    function startLogin() {
      const returnUrl = encodeURIComponent(window.location.href);
      const serviceName = 'serp'; // 改成你的服務名稱
      window.location.href = `https://eccal.thinkwithblack.com/api/auth/google-sso?returnTo=${returnUrl}&service=${serviceName}`;
    }
    
    // 檢查是否有回調 token
    window.addEventListener('DOMContentLoaded', function() {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('auth_success') === 'true') {
        const token = urlParams.get('token');
        localStorage.setItem('eccal_auth_token', token);
        
        // 顯示 token
        document.getElementById('step1').style.display = 'none';
        document.getElementById('step2').style.display = 'block';
        document.getElementById('tokenDisplay').textContent = token.substring(0, 50) + '...';
        
        // 清除 URL 參數
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (localStorage.getItem('eccal_auth_token')) {
        // 已有儲存的 token
        const token = localStorage.getItem('eccal_auth_token');
        document.getElementById('step1').style.display = 'none';
        document.getElementById('step2').style.display = 'block';
        document.getElementById('tokenDisplay').textContent = token.substring(0, 50) + '...';
      }
    });
    
    // 步驟 2: 驗證 token
    async function verifyToken() {
      const token = localStorage.getItem('eccal_auth_token');
      const resultDiv = document.getElementById('result');
      
      try {
        resultDiv.innerHTML = '<p>正在驗證...</p>';
        
        const response = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': window.location.origin
          },
          body: JSON.stringify({ token })
        });
        
        const data = await response.json();
        
        if (data.success && data.valid) {
          resultDiv.innerHTML = `
            <h3 style="color: green;">✅ Token 驗證成功！</h3>
            <pre>${JSON.stringify(data.user, null, 2)}</pre>
          `;
        } else {
          resultDiv.innerHTML = `
            <h3 style="color: red;">❌ Token 驗證失敗</h3>
            <p>錯誤: ${data.error}</p>
            <pre>${JSON.stringify(data, null, 2)}</pre>
          `;
        }
      } catch (error) {
        resultDiv.innerHTML = `
          <h3 style="color: red;">❌ 請求錯誤</h3>
          <p>${error.message}</p>
        `;
      }
    }
  </script>
</body>
</html>
```

#### 方法 2: 瀏覽器 Console 快速測試

```javascript
// 在瀏覽器 Console 執行 - 完整測試流程

// 檢查是否已有 token
let token = localStorage.getItem('eccal_auth_token');
console.log('當前 Token:', token ? token.substring(0, 50) + '...' : '無');

// 如果沒有 token，先登入
if (!token) {
  console.log('請先執行登入:');
  console.log('window.location.href = "https://eccal.thinkwithblack.com/api/auth/google-sso?returnTo=" + encodeURIComponent(window.location.href) + "&service=serp"');
} else {
  // 有 token，開始驗證
  fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': window.location.origin
    },
    body: JSON.stringify({ token })
  })
  .then(res => {
    console.log('HTTP Status:', res.status);
    return res.json();
  })
  .then(data => {
    console.log('驗證結果:', data);
    if (data.success && data.valid) {
      console.log('✅ Token 有效');
      console.log('用戶資訊:', data.user);
    } else {
      console.log('❌ Token 無效:', data.error);
    }
  })
  .catch(err => console.error('❌ 請求錯誤:', err));
}
```

### 常見問題排查

#### 問題 1: CORS 錯誤 - "Access-Control-Allow-Origin"

**錯誤訊息**:
```
Access to fetch at 'https://eccal.thinkwithblack.com/api/sso/verify-token' from origin 'https://serp.thinkwithblack.com' has been blocked by CORS policy
```

**檢查清單**:
- ✅ 確認你的域名在允許清單中（見上方「允許的 Origin 域名」）
- ✅ 確認 `Origin` header 正確設置
- ✅ 檢查是否使用 HTTPS（生產環境必須用 HTTPS）
- ✅ 開發環境使用 `http://localhost:3000` 或 `http://localhost:5000`

**解決方案**:
```javascript
// ✅ 正確 - 使用 window.location.origin
headers: {
  'Content-Type': 'application/json',
  'Origin': window.location.origin  // 自動使用當前域名
}

// ❌ 錯誤 - 不要硬編碼 Origin
headers: {
  'Content-Type': 'application/json',
  'Origin': 'https://wrong-domain.com'  // 不在允許清單中
}
```

#### 問題 2: Token 格式錯誤

**錯誤訊息**:
```json
{
  "success": false,
  "error": "Invalid token format - JWT should have 3 parts separated by dots"
}
```

**檢查清單**:
- ✅ Token 是完整的字串（不是截斷的）
- ✅ Token 包含三個部分，用 `.` 分隔
- ✅ 沒有額外的空格或換行符

**檢查方法**:
```javascript
const token = localStorage.getItem('eccal_auth_token');
console.log('Token 長度:', token.length);
console.log('Token 部分數:', token.split('.').length);  // 應該是 3
console.log('Token 預覽:', token.substring(0, 100));
```

#### 問題 3: Token 過期

**錯誤訊息**:
```json
{
  "success": false,
  "valid": false,
  "error": "Invalid token",
  "details": "jwt expired"
}
```

**解決方案**:
```javascript
// 清除舊 token 並重新登入
localStorage.removeItem('eccal_auth_token');
const returnUrl = encodeURIComponent(window.location.href);
window.location.href = `https://eccal.thinkwithblack.com/api/auth/google-sso?returnTo=${returnUrl}&service=serp`;
```

#### 問題 4: 網路請求失敗

**錯誤訊息**:
```
TypeError: Failed to fetch
```

**檢查清單**:
- ✅ 確認網路連線正常
- ✅ 確認 API 端點 URL 正確（`https://eccal.thinkwithblack.com/api/sso/verify-token`）
- ✅ 檢查瀏覽器 Network 面板查看實際請求

**調試方法**:
```javascript
// 開啟瀏覽器開發者工具 > Network 面板
// 然後執行以下代碼，觀察請求詳情

fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': window.location.origin
  },
  body: JSON.stringify({ 
    token: localStorage.getItem('eccal_auth_token') 
  })
})
.then(res => {
  console.log('Response Status:', res.status);
  console.log('Response Headers:', [...res.headers.entries()]);
  return res.json();
})
.then(data => console.log('Response Data:', data))
.catch(err => {
  console.error('Error Type:', err.constructor.name);
  console.error('Error Message:', err.message);
  console.error('Full Error:', err);
});
```

### 生產環境檢查清單

在部署到生產環境前，請確認：

- [ ] 子服務域名已加入允許清單（聯繫 Eccal 團隊）
- [ ] 使用 HTTPS（不是 HTTP）
- [ ] Token 正確儲存在 localStorage
- [ ] 錯誤處理已實現（token 過期自動重新登入）
- [ ] CORS headers 正確設置
- [ ] 已測試完整登入→驗證流程

---

## 📞 技術支援

如有問題，請聯繫：
- **Email**: backtrue@thinkwithblack.com
- **相關文檔**: `INTEGRATED_SSO_GUIDE.md`
- **API 狀態**: 參考 `API_STATUS_REPORT.md`

---

**最後更新**: 2025-10-19  
**版本**: 1.0  
**狀態**: ✅ 生產環境運行中
