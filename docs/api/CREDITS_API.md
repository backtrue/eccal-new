# eccal Credits API 使用文檔

## 📌 快速開始

### 1. 設定環境變數

在你的 Replit 項目中設定 Secrets：

```
Key: SERVICE_API_KEY
Value: sk_live_81de5b1388d556d6e6e86a96d6bf412b554d0cd2a1a96028bed2064c1b23ffff
```

### 2. 呼叫 API

```javascript
// Node.js 範例
const response = await fetch(
  `https://eccal.thinkwithblack.com/api/account-center/credits/${userEmail}/add`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.SERVICE_API_KEY  // 從環境變數讀取
    },
    body: JSON.stringify({
      amount: 50,
      reason: '考試通過獎勵',
      service: 'fabe'  // 你的服務名稱
    })
  }
);

const result = await response.json();
console.log(`成功！用戶新餘額: ${result.newBalance}`);
```

---

## 🔌 API 端點

### 增加用戶點數

**POST** `/api/account-center/credits/:userId/add`

#### 路徑參數
- `userId` - 用戶 Email 或 UUID
  - 範例：`student@example.com` 或 `550e8400-e29b-41d4-a716-446655440000`

#### Headers
```
Content-Type: application/json
X-API-Key: <從環境變數讀取>
```

#### Request Body
```json
{
  "amount": 50,           // 必填：增加的點數（正整數）
  "reason": "考試通過",    // 可選：原因說明
  "service": "fabe"       // 必填：服務名稱
}
```

#### 成功回應 (200 OK)
```json
{
  "success": true,
  "userId": "102598988575056957509",
  "email": "student@example.com",
  "newBalance": 92,        // 新餘額
  "addedAmount": 50,       // 本次增加
  "previousBalance": 42,   // 原本餘額
  "transactionId": "tx_1759461858894_lo0w5x8gi",
  "reason": "考試通過",
  "service": "fabe"
}
```

---

## ⚠️ 錯誤處理

### 錯誤回應格式
```json
{
  "success": false,
  "error": "錯誤描述",
  "code": "ERROR_CODE"
}
```

### 常見錯誤

| 狀態碼 | Error Code | 原因 | 解決方案 |
|--------|-----------|------|---------|
| 401 | `API_KEY_MISSING` | 缺少 API Key | 檢查 Header 是否包含 `X-API-Key` |
| 403 | `INVALID_API_KEY` | API Key 錯誤 | 確認環境變數設定正確 |
| 404 | `USER_NOT_FOUND` | 用戶不存在 | 檢查 Email 是否正確 |
| 400 | `INVALID_AMOUNT` | 金額無效 | 確保 amount 是正整數 |
| 400 | `SERVICE_REQUIRED` | 缺少服務名稱 | 提供 service 參數 |

---

## 💻 程式碼範例

### Node.js / Express

```javascript
// 後端 API 路由
app.post('/api/student/exam-passed', async (req, res) => {
  const { studentEmail, courseName } = req.body;
  
  try {
    // 呼叫 eccal API 增加點數
    const response = await fetch(
      `https://eccal.thinkwithblack.com/api/account-center/credits/${studentEmail}/add`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.SERVICE_API_KEY
        },
        body: JSON.stringify({
          amount: 50,
          reason: `${courseName} 考試通過`,
          service: 'fabe'
        })
      }
    );
    
    const result = await response.json();
    
    if (result.success) {
      res.json({
        message: '點數發放成功',
        credits: result.newBalance
      });
    } else {
      res.status(400).json({ error: result.error });
    }
    
  } catch (error) {
    console.error('點數發放失敗:', error);
    res.status(500).json({ error: '系統錯誤' });
  }
});
```

### JavaScript (Fetch with Error Handling)

```javascript
async function rewardStudentCredits(userEmail, amount, reason) {
  try {
    const response = await fetch(
      `https://eccal.thinkwithblack.com/api/account-center/credits/${userEmail}/add`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.SERVICE_API_KEY
        },
        body: JSON.stringify({
          amount,
          reason,
          service: 'fabe'
        })
      }
    );
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`${data.code}: ${data.error}`);
    }
    
    return data;
    
  } catch (error) {
    console.error('點數增加失敗:', error.message);
    throw error;
  }
}

// 使用範例
rewardStudentCredits('student@example.com', 50, 'FABE 課程考試通過')
  .then(result => {
    console.log('✅ 點數發放成功');
    console.log(`新餘額: ${result.newBalance}`);
    console.log(`交易 ID: ${result.transactionId}`);
  })
  .catch(error => {
    console.error('❌ 錯誤:', error.message);
  });
