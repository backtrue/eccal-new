# Credits API 文檔

## 概述

此 API 允許外部子服務（如 fabe）為用戶增加點數。API 使用 API Key 進行身份驗證，確保只有授權的服務可以操作用戶點數。

**基礎 URL**：
- **生產環境**：`https://eccal.thinkwithblack.com`
- **開發環境**：`http://localhost:5000`

---

## 認證

所有請求必須在 HTTP Header 中包含 API Key：

```
X-API-Key: YOUR_SERVICE_API_KEY
```

**獲取 API Key**：
- API Key 由 eccal 系統管理員提供
- 當前 API Key：`sk_live_81de5b1388d556d6e6e86a96d6bf412b554d0cd2a1a96028bed2064c1b23ffff`
- 請妥善保管，不要洩露或提交到版本控制系統

---

## API 端點

### 增加用戶點數

為指定用戶增加點數。

**端點**：`POST /api/account-center/credits/:userId/add`

**路徑參數**：
- `userId` (string, required) - 用戶標識符，可以是：
  - Email 地址（例如：`user@example.com`）
  - 用戶 ID（UUID 格式）

**請求 Headers**：
```
Content-Type: application/json
X-API-Key: YOUR_SERVICE_API_KEY
```

**請求 Body**：
```json
{
  "amount": 50,
  "reason": "考試通過獎勵",
  "service": "fabe"
}
```

**參數說明**：
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `amount` | number | ✅ | 要增加的點數，必須大於 0 |
| `reason` | string | ❌ | 增加點數的原因（可選） |
| `service` | string | ✅ | 服務名稱（例如：fabe, audai, galine） |

**成功回應** (HTTP 200)：
```json
{
  "success": true,
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "newBalance": 80,
  "addedAmount": 50,
  "previousBalance": 30,
  "transactionId": "tx_1696234567890_abc123def",
  "reason": "考試通過獎勵",
  "service": "fabe"
}
```

**回應欄位說明**：
| 欄位 | 類型 | 說明 |
|------|------|------|
| `success` | boolean | 操作是否成功 |
| `userId` | string | 用戶 ID |
| `email` | string | 用戶 Email |
| `newBalance` | number | 更新後的點數餘額 |
| `addedAmount` | number | 本次增加的點數 |
| `previousBalance` | number | 增加前的點數餘額 |
| `transactionId` | string | 交易 ID（用於追蹤） |
| `reason` | string \| null | 增加原因 |
| `service` | string | 服務名稱 |

---

## 錯誤處理

所有錯誤回應都包含以下格式：

```json
{
  "success": false,
  "error": "錯誤描述",
  "code": "ERROR_CODE"
}
```

### 錯誤代碼表

| HTTP Status | Error Code | 說明 | 解決方案 |
|-------------|------------|------|----------|
| 500 | `API_KEY_NOT_CONFIGURED` | 服務器未配置 API Key | 聯繫 eccal 管理員設置 SERVICE_API_KEY |
| 401 | `API_KEY_MISSING` | 請求缺少 API Key | 在 Header 中加入 `X-API-Key` |
| 403 | `INVALID_API_KEY` | API Key 無效 | 檢查 API Key 是否正確 |
| 400 | `INVALID_AMOUNT` | 金額無效 | 確保 amount 是大於 0 的數字 |
| 400 | `SERVICE_REQUIRED` | 缺少服務名稱 | 提供 service 參數 |
| 404 | `USER_NOT_FOUND` | 用戶不存在 | 檢查用戶 Email 或 ID 是否正確 |
| 500 | `INTERNAL_ERROR` | 服務器內部錯誤 | 聯繫技術支援 |

### 錯誤範例

**1. API Key 缺失**
```json
{
  "success": false,
  "error": "API key is required",
  "code": "API_KEY_MISSING"
}
```

**2. 用戶不存在**
```json
{
  "success": false,
  "error": "用戶未找到",
  "code": "USER_NOT_FOUND"
}
```

**3. 無效金額**
```json
{
  "success": false,
  "error": "增加金額必須是大於 0 的數字",
  "code": "INVALID_AMOUNT"
}
```

---

## 使用範例

### cURL

