# GA4 獨立帳號連結 - 手動測試指南

## 測試目標

驗證用戶可以用 **A 帳號**登入報數據平台，但連結 **B 帳號**的 Google Analytics 權限來存取 GA4 資料。

## 前置準備

### 1. 準備兩個 Google 帳號

- **帳號 A（登入帳號）**：用於登入報數據平台
  - 例如：user@example.com
  
- **帳號 B（GA4 帳號）**：擁有 Google Analytics 權限
  - 例如：analytics@client.com
  - **必須有 GA4 property 的存取權限**

### 2. 確認環境變數

確保以下環境變數已設定（在生產環境）：

```bash
GOOGLE_CLIENT_ID=你的 Google Client ID
GOOGLE_CLIENT_SECRET=你的 Google Client Secret
```

## 測試流程

### 第一步：登入報數據平台

1. 使用 **帳號 A** 登入報數據平台
   - 訪問：https://eccal.thinkwithblack.com
   - 點擊「登入」
   - 使用 user@example.com 登入

2. 確認已成功登入
   - 右上角顯示用戶名稱
   - 可以存取 Dashboard

### 第二步：訪問設定頁面

1. 訪問設定頁面：https://eccal.thinkwithblack.com/settings

2. 確認頁面顯示
   - 標題：「帳號設定」
   - 卡片：「Google Analytics 帳號」
   - 狀態：「未連結」（灰色圓點）
   - 按鈕：「連結 GA4 帳號」

### 第三步：連結 GA4 帳號

1. 點擊「連結 GA4 帳號」按鈕

2. 會重定向到 Google OAuth 授權頁面

3. **重要：選擇或登入帳號 B**（analytics@client.com）
   - 如果已登入帳號 A，點擊「使用其他帳號」
   - 輸入 analytics@client.com 的帳號密碼

4. 授權 Analytics 權限
   - 勾選「查看和管理您的 Google Analytics 資料」
   - 點擊「允許」

5. 重定向回設定頁面

### 第四步：驗證連結成功

確認設定頁面顯示：

- ✅ 狀態：「已連結」（綠色圓點）
- ✅ 連結的帳號：analytics@client.com
- ✅ 連結時間：顯示當前時間
- ✅ 按鈕：「斷開連結」（紅色）

### 第五步：測試使用 GA4 資料

1. 訪問 Calculator 頁面：https://eccal.thinkwithblack.com/calculator

2. 點擊「選擇 GA4 Property」

3. **驗證顯示的是帳號 B 的 properties**
   - 應該看到 analytics@client.com 有權限的 GA4 properties
   - **不應該看到帳號 A 的 properties**

4. 選擇一個 property 並載入資料

5. 確認資料載入成功
   - 顯示 ecommerce 資料
   - 沒有權限錯誤

### 第六步：檢查後端日誌（生產環境）

根據 CRITICAL 規則，檢查生產環境日誌：

```bash
# 在生產環境檢查日誌
# 查找以下訊息：
```

**預期日誌訊息：**

1. 連結時：
```
🔗 User user@example.com starting GA4 account linking
✅ GA4 OAuth successful for user <userId>, linking to analytics@client.com
```

2. 使用 GA4 資料時：
```
✅ Using dedicated GA4 connection for user <userId> (analytics@client.com)
```

3. 如果 token 需要刷新：
```
🔄 GA4 token needs refresh for user <userId>, refreshing now...
✅ GA4 token refreshed for user <userId>
```

### 第七步：測試斷開連結

1. 回到設定頁面：https://eccal.thinkwithblack.com/settings

2. 點擊「斷開連結」按鈕

3. 確認對話框顯示
   - 標題：「確認斷開連結」
   - 訊息：警告會失去 GA4 資料存取權限
   - 按鈕：「取消」和「確認」

4. 點擊「確認」

5. 驗證斷開成功
   - 顯示 toast 提示：「Google Analytics 帳號已成功斷開」
   - 頁面更新為「未連結」狀態
   - 顯示「連結 GA4 帳號」按鈕