```

### Python

```python
import os
import requests

def add_credits(user_email, amount, reason):
    """為用戶增加 eccal 點數"""
    
    url = f"https://eccal.thinkwithblack.com/api/account-center/credits/{user_email}/add"
    
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": os.environ.get("SERVICE_API_KEY")
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
        
        if data.get("success"):
            print(f"✅ 點數發放成功")
            print(f"新餘額: {data['newBalance']}")
            return data
        else:
            print(f"❌ 錯誤: {data.get('error')}")
            return None
            
    except Exception as e:
        print(f"❌ 請求失敗: {str(e)}")
        return None

# 使用範例
result = add_credits(
    user_email="student@example.com",
    amount=50,
    reason="FABE 課程考試通過"
)
```

### PHP

```php
<?php
function addCredits($userEmail, $amount, $reason) {
    $url = "https://eccal.thinkwithblack.com/api/account-center/credits/{$userEmail}/add";
    
    $data = [
        'amount' => $amount,
        'reason' => $reason,
        'service' => 'fabe'
    ];
    
    $options = [
        'http' => [
            'method'  => 'POST',
            'header'  => 
                "Content-Type: application/json\r\n" .
                "X-API-Key: " . getenv('SERVICE_API_KEY') . "\r\n",
            'content' => json_encode($data)
        ]
    ];
    
    $context = stream_context_create($options);
    $result = file_get_contents($url, false, $context);
    
    if ($result === FALSE) {
        throw new Exception('API 請求失敗');
    }
    
    $response = json_decode($result, true);
    
    if ($response['success']) {
        echo "✅ 點數發放成功，新餘額: {$response['newBalance']}\n";
        return $response;
    } else {
        echo "❌ 錯誤: {$response['error']}\n";
        return null;
    }
}

// 使用範例
addCredits('student@example.com', 50, 'FABE 課程考試通過');
?>
```

---

## 🎯 實際應用場景

### 場景 1: 學員考試通過自動發放點數

```javascript
// FABE 後端：考試成功處理器
async function handleExamSuccess(exam) {
  const student = await getStudent(exam.studentId);
  
  // 根據考試難度決定獎勵點數
  const rewardPoints = {
    'beginner': 30,
    'intermediate': 50,
    'advanced': 100
  };
  
  const amount = rewardPoints[exam.level] || 50;
  
  try {
    const result = await fetch(
      `https://eccal.thinkwithblack.com/api/account-center/credits/${student.email}/add`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.SERVICE_API_KEY
        },
        body: JSON.stringify({
          amount,
          reason: `${exam.courseName} ${exam.level} 考試通過`,
          service: 'fabe'
        })
      }
    );
    
    const data = await result.json();
    
    if (data.success) {
      // 記錄到 FABE 系統
      await logReward({
        studentId: student.id,
        credits: amount,
        transactionId: data.transactionId
      });
      
      // 發送通知給學員
      await sendEmail(student.email, {
        subject: '🎉 恭喜考試通過！',
        body: `您獲得了 ${amount} 點 eccal 點數獎勵！目前餘額：${data.newBalance}`
      });
    }
    
  } catch (error) {
    console.error('點數發放失敗，將加入重試隊列:', error);
    await queueRetry({ studentEmail: student.email, amount, exam });
  }
}
```

### 場景 2: 批次發放獎勵

```javascript
// 批次為多位學員發放點數
async function batchRewardStudents(students, amount, reason) {
  const results = {
    success: [],
    failed: []
  };
  
  for (const student of students) {
    try {
      const response = await fetch(
        `https://eccal.thinkwithblack.com/api/account-center/credits/${student.email}/add`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': process.env.SERVICE_API_KEY
          },
          body: JSON.stringify({
            amount,
            reason,
            service: 'fabe'
          })
        }
      );
      
      const data = await response.json();
      
      if (data.success) {
        results.success.push({
          email: student.email,
          newBalance: data.newBalance
        });
      } else {
        results.failed.push({
          email: student.email,
          error: data.error
        });
      }
      
      // 避免請求過快，加入延遲
      await sleep(100);
      
    } catch (error) {
      results.failed.push({
        email: student.email,
        error: error.message
      });
    }
  }
  
  console.log(`✅ 成功: ${results.success.length}, ❌ 失敗: ${results.failed.length}`);
  return results;
}
```

---

## 🔒 安全性最佳實踐

### ✅ DO（正確做法）

1. **使用環境變數**
   ```javascript
   // ✅ 正確
   'X-API-Key': process.env.SERVICE_API_KEY
   ```

2. **只在後端調用**
   ```javascript
   // ✅ 正確：後端 API
   app.post('/reward', async (req, res) => {
     await callEccalAPI(req.body.email);
   });
   ```

3. **驗證用戶身份**
   ```javascript
   // ✅ 正確：先驗證學員
   const student = await verifyStudent(studentId);
   if (student) {
     await addCredits(student.email, 50);
   }
   ```

### ❌ DON'T（錯誤做法）

1. **不要硬編碼 API Key**
   ```javascript
   // ❌ 錯誤
   'X-API-Key': 'sk_live_abc123...'
   ```

2. **不要在前端調用**
   ```javascript
   // ❌ 錯誤：前端直接調用會洩露 API Key
   <button onClick={() => fetch('https://eccal...', {
     headers: { 'X-API-Key': ... }
   })}>
   ```

3. **不要跳過驗證**
   ```javascript
   // ❌ 錯誤：沒驗證就發放點數
   await addCredits(req.body.email, req.body.amount);
   ```

---

## 🧪 測試

### 本地測試

```bash
# 1. 設定環境變數
export SERVICE_API_KEY="sk_live_81de5b1388d556d6e6e86a96d6bf412b554d0cd2a1a96028bed2064c1b23ffff"

