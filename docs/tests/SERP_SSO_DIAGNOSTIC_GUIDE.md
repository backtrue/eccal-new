# SERP SSO 整合診斷指南

## 🚨 **當前錯誤分析**

你們的系統出現以下錯誤：

```
GET https://api.serp.thinkwithblack.com/api/auth/user 401 (Unauthorized)
POST https://api.serp.thinkwithblack.com/api/auth/login 401 (Unauthorized)
processAuthCallback error: 401: {"message":"Authentication failed"}
```

**根本原因**：你們的後端 (`api.serp.thinkwithblack.com`) 沒有正確驗證 eccal token。

---

## 📋 **診斷步驟（按順序執行）**

### 步驟 1：檢查前端是否收到 eccal token

#### 🧪 測試方法

在 `https://serp.thinkwithblack.com` 的瀏覽器 Console 執行：

```javascript
// 1. 檢查 URL 是否有回調參數
console.log('當前 URL:', window.location.href);
const urlParams = new URLSearchParams(window.location.search);
console.log('auth_success:', urlParams.get('auth_success'));
console.log('token:', urlParams.get('token'));
console.log('user_id:', urlParams.get('user_id'));

// 2. 檢查 localStorage
console.log('localStorage token:', localStorage.getItem('eccal_auth_token'));
```

#### ✅ 預期結果

如果登入成功，應該看到：
```javascript
auth_success: "true"
token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...." (長字串)
user_id: "123e4567-e89b-12d3-a456-426614174000"
```

#### ❌ 如果沒有這些參數

**問題**：eccal SSO 回調失敗

**解決方案**：檢查前端登入按鈕的重定向 URL

```javascript
// ✅ 正確的登入重定向
function handleEccalLogin() {
  const returnUrl = encodeURIComponent(window.location.href);
  window.location.href = `https://eccal.thinkwithblack.com/api/auth/google-sso?returnTo=${returnUrl}&service=serp`;
}
```

---

### 步驟 2：驗證 eccal token 是否有效

#### 🧪 測試方法

在瀏覽器 Console 執行：

```javascript
const token = localStorage.getItem('eccal_auth_token') || new URLSearchParams(window.location.search).get('token');

if (!token) {
  console.error('❌ 沒有 token！請先執行步驟 1');
} else {
  console.log('📤 正在驗證 token...');
  
  fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': window.location.origin
    },
    body: JSON.stringify({ token })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success && data.valid) {
      console.log('✅ Token 有效！用戶資訊:', data.user);
    } else {
      console.error('❌ Token 無效:', data);
    }
  })
  .catch(err => console.error('❌ 驗證失敗:', err));
}
```

#### ✅ 預期結果

```json
{
  "success": true,
  "valid": true,
  "user": {
    "id": "xxx",
    "email": "user@example.com",
    "name": "用戶名稱",
    "membership": "pro",
    "credits": 150
  }
}
```

#### ❌ 如果驗證失敗

可能原因：
- Token 過期（超過 7 天）
- Token 格式錯誤
- CORS 問題

**解決方案**：重新登入取得新 token

---

### 步驟 3：檢查前端是否正確傳 token 給你們的後端

#### 🧪 查看實際請求

1. 開啟瀏覽器開發者工具
2. 切換到 **Network** 面板
3. 重新整理頁面或執行登入
4. 找到 `api.serp.thinkwithblack.com/api/auth/login` 請求
5. 檢查 **Request Headers** 和 **Request Payload**

#### ✅ 正確的做法

前端應該這樣調用你們的後端：

```javascript
// 方案 A：使用 Authorization header
const eccalToken = localStorage.getItem('eccal_auth_token');

fetch('https://api.serp.thinkwithblack.com/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${eccalToken}`  // ← eccal token
  },
  body: JSON.stringify({
    // 其他登入參數
  })
});

