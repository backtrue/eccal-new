# SSO Token 驗證 API 規格說明

## 🎯 端點資訊

**端點 URL**: `https://eccal.thinkwithblack.com/api/sso/verify-token`  
**HTTP Method**: `POST`  
**用途**: 驗證 JWT token 並返回用戶資訊

---

## 📋 必需的 Headers

```
Content-Type: application/json
Origin: https://[your-subdomain].thinkwithblack.com
```

**說明**:
- ✅ `Content-Type` 必須是 `application/json`
- ✅ `Origin` 必須是允許清單中的子域名（見下方）
- ❌ **不需要** `Authorization` header
- ❌ **不需要** Cookies

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

### 基本測試流程

1. **獲取 Token**:
   - 完成 Google SSO 登入流程
   - 從回調 URL 取得 token 參數
   - 儲存到 localStorage

2. **驗證 Token**:
   - 使用本 API 驗證 token 有效性
   - 檢查 response 中的 `success` 和 `valid` 欄位

3. **處理錯誤**:
   - Token 過期時清除本地儲存
   - 引導用戶重新登入

### 測試指令

```javascript
// 在瀏覽器 Console 執行
const token = localStorage.getItem('eccal_auth_token');
fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': window.location.origin
  },
  body: JSON.stringify({ token })
})
.then(res => res.json())
.then(data => console.log('驗證結果:', data))
.catch(err => console.error('錯誤:', err));
```

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
