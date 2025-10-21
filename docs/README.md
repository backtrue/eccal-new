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

- **GALINE_SSO_FIX_GUIDE.md** - galine SSO JWT 時鐘容忍度修復指南
- **ECCAL_FABE_CROSS_PLATFORM_GUIDE.md** - Eccal-FABE 跨平台整合指南
- **ECCAL_SSO_ADVANCED_FEATURES_2025.md** - SSO 進階功能文件
- **FOOTER_INTEGRATION_GUIDE.md** - Footer 元件整合指南
- **GA_AUTHORIZATION_INTEGRATION_GUIDE.md** - Google Analytics 授權整合
- **INTEGRATED_SSO_GUIDE.md** - 統一 SSO 認證整合指南
- **SCOPE_TOKEN_TEST.md** - JWT Scope Token 測試文件
- **PRIVACY_POLICY_INTEGRATION_TEST.md** - 隱私政策整合測試

### `/guides` - 操作指南
功能說明、使用手冊、系統設計文件

- **META_APP_REVIEW_E2E_GUIDE.md** - Meta App 審核端到端指南
- **META_APP_REVIEW_RESPONSE.md** - Meta App 審核回覆範本
- **PRIVACY_POLICY_UPDATE_PLAN.md** - 隱私政策更新計畫
- **SERVICE_CONTENT_GUIDE.md** - 服務內容指南
- **SERVICE_PRIVACY_UPDATE_SUMMARY.md** - 服務隱私更新摘要
- **STRIPE_WEBHOOK_DEBUG_GUIDE.md** - Stripe Webhook 調試指南
- **UNIFIED_DISCOUNT_SYSTEM_DESIGN.md** - 統一折扣系統設計
- **UNIFIED_DISCOUNT_SYSTEM_IMPLEMENTATION.md** - 統一折扣系統實作
- **HANDOVER_DOCUMENT.md** - 系統交接文件
- **JAPANESE_MARKET_CONTENT.md** - 日本市場內容
- **NEW_PRIVACY_POLICY.md** - 新版隱私政策
- **NEW_TERMS_OF_SERVICE.md** - 新版服務條款

### `/reports` - 系統報告
問題診斷、修復報告、系統架構文件

- **API_STATUS_REPORT.md** - API 狀態報告
- **META_PURCHASE_EVENT_FIX_REPORT.md** - Meta Purchase Event 修復報告
- **SYSTEM_HEALTH_REPORT_20250814.md** - 系統健康報告 (2025-08-14)
- **WEBHOOK_PROBLEM_DIAGNOSIS.md** - Webhook 問題診斷
- **META-DASHBOARD-ARCHITECTURE.md** - Meta Dashboard 架構文件

### `/tests` - 測試文件
測試 HTML 頁面、診斷工具

- **test-*.html** - 各種功能測試頁面
- **emergency-diagnosis.html** - 緊急診斷工具
- **debug-failing-users.html** - 用戶登入問題調試
- **QUICK_INTEGRATION_TEMPLATE.html** - 快速整合範本

### `/archive` - 歸檔文件
已過時或已解決的問題文件

- **GITHUB_COMMIT_GUIDE.md** - GitHub Commit 指南（歷史）
- **GITHUB_PUSH_PROTECTION_FIX.md** - GitHub Push 保護修復（歷史）
- **FINAL_GIT_SOLUTION.md** - Git 問題最終解決方案（歷史）

---

## 🔍 快速查找

### 我想要...

#### 串接外部服務
→ 查看 `/integration/INTEGRATED_SSO_GUIDE.md`  
→ 查看 `/integration/GALINE_SSO_FIX_GUIDE.md`

#### 使用 API
→ 查看 `/api/CREDITS_API.md`  
→ 查看 `/api/FABE_API_SPEC.md`  
→ 查看 `/api/SSO_VERIFY_TOKEN_SPEC.md` ⭐ **Token 驗證 API 完整規格**

#### 解決 SSO 問題
→ 查看 `/integration/INTEGRATED_SSO_GUIDE.md` - 完整整合指南  
→ 查看 `/api/SSO_VERIFY_TOKEN_SPEC.md` ⭐ **API 技術規格（headers/cookies/錯誤處理）**  
→ 查看 `/integration/GALINE_SSO_FIX_GUIDE.md` - 時鐘容忍度修復  
→ 查看 `/integration/ECCAL_SSO_ADVANCED_FEATURES_2025.md` - 進階功能

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

## 🆕 最新更新（2025-10-19）

- ✅ 新增 **SSO_VERIFY_TOKEN_SPEC.md** - `/api/sso/verify-token` 完整技術規格
  - 明確說明必需的 headers 和 cookies
  - 提供 JavaScript, cURL, Python, PHP 完整程式碼範例
  - 詳細錯誤響應和處理建議
- ✅ 更新 **INTEGRATED_SSO_GUIDE.md** - 新增 serp 子域名支援和 API 快速參考

---

**最後更新**：2025-10-19  
**維護者**：Eccal 技術團隊