// 方案 B：在 request body 中傳遞
fetch('https://api.serp.thinkwithblack.com/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    eccalToken: eccalToken  // ← eccal token
  })
});
```

#### ❌ 如果沒有傳 token

**問題**：前端沒有將 eccal token 傳給後端

**解決方案**：修改前端程式碼，加入 token 傳遞邏輯

---

### 步驟 4：檢查你們的後端是否正確驗證 eccal token

#### 🔧 後端應該這樣做

**Node.js/Express 範例**：

```javascript
// api.serp.thinkwithblack.com 後端
app.post('/api/auth/login', async (req, res) => {
  try {
    // 1. 從前端取得 eccal token
    const eccalToken = req.headers.authorization?.replace('Bearer ', '') 
                    || req.body.eccalToken;
    
    if (!eccalToken) {
      return res.status(401).json({ message: '缺少 eccal token' });
    }
    
    // 2. 調用 eccal API 驗證 token
    const verifyResponse = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://serp.thinkwithblack.com'
      },
      body: JSON.stringify({ token: eccalToken })
    });
    
    const verifyData = await verifyResponse.json();
    
    // 3. 檢查驗證結果
    if (!verifyData.success || !verifyData.valid) {
      return res.status(401).json({ message: 'Eccal token 驗證失敗' });
    }
    
    // 4. 取得用戶資訊
    const eccalUser = verifyData.user;
    
    // 5. 建立你們自己的 session/token
    // 方案 A：直接使用 eccal user 資訊
    req.session.userId = eccalUser.id;
    req.session.email = eccalUser.email;
    
    // 方案 B：在你們的資料庫中查找/建立用戶
    let localUser = await db.users.findOne({ eccalUserId: eccalUser.id });
    if (!localUser) {
      localUser = await db.users.create({
        eccalUserId: eccalUser.id,
        email: eccalUser.email,
        name: eccalUser.name
      });
    }
    
    // 6. 返回成功
    res.json({
      success: true,
      user: {
        id: localUser.id,
        email: localUser.email,
        name: localUser.name,
        eccalMembership: eccalUser.membership,
        eccalCredits: eccalUser.credits
      }
    });
    
  } catch (error) {
    console.error('登入錯誤:', error);
    res.status(500).json({ message: '伺服器錯誤' });
  }
});
```

**Python/Flask 範例**：

```python
import requests
from flask import request, jsonify, session

@app.route('/api/auth/login', methods=['POST'])
def login():
    # 1. 從前端取得 eccal token
    eccal_token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not eccal_token:
        eccal_token = request.json.get('eccalToken')
    
    if not eccal_token:
        return jsonify({'message': '缺少 eccal token'}), 401
    
    # 2. 調用 eccal API 驗證 token
    verify_response = requests.post(
        'https://eccal.thinkwithblack.com/api/sso/verify-token',
        headers={
            'Content-Type': 'application/json',
            'Origin': 'https://serp.thinkwithblack.com'
        },
        json={'token': eccal_token}
    )
    
    verify_data = verify_response.json()
    
    # 3. 檢查驗證結果
    if not verify_data.get('success') or not verify_data.get('valid'):
        return jsonify({'message': 'Eccal token 驗證失敗'}), 401
    
    # 4. 取得用戶資訊
    eccal_user = verify_data['user']
    
    # 5. 建立 session
    session['user_id'] = eccal_user['id']
    session['email'] = eccal_user['email']
    
    # 6. 返回成功
    return jsonify({
        'success': True,
        'user': {
            'id': eccal_user['id'],
            'email': eccal_user['email'],
            'name': eccal_user['name'],
            'membership': eccal_user['membership'],
            'credits': eccal_user['credits']
        }
    })
```

#### 🧪 測試後端驗證

在後端加入詳細的 log：

```javascript
console.log('收到的 eccal token:', eccalToken?.substring(0, 50) + '...');
console.log('調用 eccal 驗證 API...');
console.log('eccal 驗證結果:', verifyData);
```

---

## 🛠️ **完整修復方案**

### 前端修改（serp.thinkwithblack.com）

```javascript
// 1. 處理 eccal SSO 回調
useEffect(() => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('auth_success') === 'true') {
    const token = urlParams.get('token');
    localStorage.setItem('eccal_auth_token', token);
    
    // 清除 URL 參數
    window.history.replaceState({}, document.title, window.location.pathname);
    
    // 調用你們的後端登入 API
    loginWithEccalToken(token);
  }
}, []);

// 2. 登入函數
async function loginWithEccalToken(eccalToken) {
  try {
    const response = await fetch('https://api.serp.thinkwithblack.com/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${eccalToken}`
      }
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ 登入成功:', data.user);
      // 設置用戶狀態
      setUser(data.user);
    } else {
      console.error('❌ 登入失敗:', data);
    }
  } catch (error) {
    console.error('❌ 登入錯誤:', error);
  }
}

