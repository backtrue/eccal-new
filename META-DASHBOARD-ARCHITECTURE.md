# Meta 廣告儀表板 (MetaDashboard) 完整架構文檔

## 概述

Meta 廣告儀表板是報數據平台的核心功能之一，提供專業的 Facebook/Meta 廣告數據分析與 AI 驅動的建議系統。系統支援多業務類型的差異化指標展示，整合 Facebook Marketing API 與 OpenAI GPT-4，為廣告主提供深度的投放分析與優化建議。

## 核心架構

### 1. 前端組件架構

#### 主要組件
- **MetaDashboard.tsx** - 主要儀表板組件 (1180 行)
- **FacebookAccountSelector** - 廣告帳戶選擇器
- **NavigationBar** - 導覽列 (包含用戶下拉選單)
- **UserDropdown** - 用戶功能下拉選單

#### 狀態管理
```typescript
// 核心狀態
const [currentStep, setCurrentStep] = useState(1);           // 步驟控制 (1-3)
const [selectedAccount, setSelectedAccount] = useState("");  // 選中的廣告帳戶
const [businessType, setBusinessType] = useState();          // 業務類型
const [level, setLevel] = useState();                        // 數據維度
const [dateRange, setDateRange] = useState();               // 日期範圍
const [analysisResult, setAnalysisResult] = useState();      // GPT 分析結果
```

### 2. 三步驟使用流程

#### 步驟 1：Facebook 連接
- **目的**：建立 Facebook 廣告帳戶授權
- **功能**：
  - Google OAuth 登入驗證
  - Facebook 權限授權 (ads_read, ads_management)
  - Token 有效性檢測與錯誤處理
  - 重新授權機制

#### 步驟 2：廣告帳戶選擇
- **目的**：從授權帳戶中選擇要分析的廣告帳戶
- **功能**：
  - 載入可用廣告帳戶列表
  - 帳戶選擇與驗證
  - 選擇結果持久化儲存

#### 步驟 3：儀表板分析
- **目的**：展示詳細廣告數據與分析
- **功能**：
  - 多維度數據展示
  - 業務類型差異化指標
  - AI 分析建議
  - 數據導出與分享

## 業務類型與指標系統

### 1. 支援的業務類型

#### 電商 (E-commerce)
```typescript
businessType: 'ecommerce'
```
**核心指標**：
- **轉換漏斗**：ViewContent → AddToCart → Purchase
- **轉換率指標**：
  - ATC% (加購率) = AddToCart / ViewContent × 100%
  - PF% (購買率) = Purchase / AddToCart × 100%
- **財務指標**：
  - ROAS (廣告投資回報率)
  - CostPerPurchase (每次購買成本)
  - TotalPurchaseValue (總購買價值)

#### 線上諮詢 (Consultation)
```typescript
businessType: 'consultation'
```
**核心指標**：
- **互動指標**：
  - TotalMessaging (訊息對話開始次數)
  - CostPerMessaging (每次對話成本)
- **轉換分析**：對話品質與轉換效果評估

#### 名單收集 (Lead Generation)
```typescript
businessType: 'lead_generation'
```
**核心指標**：
- **潛客指標**：
  - TotalLeads (潛在顧客數量)
  - CostPerLead (潛客取得成本)
- **品質分析**：名單品質與後續轉換追蹤

### 2. 數據維度層級

```typescript
type Level = 'account' | 'campaign' | 'adset' | 'ad'
```
- **account**：廣告帳戶層級總覽
- **campaign**：行銷活動層級分析
- **adset**：廣告組合層級優化
- **ad**：單一廣告層級細節

## 技術實現

### 1. API 整合架構

#### Facebook Marketing API v23.0
```typescript
// 數據獲取服務
class MetaAccountService {
  private readonly baseUrl = 'https://graph.facebook.com/v23.0';
  
  async getMetaInsightsData(
    accessToken: string,
    adAccountId: string,
    options: {
      level: 'account' | 'campaign' | 'adset' | 'ad';
      dateRange: { since: string; until: string };
      businessType: 'ecommerce' | 'consultation' | 'lead_generation';
      limit?: number;
    }
  ): Promise<MetaDashboardInsight[]>
}
```

**請求參數**：
- `time_range`：指定分析時間範圍
- `fields`：根據業務類型動態選擇指標欄位
- `level`：指定數據層級
- `limit`：控制返回數據量

#### React Query 狀態管理
```typescript
// 主要數據查詢
const { data: dashboardStats, isLoading, error } = useQuery({
  queryKey: [`/api/meta/dashboard?businessType=${businessType}&level=${level}&since=${dateRange.since}&until=${dateRange.until}`],
  enabled: currentStep === 3 && !!selectedAccount
});

// 廣告帳戶列表
const { data: accounts } = useFbAuditAccounts(shouldLoadAccounts);
```

### 2. 身份驗證與授權

