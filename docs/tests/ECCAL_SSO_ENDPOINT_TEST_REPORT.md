# ECCAL SSO 端點測試報告

## 📋 測試日期：2025-10-21

針對 SERP 子服務反饋的「301 重定向」問題進行完整測試。

---

## 🎯 測試端點

**URL**: `https://eccal.thinkwithblack.com/api/sso/verify-token`  
**Method**: `POST`

---

## ✅ 測試結果總覽

| 測試項目 | 狀態 | HTTP Status | 詳情 |
|---------|------|-------------|------|
| **CORS Preflight (OPTIONS)** | ✅ 通過 | 200 OK | 正確返回 CORS headers |
| **POST 請求（無效 token）** | ✅ 通過 | 400 Bad Request | 正確返回錯誤訊息 |
| **POST 請求（無 token）** | ✅ 通過 | 400 Bad Request | 正確返回錯誤訊息 |
| **重定向檢測** | ✅ 通過 | **無 301/302** | **端點沒有任何重定向** |

**結論**：**eccal API 端點完全正常，沒有 301 重定向問題。**

---

## 🧪 詳細測試過程

### 測試 1：CORS Preflight 請求

```bash
curl -v -X OPTIONS https://eccal.thinkwithblack.com/api/sso/verify-token \
  -H "Origin: https://serp.thinkwithblack.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

**實際響應**：
```http
HTTP/2 200 
access-control-allow-credentials: true
access-control-allow-headers: Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key
access-control-allow-methods: GET, POST, PUT, DELETE, OPTIONS
access-control-allow-origin: https://serp.thinkwithblack.com
content-type: text/plain; charset=utf-8
```

**結果**：✅ **正確返回 200，CORS headers 完整**

---

### 測試 2：POST 請求（無效 token）

```bash
curl -i -X POST https://eccal.thinkwithblack.com/api/sso/verify-token \
  -H "Content-Type: application/json" \
  -H "Origin: https://serp.thinkwithblack.com" \
  -d '{"token":"test"}'
```

**實際響應**：
```http
HTTP/2 400 
access-control-allow-credentials: true
access-control-allow-headers: Origin, X-Requested-With, Content-Type, Accept, Authorization
access-control-allow-methods: GET, POST, PUT, DELETE, OPTIONS
access-control-allow-origin: https://serp.thinkwithblack.com
content-type: application/json; charset=utf-8

{
  "success": false,
  "error": "Invalid token format - JWT should have 3 parts separated by dots",
  "debug": {
    "tokenType": "string",
    "parts": 1,
    "expected": 3
  }
}
```

**結果**：✅ **正確返回 400 錯誤，JSON 格式正確**

---

### 測試 3：重定向檢測

```bash
curl -v -X POST https://eccal.thinkwithblack.com/api/sso/verify-token \
  -H "Content-Type: application/json" \
  -H "Origin: https://serp.thinkwithblack.com" \
  -d '{"token":"test"}' 2>&1 | grep -E "HTTP/|Location:"
```

**實際響應**：
```
HTTP/2 400
```

**檢查點**：
- ❌ 沒有 `HTTP/1.1 301` 或 `HTTP/2 301`
- ❌ 沒有 `HTTP/1.1 302` 或 `HTTP/2 302`
- ❌ 沒有 `Location:` header
- ✅ 直接返回 `HTTP/2 400`

**結果**：✅ **確認無任何重定向**

---

## 🔍 **關於「301 狀態碼」的可能誤解**

### 情境 1：子服務可能看到的是自己的 301

SERP 的錯誤訊息：
```
GET https://api.serp.thinkwithblack.com/api/auth/user 401
POST https://api.serp.thinkwithblack.com/api/auth/login 401
```

**分析**：
- 這些請求是調用 **serp 自己的後端** (`api.serp.thinkwithblack.com`)
- 不是 eccal 的端點 (`eccal.thinkwithblack.com`)
- 如果有 301，可能是 serp 後端的配置問題

### 情境 2：可能是 HTTPS 重定向

如果子服務用 HTTP 調用：
```bash
# ❌ 錯誤：用 HTTP
curl http://eccal.thinkwithblack.com/api/sso/verify-token

# 這會返回 301 重定向到 HTTPS
HTTP/1.1 301 Moved Permanently
Location: https://eccal.thinkwithblack.com/api/sso/verify-token
```

**解決方案**：
```bash
# ✅ 正確：用 HTTPS
curl https://eccal.thinkwithblack.com/api/sso/verify-token
```

### 情境 3：可能是 URL 拼寫錯誤

```bash
# ❌ 錯誤：少了 /api
https://eccal.thinkwithblack.com/sso/verify-token

# ✅ 正確：完整路徑
https://eccal.thinkwithblack.com/api/sso/verify-token
```

---

## 📊 **完整的正確調用範例**

### JavaScript (前端)

```javascript
// ✅ 正確的調用方式
const response = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': window.location.origin  // 自動設置為 serp.thinkwithblack.com
  },
  body: JSON.stringify({ token: eccalToken })
});

