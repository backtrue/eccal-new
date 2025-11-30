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

## Recent Changes (2025-11-30)

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
