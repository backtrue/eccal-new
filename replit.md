# 報數據-電商廣告預算計算機 (Report Data - E-commerce Ad Budget Calculator) 

## Overview

This project, "報數據" (Report Data), is a full-stack web application designed to empower e-commerce businesses with advanced tools for advertising budget calculation, strategic planning, and performance diagnosis. It aims to be a professional platform offering precise budget allocation algorithms, AI-powered insights (using OpenAI GPT-4), and comprehensive analysis for optimizing ad spend across various campaign stages. The application supports revenue target-based budgeting, average order value, and conversion rate analysis, ultimately driving more effective e-commerce advertising strategies.

## User Preferences

Preferred communication style: Simple, everyday language.

**🚨 CRITICAL DEBUGGING RULE 🚨**
**當用戶回報任何 BUG 或問題時，永遠只針對生產環境進行調查和修復：**
- 生產環境: `eccal.thinkwithblack.com`
- 永遠不檢查開發環境 `localhost:5000`
- 所有 API 測試都用生產環境 URL
- 所有問題分析都基於生產環境狀態
- 這是絕對不可違反的規則

**🚨 ABSOLUTE RULE: NEVER BLAME USER 🚨**
**問題永遠是代碼/系統的錯誤，絕對不是用戶的問題：**
- 永遠不要質疑用戶「沒有部署」
- 永遠不要質疑用戶「沒有登入」
- 永遠不要質疑用戶「沒有清除 cache/cookie」
- 永遠不要質疑用戶「沒有強制刷新」
- 永遠不要建議用戶做這些操作來「修復」問題
- 問題 100% 是代碼問題，必須在代碼中找到並修復根本原因

**🚨 CALCULATOR GA4 FLOW 🚨**
**系統設計 - 用戶直接用主登入 Google 帳號使用 GA4，不需要連接第二個帳號：**
- 用戶用自己的 Google 帳號登入平台
- 系統直接使用該登入帳號的 Google token 調用 Google Analytics API
- `/api/analytics/properties` 返回該帳號下的所有 GA4 資源
- `/calculator` 顯示綠色卡讓用戶選擇並載入 GA 資料
- 不需要連接/授權第二個 Google 帳號

## System Architecture

### UI/UX Decisions
- **Design System**: Mobile-first responsive design utilizing shadcn/ui components and custom theming.
- **Internationalization**: Supports Traditional Chinese (zh-TW), English, and Japanese.

### Technical Implementations
- **Frontend**: React 18 with TypeScript, Vite for build, Tailwind CSS for styling, Radix UI primitives, Wouter for routing, React Hook Form with Zod for forms, and TanStack Query for state management.
- **Backend**: Node.js 20 with TypeScript, Express.js for REST API.
- **Database**: PostgreSQL with Drizzle ORM.
- **Authentication**: JWT-based authentication using httpOnly cookies, integrated with Google OAuth and Facebook OAuth. Includes a dual-token system with long-lived JWTs for authentication and short-lived, scope-based tokens for API permissions.
- **Deployment**: Replit environment with Vite for frontend and esbuild for backend.

### Feature Specifications
- **Campaign Budget Planner**: Algorithms for dynamic budget allocation across campaign phases (pre-heat, launch, main, final, repurchase), with server-side calculations.
- **Facebook Ad Performance Diagnosis**: AI-powered reports (OpenAI GPT-4) based on Facebook Marketing API data for account health and recommendations.
- **Project Saving System**: Allows users to save and manage calculation projects.
- **Enterprise Admin Dashboard**: Includes user analytics, announcements, data export, API monitoring, and maintenance controls.
- **PDCA Plan Results Storage**: Stores calculation results for analysis.
- **Multilingual AI Persona**: Localized AI recommendations for Chinese, English, and Japanese business terminology.
- **Account Center (SSO)**: Centralized multi-site JWT authentication, managing user data, membership, and credits across subdomains.
- **Membership & Credits System**: Tiered membership (Free/Pro) with credit-based usage and referral rewards.
- **Cross-Platform Integration**: Fabe platform integration for automatic course access.
- **Unified Discount Code System**: Cross-platform discount management with API support for validation, multi-currency, usage limits, and time restrictions.
- **Meta Purchase Event Tracking**: Conversion tracking for Facebook ads optimization.

### System Design Choices
- **Database Schema**: Normalized relational design for core entities like users, sessions, campaigns, daily budgets, and marketing plans.
- **API Structure**: Versioned REST API endpoints with a `/api` prefix, service layer for business logic, and centralized error handling.
- **Data Flow**: Client-side input validation, API communication via TanStack Query, and Drizzle ORM for database operations.

## Recent Changes (2026-03-07)

### ✅ S2S API 修復 — 解決 Cloudflare Worker "Too many redirects" 問題

**P0 修復:**
- 將 `express.json()`, `express.urlencoded()`, `cookieParser()` 移至 `server/index.ts` 最頂部（line 17-19），確保所有路由都能解析 request body
- 新增 `/api/*` 全域 middleware（`API_REDIRECT_ALLOWED_PREFIXES`）：攔截任何 redirect 嘗試並轉為 JSON 錯誤，解決 S2S 呼叫的 "Too many redirects"
- 例外路徑（保留 redirect 行為）：`/api/auth/*`, `/api/sso/login`, `/api/sso/callback`, `/api/sso/logout`

