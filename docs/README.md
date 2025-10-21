# 📚 報數據 - 技術文件索引

本資料夾包含所有技術文件、整合指南、API 規格和系統報告。

---

## 📁 資料夾結構

### `/api` - API 文件
API 規格、端點說明和使用範例

- **CREDITS_API.md** - 跨服務點數管理 API 文件
- **FABE_API_SPEC.md** - FABE 平台整合 API 規格
- **SSO_VERIFY_TOKEN_SPEC.md** - SSO Token 驗證 API 完整規格（含 headers/cookies 詳細說明）⭐ 推薦

### `/integration` - 整合指南
系統整合、SSO、第三方服務串接指南

**🌟 推薦閱讀（按順序）**：
1. **SSO_INTEGRATION_DECISION_GUIDE.md** - 📌 整合方案決策指南（先看這個！）
2. **ECCAL_SSO_ZERO_CONFIG_GUIDE.md** - ⭐ 零配置 SSO 整合（5 分鐘完成，推薦 95% 情況）

**進階/特殊需求**：
- **INTEGRATED_SSO_GUIDE.md** - 統一 SSO 認證整合指南（完整技術文檔）
- **ECCAL_SSO_ADVANCED_FEATURES_2025.md** - SSO 進階功能文件
- **SCOPE_TOKEN_TEST.md** - JWT Scope Token 測試文件

**特定服務整合**：
- **ECCAL_FABE_CROSS_PLATFORM_GUIDE.md** - Eccal-FABE 跨平台整合指南
- **GA_AUTHORIZATION_INTEGRATION_GUIDE.md** - Google Analytics 授權整合
- **FOOTER_INTEGRATION_GUIDE.md** - Footer 元件整合指南
- **PRIVACY_POLICY_INTEGRATION_TEST.md** - 隱私政策整合測試

### `/guides` - 操作指南
功能說明、使用手冊、系統設計文件

**Meta 相關**：
- **META_APP_REVIEW_E2E_GUIDE.md** - Meta App 審核端到端指南
- **META_APP_REVIEW_RESPONSE.md** - Meta App 審核回覆範本

**系統設計**：
- **UNIFIED_DISCOUNT_SYSTEM_DESIGN.md** - 統一折扣系統設計
- **UNIFIED_DISCOUNT_SYSTEM_IMPLEMENTATION.md** - 統一折扣系統實作
- **STRIPE_WEBHOOK_DEBUG_GUIDE.md** - Stripe Webhook 調試指南
- **HANDOVER_DOCUMENT.md** - 系統交接文件

**政策與內容**：
- **NEW_PRIVACY_POLICY.md** - 新版隱私政策
- **NEW_TERMS_OF_SERVICE.md** - 新版服務條款
- **PRIVACY_POLICY_UPDATE_PLAN.md** - 隱私政策更新計畫
- **SERVICE_CONTENT_GUIDE.md** - 服務內容指南
- **SERVICE_PRIVACY_UPDATE_SUMMARY.md** - 服務隱私更新摘要
- **JAPANESE_MARKET_CONTENT.md** - 日本市場內容

### `/reports` - 系統報告
問題診斷、修復報告、系統架構文件

- **API_STATUS_REPORT.md** - API 狀態報告
- **META_PURCHASE_EVENT_FIX_REPORT.md** - Meta Purchase Event 修復報告
- **SYSTEM_HEALTH_REPORT_20250814.md** - 系統健康報告 (2025-08-14)
- **WEBHOOK_PROBLEM_DIAGNOSIS.md** - Webhook 問題診斷
- **META-DASHBOARD-ARCHITECTURE.md** - Meta Dashboard 架構文件

### `/tests` - 測試文件
測試 HTML 頁面、診斷工具

**🌟 推薦測試頁面**：
- **sso-sdk-test.html** - ⭐ SSO SDK 互動測試頁面（可直接使用）

**診斷指南**：
- **SERP_SSO_DIAGNOSTIC_GUIDE.md** - SERP SSO 整合診斷指南（完整排查步驟）
- **ECCAL_SSO_ENDPOINT_TEST_REPORT.md** - ECCAL SSO 端點測試報告（證明無 301 重定向）

**通用測試工具**：
- **emergency-diagnosis.html** - 緊急診斷工具
- **test-google-oauth.html** - Google OAuth 測試
- **test-audai-integration.html** - Audai 整合測試
- **test-integration-fixed.html** - 整合修復測試
- **QUICK_INTEGRATION_TEMPLATE.html** - 快速整合範本

### `/archive` - 歸檔文件
已過時、已解決或已整合到主要文檔的歷史文件

**📦 已歸檔內容**：
- Git 問題解決方案（已解決）
- SSO 整合歷史文件（已整合到新文檔）
- FABE 權限問題處理（已解決）
- 用戶特定測試文件（已完成測試）