# 2. 測試 API
curl -X POST https://eccal.thinkwithblack.com/api/account-center/credits/test@example.com/add \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SERVICE_API_KEY" \
  -d '{
    "amount": 50,
    "reason": "測試",
    "service": "fabe"
  }'
```

### 測試腳本

專案中已包含測試腳本 `test-credits-api.sh`：

```bash
chmod +x test-credits-api.sh
./test-credits-api.sh
```

---

## 📊 監控建議

### 建議追蹤的指標

1. **API 調用統計**
   - 每日調用次數
   - 成功率 (成功/總數)
   - 平均響應時間

2. **點數發放記錄**
   - 每日發放總點數
   - 每個 service 的發放量
   - 失敗重試次數

3. **錯誤監控**
   - `USER_NOT_FOUND` 次數（可能是 email 錯誤）
   - `INVALID_API_KEY` 次數（可能是配置問題）
   - 系統錯誤次數

### 日誌範例

```javascript
// 記錄每次 API 調用
console.log({
  timestamp: new Date().toISOString(),
  action: 'add_credits',
  email: userEmail,
  amount: amount,
  service: 'fabe',
  transactionId: result.transactionId,
  success: true
});
```

---

## 🔧 故障排除

### 問題 1: 收到 `API_KEY_NOT_CONFIGURED` 錯誤

**原因**: eccal 服務器未設定 SERVICE_API_KEY

**解決**: 聯繫 eccal 管理員確認環境變數設定

### 問題 2: 收到 `INVALID_API_KEY` 錯誤

**檢查項目**:
1. Replit Secrets 中 `SERVICE_API_KEY` 是否正確
2. 重啟服務器讓環境變數生效
3. 檢查代碼是否正確讀取環境變數

```javascript
// 除錯：檢查環境變數
console.log('API Key 是否存在:', !!process.env.SERVICE_API_KEY);
console.log('API Key 前10字元:', process.env.SERVICE_API_KEY?.substring(0, 10));
```

### 問題 3: 收到 `USER_NOT_FOUND` 錯誤

**可能原因**:
1. Email 拼寫錯誤
2. 用戶尚未在 eccal 註冊

**解決**:
1. 確認用戶 email 正確
2. 確認用戶已經在 eccal.thinkwithblack.com 註冊過

---

## 📞 技術支援

**問題回報**:
- Email: backtrue@gmail.com
- 主旨: [FABE-eccal API] 問題描述

**緊急聯繫**:
- 生產環境 API 異常請立即聯繫

---

## 📝 API 資訊

| 項目 | 說明 |
|------|------|
| **基礎 URL** | `https://eccal.thinkwithblack.com` |
| **API Key** | `sk_live_81de5b1388d556d6e6e86a96d6bf412b554d0cd2a1a96028bed2064c1b23ffff` |
| **環境變數名稱** | `SERVICE_API_KEY` |
| **版本** | v1.0.0 |
| **最後更新** | 2025-10-03 |

---

**文檔版本**: v1.0.0  
**維護者**: eccal 開發團隊