```bash
curl -X POST https://eccal.thinkwithblack.com/api/account-center/credits/user@example.com/add \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_81de5b1388d556d6e6e86a96d6bf412b554d0cd2a1a96028bed2064c1b23ffff" \
  -d '{
    "amount": 100,
    "reason": "FABE 課程考試通過",
    "service": "fabe"
  }'
```

### JavaScript (Node.js)

```javascript
const axios = require('axios');

async function addCredits(userEmail, amount, reason) {
  try {
    const response = await axios.post(
      `https://eccal.thinkwithblack.com/api/account-center/credits/${userEmail}/add`,
      {
        amount: amount,
        reason: reason,
        service: 'fabe'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'sk_live_81de5b1388d556d6e6e86a96d6bf412b554d0cd2a1a96028bed2064c1b23ffff'
        }
      }
    );
    
    console.log('點數增加成功:', response.data);
    return response.data;
  } catch (error) {
    console.error('點數增加失敗:', error.response?.data || error.message);
    throw error;
  }
}

// 使用範例
addCredits('student@example.com', 50, '考試通過獎勵')
  .then(result => console.log('新餘額:', result.newBalance))
  .catch(err => console.error('錯誤:', err));
```

### JavaScript (Fetch API)

```javascript
async function addCredits(userEmail, amount, reason) {
  const response = await fetch(
    `https://eccal.thinkwithblack.com/api/account-center/credits/${userEmail}/add`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'sk_live_81de5b1388d556d6e6e86a96d6bf412b554d0cd2a1a96028bed2064c1b23ffff'
      },
      body: JSON.stringify({
        amount: amount,
        reason: reason,
        service: 'fabe'
      })
    }
  );
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(`${data.code}: ${data.error}`);
  }
  
  return data;
}
```

### Python

```python
import requests
import json