📄 **詳細說明**：參考 `/archive/README.md`

⚠️ **重要**：歸檔文件僅供歷史參考，請使用主要文檔進行開發

---

## 🔍 快速查找

### 我想要...

#### 串接外部服務（SSO 整合）
→ 🌟 **第一次整合？先看這個** `/integration/SSO_INTEGRATION_DECISION_GUIDE.md`  
→ ⭐ **快速開始（推薦）** `/integration/ECCAL_SSO_ZERO_CONFIG_GUIDE.md`  
→ 📄 **完整技術文檔** `/integration/INTEGRATED_SSO_GUIDE.md`  
→ 🧪 **互動測試頁面** `/tests/sso-sdk-test.html`

#### 使用 API
→ 查看 `/api/CREDITS_API.md`  
→ 查看 `/api/FABE_API_SPEC.md`  
→ 查看 `/api/SSO_VERIFY_TOKEN_SPEC.md` ⭐ **Token 驗證 API 完整規格**

#### 解決 SSO 問題
→ 🌟 **第一次整合？** `/integration/SSO_INTEGRATION_DECISION_GUIDE.md`  
→ ⭐ **快速開始** `/integration/ECCAL_SSO_ZERO_CONFIG_GUIDE.md`  
→ 📄 **完整技術文檔** `/integration/INTEGRATED_SSO_GUIDE.md`  
→ 🔧 **API 技術規格** `/api/SSO_VERIFY_TOKEN_SPEC.md`  
→ 🧪 **測試工具** `/tests/sso-sdk-test.html`

#### 查看系統架構
→ 查看 `/reports/META-DASHBOARD-ARCHITECTURE.md`  
→ 查看 `/guides/HANDOVER_DOCUMENT.md`

#### 測試功能
→ 查看 `/tests/` 資料夾中的測試頁面

#### 設定折扣系統
→ 查看 `/guides/UNIFIED_DISCOUNT_SYSTEM_DESIGN.md`  
→ 查看 `/guides/UNIFIED_DISCOUNT_SYSTEM_IMPLEMENTATION.md`

---

## 📝 文件維護

### 新增文件時
1. 根據文件類型放入對應資料夾
2. 更新此 README.md 索引
3. 使用清楚的檔名（英文，用底線分隔）

### 文件類型分類
- **API 文件** → `/api/`
- **整合指南** → `/integration/`
- **操作手冊** → `/guides/`
- **問題報告** → `/reports/`
- **測試文件** → `/tests/`
- **過時文件** → `/archive/`

---

## 🆕 最新更新（2025-10-21）⭐ 重大更新

### 🎯 **徹底解決 SSO 整合困難問題**

**問題**：子服務整合 SSO 經常需要修改十幾二十次才成功  
**原因**：文檔過於複雜，缺乏開箱即用的方案  
**解決**：推出零配置 SDK 方案 + 決策指南

- ✅ 新增 **SSO_INTEGRATION_DECISION_GUIDE.md** - 整合方案決策指南
  - 30 秒決策樹：選擇最適合的整合方案
  - 3 種方案比較（SDK / SDK+後端 / 手動整合）
  - 常見情境決策（SaaS、靜態網站、內容平台等）
  - 推薦閱讀順序指引

- ✅ 新增 **ECCAL_SSO_ZERO_CONFIG_GUIDE.md** - 零配置快速整合（推薦 95% 情況）
  - 🚀 **3 步驟 5 分鐘完成整合**（不需要理解 JWT/CORS/API）
  - 📄 完整 HTML 範例（可直接複製使用）
  - ⚛️ React/Vue 整合範例
  - 🎯 95% 情況下不需要後端
  - ✅ 使用現有的 `eccal-auth-sdk.js`（之前被忽略）

- ✅ 新增 **sso-sdk-test.html** - 互動測試頁面
  - 美觀的測試介面
  - 即時事件日誌
  - 測試所有 SDK 功能
  - 可直接部署使用

- ✅ 新增 **ECCAL_SSO_ENDPOINT_TEST_REPORT.md** - 端點測試報告
  - 證明 eccal 端點無 301 重定向問題
  - 完整測試過程和結果
  - 診斷建議和錯誤排查

### 📋 舊文檔（仍然可用）

- ✅ **SERP_SSO_DIAGNOSTIC_GUIDE.md** - SERP 團隊診斷指南（針對後端整合問題）
- ✅ **SSO_VERIFY_TOKEN_SPEC.md** - API 技術規格（給需要手動整合的團隊）
- ✅ **INTEGRATED_SSO_GUIDE.md** - 統一 SSO 認證整合指南（完整技術文檔）

---

**最後更新**：2025-10-19  
**維護者**：Eccal 技術團隊