6. 再次訪問 Calculator 頁面
   - 應該回復顯示帳號 A 的 GA4 properties（如果有）
   - 或顯示「未連結 Google Analytics」

### 第八步：測試重新連結（可選）

1. 重複第三步，但使用不同的 Google 帳號（帳號 C）

2. 確認連結更新為新帳號

3. 驗證 Calculator 顯示新帳號的 properties

## 資料庫驗證（僅管理員）

### 檢查連結記錄

```sql
-- 查詢連結狀態
SELECT * FROM google_analytics_connections 
WHERE user_id = '<userId>';

-- 預期結果（已連結）：
-- user_id | google_email           | google_id | connected_at | updated_at
-- abc123  | analytics@client.com   | 123...    | 2024-...     | 2024-...
```

### 檢查 Token 記錄

```sql
-- 查詢 token（會顯示加密資料）
SELECT user_id, token_type, expires_at, created_at 
FROM secure_tokens 
WHERE user_id = '<userId>' AND token_type = 'google_analytics';

-- 預期結果（已連結）：
-- user_id | token_type        | expires_at  | created_at
-- abc123  | google_analytics  | 2024-...    | 2024-...
```

## 測試檢查清單

### ✅ 基本功能
- [ ] 能成功啟動 OAuth 流程
- [ ] 能用不同帳號授權
- [ ] 連結資訊正確儲存
- [ ] 設定頁面正確顯示連結狀態
- [ ] 能成功斷開連結

### ✅ GA4 資料存取
- [ ] Calculator 顯示連結帳號的 properties
- [ ] 能載入 ecommerce 資料
- [ ] 後端日誌確認使用專用 token

### ✅ Token 管理
- [ ] Token 正確儲存在資料庫
- [ ] Token 過期後能自動刷新（需等待過期）
- [ ] GA4 token 失效時回退到主帳號（需手動測試）

### ✅ 用戶體驗
- [ ] Loading 狀態顯示
- [ ] 成功提示顯示
- [ ] 錯誤提示顯示
- [ ] 確認對話框正常運作

### ✅ 多語言
- [ ] 繁體中文正常顯示
- [ ] 英文正常顯示
- [ ] 日文正常顯示

## 常見問題排查

### 問題 1：OAuth 授權後顯示「Session expired」

**原因：** Session cookie 過期或未正確設定

**解決：**
1. 檢查 session 設定
2. 確保 cookie 設定正確
3. 重新登入並立即進行連結

### 問題 2：連結後仍顯示帳號 A 的 properties

**原因：** Token 優先級可能有問題

**檢查：**
1. 查看後端日誌，確認是否使用專用 token
2. 檢查資料庫是否有 GA4 連結記錄
3. 重新整理頁面

### 問題 3：Token 刷新失敗

**原因：** Refresh token 可能已過期

**解決：**
1. 斷開連結
2. 重新連結以獲取新的 refresh token

## 成功標準

測試成功的標準：

1. ✅ 用戶可以用帳號 A 登入
2. ✅ 用戶可以連結帳號 B 的 GA4
3. ✅ Calculator 顯示帳號 B 的 properties
4. ✅ 能成功載入帳號 B 的資料
5. ✅ 後端日誌確認使用帳號 B 的 token
6. ✅ 用戶可以成功斷開連結
7. ✅ 斷開後回復顯示帳號 A 的資料

## 測試報告

測試完成後，請記錄以下資訊：

```
測試日期：________
測試者：________
環境：□ 開發環境  □ 生產環境

結果：
- [ ] 所有功能正常運作
- [ ] 部分功能有問題（請說明）：________
- [ ] 功能無法使用（請說明）：________

截圖：
- [ ] 設定頁面（未連結）
- [ ] OAuth 授權頁面
- [ ] 設定頁面（已連結）
- [ ] Calculator 頁面（顯示帳號 B 的 properties）
- [ ] 後端日誌

備註：________
```

---

**重要提醒：** 
- 🚨 根據 CRITICAL 規則，所有測試都應在**生產環境**（eccal.thinkwithblack.com）進行
- 🚨 不要在開發環境（localhost:5000）測試，因為用戶回報的 BUG 都是基於生產環境