def add_credits(user_email, amount, reason):
    url = f"https://eccal.thinkwithblack.com/api/account-center/credits/{user_email}/add"
    
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": "sk_live_81de5b1388d556d6e6e86a96d6bf412b554d0cd2a1a96028bed2064c1b23ffff"
    }
    
    payload = {
        "amount": amount,
        "reason": reason,
        "service": "fabe"
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        
        print(f"點數增加成功: {data}")
        return data
    except requests.exceptions.RequestException as e:
        print(f"點數增加失敗: {e}")
        raise

# 使用範例
result = add_credits("student@example.com", 50, "考試通過獎勵")
print(f"新餘額: {result['newBalance']}")
```

### PHP

```php
<?php

function addCredits($userEmail, $amount, $reason) {
    $url = "https://eccal.thinkwithblack.com/api/account-center/credits/{$userEmail}/add";
    
    $data = array(
        'amount' => $amount,
        'reason' => $reason,
        'service' => 'fabe'
    );
    
    $options = array(
        'http' => array(
            'method'  => 'POST',
            'header'  => 
                "Content-Type: application/json\r\n" .
                "X-API-Key: sk_live_81de5b1388d556d6e6e86a96d6bf412b554d0cd2a1a96028bed2064c1b23ffff\r\n",
            'content' => json_encode($data)
        )
    );
    
    $context  = stream_context_create($options);
    $result = file_get_contents($url, false, $context);
    
    if ($result === FALSE) {
        throw new Exception('API 請求失敗');
    }
    
    return json_decode($result, true);
}

// 使用範例
try {
    $result = addCredits('student@example.com', 50, '考試通過獎勵');
    echo "點數增加成功，新餘額: " . $result['newBalance'];
} catch (Exception $e) {
    echo "錯誤: " . $e->getMessage();
}
?>
```

---

## 業務場景範例

### FABE 課程考試獎勵

當學員通過 FABE 課程考試時，自動為學員增加點數：

```javascript
// 學員考試通過後的處理
async function handleExamPassed(student) {
  const creditsReward = 50; // 考試通過獎勵 50 點
  
  try {
    const result = await addCredits(
      student.email,
      creditsReward,
      `FABE ${student.courseName} 考試通過`
    );
    
    // 記錄到 FABE 系統
    await logCreditsReward({
      studentId: student.id,
      credits: creditsReward,
      transactionId: result.transactionId,
      timestamp: new Date()
    });
    
    // 通知學員
    await sendNotification(student.email, {
      title: '恭喜考試通過！',
      message: `您獲得了 ${creditsReward} 點數獎勵！eccal 點數餘額：${result.newBalance}`
    });
    
    return result;
  } catch (error) {
    console.error('點數發放失敗:', error);
    // 記錄錯誤，稍後重試
    await queueRetry({
      studentEmail: student.email,
      amount: creditsReward,
      reason: `FABE ${student.courseName} 考試通過`
    });
  }
}
```

---

## 安全性建議

### 1. API Key 保護
- ❌ **不要**將 API Key 硬編碼在前端代碼中
- ✅ **務必**將 API Key 存儲在環境變數或密鑰管理系統中
- ✅ **建議**定期輪換 API Key
- ✅ **必須**只在後端服務器調用此 API

### 2. 請求驗證
```javascript
// ✅ 正確：在後端調用
app.post('/api/student/exam-passed', async (req, res) => {
  // 驗證學員身份和考試結果
  const student = await verifyStudent(req.body.studentId);
  const examResult = await getExamResult(req.body.examId);
  
  if (examResult.passed) {
    // 從後端調用 eccal API
    const result = await addCredits(
      student.email,
      50,
      'FABE 考試通過'
    );
    res.json({ success: true, credits: result.newBalance });
  }
});

// ❌ 錯誤：不要在前端直接調用
// 前端 JavaScript 中不應包含 API Key
```

### 3. 錯誤處理與重試機制
```javascript
async function addCreditsWithRetry(email, amount, reason, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await addCredits(email, amount, reason);
    } catch (error) {
      if (error.response?.data?.code === 'USER_NOT_FOUND') {
        // 用戶不存在，不需要重試
        throw error;
      }
      
      if (i === maxRetries - 1) {
        // 最後一次重試失敗
        throw error;
      }
      
      // 指數退避重試
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}
```

---

## 監控與日誌

### 服務器日誌

每次成功的點數增加都會在服務器記錄：

```
點數增加成功: {
  userId: '550e8400-e29b-41d4-a716-446655440000',
  email: 'user@example.com',
  addedAmount: 50,
  newBalance: 80,
  previousBalance: 30,
  reason: '考試通過獎勵',
  service: 'fabe',
  transactionId: 'tx_1696234567890_abc123def'
}
```

### 建議的監控指標

1. **成功率**：追蹤 API 調用成功/失敗比率
2. **響應時間**：監控 API 響應延遲
3. **錯誤類型**：統計各類錯誤的發生頻率
4. **點數發放量**：追蹤每日/每週點數發放總量

---

## 測試

### 測試帳號
- 請聯繫 eccal 管理員獲取測試用戶帳號

### 測試環境
- **URL**：`http://localhost:5000`（開發環境）
- **API Key**：使用相同的 SERVICE_API_KEY

### 快速測試腳本

項目中已包含 `test-credits-api.sh` 測試腳本，可以快速驗證 API 功能：

```bash
chmod +x test-credits-api.sh
./test-credits-api.sh
```

---

## 常見問題 FAQ

### Q1: 可以扣除點數嗎？
A: 扣除點數請使用另一個端點：`POST /api/account-center/credits/:userId/deduct`（需要相同的 API Key 認證）

### Q2: 如何查詢用戶當前點數？
A: 使用 `GET /api/account-center/credits/:userId`（需要 JWT 認證或 API Key）

### Q3: API Key 洩露了怎麼辦？
A: 立即聯繫 eccal 管理員 (backtrue@gmail.com) 更換 API Key

### Q4: 點數上限是多少？
A: 目前沒有上限，但建議單次增加不超過 1000 點

### Q5: 支援批次增加點數嗎？
A: 目前不支援批次操作，需要逐個用戶調用

---

## 技術支援

**聯繫方式**：
- **Email**：backtrue@gmail.com
- **技術負責人**：eccal 系統管理員

**服務時間**：
- 週一至週五 09:00 - 18:00 (GMT+8)

**緊急問題**：
- 如遇生產環境 API 異常，請立即聯繫技術支援

---

## 更新日誌

### v1.0.0 (2025-10-03)
- ✨ 初始版本發布
- ✅ 支援通過 email 或 userId 增加點數
- ✅ API Key 認證機制
- ✅ 完整的錯誤處理
- ✅ 交易記錄和日誌

---

**文檔版本**：v1.0.0  
**最後更新**：2025-10-03  
**維護者**：eccal 開發團隊