#### 多層驗證機制
1. **Google OAuth**：用戶身份驗證
2. **Facebook 授權**：廣告數據存取權限
3. **JWT Token**：會話管理與安全控制

#### 權限範圍
- `ads_read`：讀取廣告帳戶數據
- `ads_management`：存取帳戶管理資訊

### 3. AI 分析系統

#### OpenAI GPT-4 整合
```typescript
// AI 分析請求
const handleGptAnalysis = async () => {
  const response = await apiRequest('POST', '/api/meta/ai-analysis', {
    dashboardData: dashboardStats.data,
    businessType,
    level,
    dateRange
  });
};
```

**分析內容**：
- 廣告表現評估
- 優化建議生成
- 趨勢分析與預測
- 競爭對手洞察

## 使用者體驗設計

### 1. 介面組織

#### 控制面板
- **業務類型選擇器**：動態切換指標顯示
- **數據維度選擇**：account/campaign/adset/ad 層級
- **日期範圍控制**：支援自定義與快捷選項
- **帳戶資訊顯示**：當前分析帳戶確認

#### 快捷時間選項
- 近 7 天
- 近 30 天  
- 近 90 天
- 自定義範圍

### 2. 數據視覺化

#### 核心指標卡片
```typescript
// 共通核心指標
- 花費金額 (Total Spend)
- 曝光數 (Impressions)  
- 連結點擊 (Link Clicks)
- 點擊率 (CTR)
- 單次點擊成本 (CPC)
- 觸及人數 (Reach)
- 頻率 (Frequency)
```

#### 業務專用指標標籤頁
- **電商**：轉換漏斗、ROAS、購買指標
- **諮詢**：對話互動、客戶獲取成本
- **名單**：潛客數量、名單質量評估

### 3. 動態表格系統

#### 自適應欄位
根據選擇的業務類型與層級，動態調整表格欄位：

```typescript
// 電商專用欄位
{businessType === 'ecommerce' && (
  <>
    <th>瀏覽</th>
    <th>加購</th>
    <th>購買</th>
    <th>ROAS</th>
    <th>ATC%</th>
    <th>PF%</th>
  </>
)}
```

#### 排序與篩選
- 多欄位排序支援
- 效能指標篩選
- 搜尋功能整合

## 錯誤處理與用戶體驗

### 1. 錯誤狀態管理

#### Facebook Token 過期
```typescript
const hasFacebookTokenError = Boolean(accountsError && 
  ((accountsError as any)?.message?.includes('500') || 
   (accountsError as any)?.message?.includes('401') ||
   (accountsError as any)?.message?.includes('TOKEN_EXPIRED')));
```

#### 自動重新授權
- 檢測到 Token 失效時自動引導重新授權
- 清除過期快取資料
- 保持用戶會話狀態

### 2. 載入狀態與回饋

#### 分階段載入
- 帳戶載入：`<Loader2 className="w-6 h-6 animate-spin" />`
- 數據獲取：`正在載入廣告數據...`
- AI 分析：`<Sparkles className="w-4 h-4 mr-2" />GPT 分析中...`

#### 錯誤提示
- 權限不足警告
- API 請求失敗處理
- 網路連線問題提示

## 性能優化

### 1. 資料快取策略

```typescript
// React Query 快取配置
staleTime: 5 * 60 * 1000,     // 5分鐘新鮮度
gcTime: 10 * 60 * 1000,       // 10分鐘垃圾回收
retry: false,                  // 關閉自動重試
throwOnError: false           // 組件處理錯誤
```

### 2. 條件式載入

```typescript
// 只在必要時載入數據
enabled: currentStep === 3 && !!selectedAccount
```

### 3. 數據分頁

```typescript
// API 請求限制
limit: (options.limit || 100).toString()
```

## 安全性設計

### 1. 資料隱私

- 不儲存敏感廣告數據
- Token 安全管理
- HTTPS 強制加密傳輸

### 2. 存取控制

- 用戶身份驗證檢查
- Facebook 權限範圍限制
- API 請求頻率限制

## 國際化支援

### 1. 多語言介面
- 繁體中文 (zh-TW) - 預設
- 英文 (en)
- 日文 (ja)

### 2. 在地化內容
```typescript
const t = getTranslations(locale);
// 根據語言載入對應翻譯
```

## 未來擴展計劃

### 1. 功能增強
- Google Ads 整合
- 更多業務類型支援
- 進階 AI 分析功能
- 自動化報告生成

### 2. 技術優化
- 實時數據更新
- 離線數據快取
- 行動裝置優化
- 效能監控整合

## 總結

Meta 廣告儀表板作為報數據平台的核心功能，透過整合 Facebook Marketing API、OpenAI GPT-4 與現代前端技術，提供了專業且易用的廣告分析解決方案。系統設計重點在於業務導向的指標分類、智能化的數據分析，以及優秀的使用者體驗，為廣告主提供具有實用價值的投放洞察與優化建議。