// 檢查狀態碼
console.log('Status:', response.status);  // 應該是 200 或 400/401，不會是 301

const data = await response.json();
console.log('Response:', data);
```

### Node.js (後端)

```javascript
// ✅ 正確的調用方式
const verifyRes = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': 'https://serp.thinkwithblack.com'
  },
  body: JSON.stringify({ token: eccalToken })
});

console.log('Status:', verifyRes.status);  // 應該是 200 或 400/401，不會是 301

const verifyData = await verifyRes.json();
console.log('Response:', verifyData);
```

---

## 🔧 **給 SERP 團隊的診斷建議**

### 步驟 1：檢查實際調用的 URL

在你們的程式碼中加入詳細 log：

```javascript
const url = 'https://eccal.thinkwithblack.com/api/sso/verify-token';
console.log('調用 URL:', url);
console.log('使用 HTTPS?', url.startsWith('https://'));

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': 'https://serp.thinkwithblack.com'
  },
  body: JSON.stringify({ token })
});

console.log('Response Status:', response.status);
console.log('Response Headers:', [...response.headers.entries()]);

if (response.status === 301 || response.status === 302) {
  console.log('❌ 發現重定向！');
  console.log('Location header:', response.headers.get('Location'));
} else {
  console.log('✅ 沒有重定向');
}
```

### 步驟 2：檢查是否混淆了端點

```javascript
// ❌ 錯誤：這是 serp 自己的端點
https://api.serp.thinkwithblack.com/api/auth/login

// ✅ 正確：這是 eccal 的端點
https://eccal.thinkwithblack.com/api/sso/verify-token
```

### 步驟 3：使用 curl 直接測試

在終端執行：

```bash
# 測試 eccal 端點
curl -v -X POST https://eccal.thinkwithblack.com/api/sso/verify-token \
  -H "Content-Type: application/json" \
  -H "Origin: https://serp.thinkwithblack.com" \
  -d '{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0In0.test"}' \
  2>&1 | grep -E "HTTP/|Location:"
```

**預期結果**：
- 應該看到 `HTTP/2 400` 或 `HTTP/2 200`
- **不應該看到 301 或 302**
- **不應該看到 Location header**

---

## 📝 **結論與建議**

### Eccal 端點狀態

| 項目 | 狀態 |
|------|------|
| **端點可用性** | ✅ 正常運行 |
| **CORS 配置** | ✅ 正確配置 |
| **重定向問題** | ❌ **不存在** |
| **Response 格式** | ✅ 正確 JSON |

### 給 SERP 團隊的建議

1. **檢查實際調用的 URL**
   - 確認使用 `https://eccal.thinkwithblack.com/api/sso/verify-token`
   - 確認使用 HTTPS（不是 HTTP）

2. **檢查是否混淆了端點**
   - eccal 驗證端點：`https://eccal.thinkwithblack.com/api/sso/verify-token`
   - serp 後端端點：`https://api.serp.thinkwithblack.com/api/auth/...`
   - 不要把兩者混淆

3. **使用診斷腳本**
   - 參考 `SERP_SSO_DIAGNOSTIC_GUIDE.md`
   - 執行自動診斷腳本找出實際問題

4. **提供詳細錯誤資訊**
   - 實際請求的完整 URL
   - Response Status Code
   - Response Headers（包含 Location）
   - Request Headers
   - 後端程式碼片段

### Eccal 端需要修改嗎？

**❌ 不需要**

理由：
- ✅ 端點完全正常運行
- ✅ 沒有任何重定向
- ✅ CORS 配置正確
- ✅ 返回格式正確

**301 問題不在 eccal 端，建議檢查 serp 端的配置。**

---

## 🆘 **如何提供有效的錯誤報告**

如果 SERP 團隊仍然看到 301，請提供：

1. **完整的 curl 測試輸出**
```bash
curl -v -X POST https://eccal.thinkwithblack.com/api/sso/verify-token \
  -H "Content-Type: application/json" \
  -H "Origin: https://serp.thinkwithblack.com" \
  -d '{"token":"your-actual-token"}' > error-output.txt 2>&1
```

2. **瀏覽器 Network 面板截圖**
   - 包含 Request URL
   - 包含 Status Code
   - 包含 Response Headers

3. **實際程式碼片段**
   - 調用 eccal API 的程式碼
   - 包含完整的 URL 和 headers

---

**測試人員**：Eccal 技術團隊  
**測試時間**：2025-10-21 16:47 UTC  
**測試環境**：Production (eccal.thinkwithblack.com)  
**測試結果**：✅ **所有測試通過，eccal 端點無任何問題**

---

**附註**：如果 SERP 團隊能提供實際看到 301 的證據（curl 輸出、截圖、log），我們可以進一步協助診斷。但根據目前的測試，eccal 端點完全正常。
