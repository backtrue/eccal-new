# Meta Purchase 事件修正報告

## 🚨 問題診斷

**發現錯誤的 Purchase 事件觸發位置**：
- 文件：`client/src/pages/calculator-simple.tsx`
- 行數：148
- 問題：在計算器完成計算時直接觸發 `trackMetaEvent('Purchase')`

## ❌ 錯誤的觸發時機

```javascript
// 錯誤的代碼（已修正）
trackMetaEvent('Purchase'); // 在計算器使用時觸發
```

這導致：
1. **虛假轉換數據** - 用戶只是使用計算器，並沒有實際購買
2. **廣告優化失準** - Facebook 會認為這些是真實購買
3. **ROI 計算錯誤** - 導致廣告成效分析不準確

## ✅ 修正後的正確邏輯

### 計算器使用時 (現在)
```javascript
trackCalculatorUsage({
  targetRevenue: data.targetRevenue!,
  averageOrderValue: data.averageOrderValue!,
  conversionRate: data.conversionRate!,
  monthlyAdBudget: calculationResults.monthlyAdBudget,
  dailyAdBudget: calculationResults.dailyAdBudget
});
```
觸發：
- `Lead` 事件 - 潛在客戶對工具感興趣
- `CompleteRegistration` 事件 - 完成計算流程

### 實際付款時 (正確的 Purchase 觸發)
```javascript
trackPurchaseEvent({
  paymentType: "founders_membership",
  amount: 599000, // 5990 TWD in cents
  currency: "TWD",
  transactionId: "pi_xxxxx"
});
```
觸發：
- `Purchase` 事件 - 真實的購買轉換

## 🎯 修正效益

### 1. 追蹤數據準確性
- **之前**：計算器使用 = Purchase（錯誤）
- **現在**：實際付款 = Purchase（正確）

### 2. Facebook 廣告優化
- **正確的轉換信號** - 幫助 Facebook 找到真正會購買的用戶
- **準確的 ROI 計算** - 廣告花費與真實收入的正確比例
- **更好的受眾優化** - 基於真實購買行為的相似受眾

### 3. 商業分析準確性
- **真實轉換率** - 計算器使用 vs 實際購買的分開追蹤
- **漏斗分析** - 清楚了解從興趣到購買的轉換路徑
- **準確的 LTV 計算** - 基於真實購買數據

## 📊 事件分層架構

```
用戶旅程                Meta 事件              觸發時機
────────────────────────────────────────────────────────────
1. 瀏覽首頁            PageView              頁面載入
2. 使用計算器          Lead                  完成計算
3. 註冊/登入           CompleteRegistration  用戶註冊
4. 查看定價            ViewContent           定價頁面
5. 開始付款            InitiateCheckout      點擊付款
6. 完成付款            Purchase ⭐           Stripe 成功
```

## 🔮 後續監控

### 檢查項目
- [ ] 確認計算器不再觸發 Purchase 事件
- [ ] 驗證真實付款時 Purchase 事件正常觸發
- [ ] 監控 Facebook 事件管理員中的事件品質評分
- [ ] 比較修正前後的廣告成效數據

### 預期改善
- **事件品質評分提升** - Facebook 給予更高的數據信任度
- **廣告 CPC 降低** - 更準確的優化目標
- **轉換率數據正確** - 真實反映商業表現

---

**總結**：已成功修正錯誤的 Purchase 事件觸發，現在追蹤系統將提供準確的轉換數據，有助於改善 Facebook 廣告效果和商業分析準確性。