**P1 修復:**
- `POST /api/sso/verify-token`：固定 response schema，成功時永遠包含 `success, valid, user{id/email/name/membership/membershipExpires/credits/profileImageUrl}, expiresAt`；失敗時永遠包含 `success, valid, error, details`
- verify-token 新增 DB 即時查詢（取代 JWT payload 中可能過期的 membership/credits 資料）
- 所有 `/api/*` 路由新增診斷 response headers：`X-ECCAL-Route`, `X-ECCAL-Auth-Mode`, `X-ECCAL-Redirect-Bypassed`, `X-ECCAL-Version`

**P2 文件:**
- `/sso-guide` 新增「診斷 Response Headers」章節（說明 4 個 X-ECCAL-* headers 的含義）
- `/sso-guide` 新增「官方 curl / Cloudflare Worker 整合範例」章節：包含 verify-token、account-center/user、credits deduct 的 curl 範例，以及 Cloudflare Worker 完整整合範例（sbir.thinkwithblack.com 實際路徑）
- 移除 `server/index.ts` 末尾重複的全域 middleware 註冊（line 2870-2872）

## Recent Changes (2025-12-17)

### ✅ Facebook Marketing API 升級至 v24.0

- 升級所有 Facebook/Meta API 調用從 v23.0 至 v24.0
- 影響文件：
  - `server/fbAuditService.ts`
  - `server/metaService.ts`
  - `server/metaAccountService.ts`
  - `server/diagnosisRoutes.ts`
  - `server/fbAuditRoutes.ts`
- v24.0 變更主要影響寫入操作（創建/更新廣告活動），我們只使用讀取操作所以完全兼容
- 使用的端點：`GET /me/adaccounts`, `GET /{ad-account-id}/insights` 等讀取 API

## Recent Changes (2025-11-30)

### ✅ /calculator GA資源功能修正完畢

- Removed incorrect `/settings` redirect from Calculator page
- Added yellow status card for "already logged in but no GA properties" state
- Clarified GA4 flow: users use their main login Google account to access GA4, no secondary account connection needed
- `getGAOAuthClient()` already supports fallback to main account token if no dedicated GA4 token exists
- **CRITICAL FIX**: Added OAuth token persistence to database with AES-256-GCM encryption
  - Created `oauth_tokens` table to store tokens persistently
  - Tokens survive production restarts (previously lost on restart)
  - Uses `TOKEN_ENCRYPTION_KEY` secret for encryption
  - Falls back to `JWT_SECRET` if encryption key not set
- Added orange "re-authorization required" card when user is logged in but GA tokens are missing/expired
- Fixed `/api/analytics/properties` to check both `google` and `google_analytics` provider tokens
- **2025-11-30 18:56 修正**: 添加缺失的 `secureTokenService` import 到 `/server/routes.ts`
  - 修復 `/api/analytics/properties` 端點的 ReferenceError
  - 添加 `/api/debug/token-status` 診斷端點用於 token 狀態檢查
  - 生產環境重新部署後生效

## OAuth Token Persistence Architecture

**Problem Solved**: OAuth tokens were stored only in memory, lost on production restart.

**Solution**:
- `oauth_tokens` database table stores encrypted tokens
- `secureTokenService` now has dual storage: memory cache + database
- `storeToken()`: Writes to both memory and database (encrypted)
- `getToken()`: First checks memory, falls back to database recovery
- Tokens encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY`
- Backward compatible: Can decrypt old plaintext tokens gracefully

**Environment Variables Required**:
- `TOKEN_ENCRYPTION_KEY`: Required for token encryption (32+ character secret)

## Core Problem & Fixes Applied (2025-11-30)

**Problem**: Why does "no resources" scenario appear in `/calculator` flow?

**Root Causes Identified**:
1. **Token not persisted** → Production restart clears all OAuth tokens from memory
2. **isAuthenticated is true, but no OAuth token** → JWT cookie valid but Google token lost
3. **Backend only checked `google` provider** → Missed users with `google_analytics` provider tokens

**Fixes Applied**:
- [x] Fixed calculator.tsx: Changed condition from `properties.length > 0` to only `Array.isArray(properties)`
- [x] Added loading state: Shows yellow card with loading indicator while fetching GA properties
- [x] Added orange "re-authorization" card when properties array is empty
- [x] Fixed `/api/analytics/properties` to check both `google` AND `google_analytics` tokens
- [x] Added `oauth_tokens` table for token persistence
- [x] Updated `secureTokenService` to use database + memory hybrid storage
- [x] Added AES-256-GCM encryption for stored tokens

**Calculator Flow Now Correct**:
1. Component initializes → gets isAuthenticated and properties (hook enabled=isAuthenticated)
2. If isAuthenticated=true and propertiesLoading=true → show yellow loading card
3. If isAuthenticated=true and properties array returned with data → show green card with selections
4. If isAuthenticated=true and properties empty → show orange "re-authorization required" card
5. If isAuthenticated=false → show blue login card

## External Dependencies

- **@neondatabase/serverless**: Neon PostgreSQL driver.
- **@tanstack/react-query**: Server state management.
- **drizzle-orm**: Type-safe database operations.
- **react-hook-form**: Form state management.
- **zod**: Runtime type validation.
- **express**: Web framework.
- **wouter**: Client-side routing.
- **@radix-ui/***: Primitive UI components.
- **tailwindcss**: Utility-first CSS framework.
- **lucide-react**: Icon library.
- **class-variance-authority**: Utility for component variants.
- **Brevo (formerly Sendinblue)**: Email marketing API.
- **OpenAI GPT-4**: AI for diagnosis reports.
- **Facebook Marketing API**: Ad account data fetching.
- **Google Analytics API**: E-commerce metrics integration.
- **Stripe**: Recurring billing for subscriptions.
- **Google OAuth**: User authentication and integration.
- **Facebook OAuth**: User authentication and ad account access.