// 3. 登入按鈕
function handleLogin() {
  const returnUrl = encodeURIComponent(window.location.href);
  window.location.href = `https://eccal.thinkwithblack.com/api/auth/google-sso?returnTo=${returnUrl}&service=serp`;
}
```

### 後端修改（api.serp.thinkwithblack.com）

參考上方「步驟 4」的程式碼範例。

---

## 📊 **診斷檢查清單**

完成以下檢查，找出問題點：

- [ ] **步驟 1**：前端收到 eccal SSO 回調參數（auth_success, token, user_id）
- [ ] **步驟 2**：Token 可以通過 eccal verify API 驗證
- [ ] **步驟 3**：前端調用後端時有帶 eccal token
- [ ] **步驟 4**：後端有調用 eccal verify API
- [ ] **步驟 5**：後端正確處理 eccal 驗證結果
- [ ] **步驟 6**：後端建立自己的 session/token 並返回給前端

---

## 🆘 **快速診斷腳本**

在 `https://serp.thinkwithblack.com` 執行此腳本，自動診斷問題：

```javascript
async function diagnoseSSOIntegration() {
  console.log('🔍 開始 SSO 整合診斷...\n');
  
  // 檢查 1: URL 參數
  const urlParams = new URLSearchParams(window.location.search);
  const authSuccess = urlParams.get('auth_success');
  const urlToken = urlParams.get('token');
  const userId = urlParams.get('user_id');
  
  console.log('1️⃣ 檢查 URL 回調參數:');
  console.log('   auth_success:', authSuccess || '❌ 無');
  console.log('   token:', urlToken ? '✅ 有 (' + urlToken.substring(0, 30) + '...)' : '❌ 無');
  console.log('   user_id:', userId || '❌ 無');
  
  // 檢查 2: localStorage
  const storedToken = localStorage.getItem('eccal_auth_token');
  console.log('\n2️⃣ 檢查 localStorage:');
  console.log('   eccal_auth_token:', storedToken ? '✅ 有' : '❌ 無');
  
  const token = storedToken || urlToken;
  
  if (!token) {
    console.log('\n❌ 診斷結果: 沒有 token');
    console.log('💡 解決方案: 執行登入流程');
    console.log('   window.location.href = "https://eccal.thinkwithblack.com/api/auth/google-sso?returnTo=" + encodeURIComponent(window.location.href) + "&service=serp"');
    return;
  }
  
  // 檢查 3: 驗證 token
  console.log('\n3️⃣ 驗證 eccal token...');
  try {
    const verifyRes = await fetch('https://eccal.thinkwithblack.com/api/sso/verify-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': window.location.origin
      },
      body: JSON.stringify({ token })
    });
    
    const verifyData = await verifyRes.json();
    
    if (verifyData.success && verifyData.valid) {
      console.log('   ✅ Token 有效');
      console.log('   用戶:', verifyData.user);
    } else {
      console.log('   ❌ Token 無效:', verifyData.error);
      console.log('💡 解決方案: Token 過期，需要重新登入');
      return;
    }
    
    // 檢查 4: 測試後端登入
    console.log('\n4️⃣ 測試你們的後端登入...');
    const loginRes = await fetch('https://api.serp.thinkwithblack.com/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('   HTTP Status:', loginRes.status);
    
    if (loginRes.ok) {
      const loginData = await loginRes.json();
      console.log('   ✅ 後端登入成功:', loginData);
    } else {
      const errorData = await loginRes.json();
      console.log('   ❌ 後端登入失敗:', errorData);
      console.log('\n💡 診斷結果: 後端沒有正確驗證 eccal token');
      console.log('💡 解決方案: 檢查後端程式碼（參考診斷指南步驟 4）');
    }
    
  } catch (error) {
    console.error('❌ 診斷過程發生錯誤:', error);
  }
}

// 執行診斷
diagnoseSSOIntegration();
```

---

## 📞 **技術支援**

如果按照上述步驟仍無法解決：

1. 執行診斷腳本，複製完整輸出
2. 檢查後端 log，提供錯誤訊息
3. 聯繫 Eccal 技術支援：backtrue@thinkwithblack.com

**提供以下資訊**：
- 診斷腳本輸出
- 瀏覽器 Network 面板截圖
- 後端錯誤 log
- 你們的後端程式碼片段（/api/auth/login 部分）

---

**最後更新**：2025-10-19  
**狀態**：生產環境診斷指南
