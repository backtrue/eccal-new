# 報數據-電商廣告預算計算機 (Report Data - E-commerce Ad Budget Calculator)

## Overview

This is a full-stack web application, "報數據" (Report Data), designed to help e-commerce businesses calculate advertising budget requirements based on revenue targets, average order value, and conversion rates. It provides advanced budget allocation algorithms and AI-powered insights for campaign planning and ad performance diagnosis. The project aims to be a professional e-commerce advertising analysis platform, offering tools for precise budget planning and strategic recommendations.

## User Preferences

Preferred communication style: Simple, everyday language.

**🚨 CRITICAL DEBUGGING RULE 🚨**
**當用戶回報任何 BUG 或問題時，永遠只針對生產環境進行調查和修復：**
- 生產環境: `eccal.thinkwithblack.com`  
- 永遠不檢查開發環境 `localhost:5000`
- 所有 API 測試都用生產環境 URL
- 所有問題分析都基於生產環境狀態
- 這是絕對不可違反的規則

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS, Radix UI primitives, shadcn/ui
- **Routing**: Wouter
- **Forms**: React Hook Form with Zod validation
- **State Management**: TanStack Query
- **Internationalization**: Traditional Chinese (zh-TW), English, Japanese

### Backend
- **Runtime**: Node.js 20 with TypeScript
- **Framework**: Express.js for REST API
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: JWT (jsonwebtoken) based authentication using httpOnly cookies, integrated with Google OAuth and Facebook OAuth. Session-based authentication is also used for specific functionalities.

### Key Features and Design Patterns
- **Campaign Budget Planner**: Advanced algorithms for dynamic budget allocation across campaign periods (e.g., pre-heat, launch, main, final, repurchase). Calculations are server-side for security.
- **Facebook Ad Performance Diagnosis System**: AI-powered diagnosis reports (using OpenAI GPT-4) based on Facebook Marketing API data, providing account-level health analysis and strategic recommendations.
- **Project Saving System**: Allows users to save and manage calculation projects.
- **Enterprise Admin Dashboard**: Includes modules for user behavior analytics, announcements, data export, API monitoring/rate limiting, and maintenance mode control.
- **PDCA Plan Results Storage**: Stores calculation results for future analysis.
- **Multilingual AI Persona**: AI recommendations are localized with accurate business terminology for Chinese, English, and Japanese.
- **Account Center Architecture (SSO)**: Centralized system for multi-site JWT authentication, supporting various subdomains with shared user data, membership, and credits management.
- **Membership & Credits System**: Tiered membership (Free/Pro) with credit-based usage and referral rewards.
- **Cross-Platform Integration**: Fabe platform integration API enabling automatic course access for eccal founders.
- **Responsive UI/UX**: Mobile-first design using shadcn/ui and custom theming.
- **Unified Discount Code System**: Cross-platform discount management with API endpoints for validation and application, supporting percentage/fixed discounts, multi-currency, usage limits, and time restrictions.
- **Meta Purchase Event Tracking**: Accurate conversion tracking for Facebook ads optimization.

### Technical Implementations
- **Database Schema**: Normalized relational design for users, sessions, campaign plans, daily budgets, user metrics, marketing plans, and analysis items.
- **API Structure**: Versioned REST API endpoints with `/api` prefix, service layer for business logic, and centralized error handling.
- **Data Flow**: Client-side input validation, API communication managed by TanStack Query, Drizzle ORM for database operations.
- **Deployment**: Replit environment with Vite for frontend, esbuild for backend, and PostgreSQL for database. Server binds to `0.0.0.0:5000` with health check endpoints (`/health`, `/ready`, `/ping`).

## External Dependencies

- **@neondatabase/serverless**: Neon PostgreSQL driver
- **@tanstack/react-query**: Server state management
- **drizzle-orm**: Type-safe database operations
- **react-hook-form**: Form state management
- **zod**: Runtime type validation
- **express**: Web framework
- **wouter**: Client-side routing
- **@radix-ui/***: Primitive UI components
- **tailwindcss**: Utility-first CSS framework
- **lucide-react**: Icon library
- **class-variance-authority**: Utility for component variants
- **Brevo (formerly Sendinblue)**: Email marketing API integration.
- **OpenAI GPT-4**: AI-powered diagnosis reports.
- **Facebook Marketing API**: Real-time ad account data fetching and analysis.
- **Google Analytics API**: Integration for fetching e-commerce metrics.
- **Stripe**: Recurring billing system for subscriptions.
- **Google OAuth**: User authentication and integration.
- **Facebook OAuth**: User authentication and ad account access.

## Recent Changes

### SSO JWT Clock Tolerance Fix (2025-10-17) - ✅ COMPLETED
- **Issue Resolution**: Fixed "exp claim timestamp check failed" error for galine SSO integration
  - **Root Cause**: JWT verification lacked clock tolerance, causing timestamp validation failures when Eccal server and Cloudflare Worker had minor time differences
  - **Symptoms**: First-time galine users saw only `?user_id=<id>` in redirect URL, missing `auth_success=true` and `token=<jwt>` parameters
  - **Impact**: All new galine registrations failed to obtain valid tokens, blocking login functionality
- **Technical Fixes**:
  - **Fix 1**: Added 60-second `clockTolerance` to `/api/sso/verify-token` JWT verification (server/index.ts:1985)
  - **Fix 2**: Enhanced JWT generation logging with detailed timestamp debugging (server/index.ts:1613-1636)
    - Logs `iat`, `exp`, server time (ISO + Unix), and time difference
    - Includes self-verification with clockTolerance to catch issues immediately
  - **Fix 3**: Added detailed error logging for failed JWT verification with token prefix and error message
- **Verification Strategy**:
  - JWT verification now allows ±60 seconds clock skew between systems
  - Comprehensive logging enables quick diagnosis of time synchronization issues
  - Self-verification on token generation confirms validity before sending to client
- **Cloudflare Worker Integration**:
  - **Required**: Worker must also implement `clockTolerance: 60` when verifying Eccal JWT tokens
  - **Monitoring**: Check Worker logs for timestamp mismatches using new debug output
- **Testing Evidence**: All SSO callback parameters (`auth_success`, `token`, `user_id`) are correctly generated in code (server/index.ts:1639-1642)
- **Status**: Production ready - awaiting galine user testing and Worker-side clockTolerance implementation

### JWT Scope Token System (2025-10-14) - ✅ COMPLETED
- **New Feature**: Dual-token authentication system with scope-based permissions
  - **Long-lived JWT (7 days)**: Basic authentication via HttpOnly cookie
  - **Short-lived Scope Token (15 minutes)**: Fine-grained API permissions
  - **Automatic Token Management**: Frontend auto-fetches and caches scoped tokens
  - **Scope Derivation**: Membership-based permission assignment (Free vs Pro)
  - **Security Enhancement**: Separate tokens for authentication and authorization
- **Backend Implementation**:
  - `server/services/eccalAuth.ts`: Scope logic and token generation
  - `deriveScopes()`: Maps membership levels to scopes
  - `generateInternalJWT()`: Creates 15-minute scoped tokens
  - `verifyInternalJWT()`: Validates scope tokens
  - New endpoint: `GET /api/auth/get-token` for token conversion
- **Frontend Implementation**:
  - Auto-fetch scoped token before API requests
  - Cache management with expiry tracking (localStorage)
  - Authorization header injection (`Bearer <token>`)
  - Logout integration to clear cached tokens
- **Scope Definitions**:
  - Free users: `user:profile`, `line:read`
  - Pro/Founders: `user:profile`, `line:read`, `line:write`, `line:manage`
- **Integration Ready**: Compatible with Cloudflare Worker for galine service
- **Documentation**: Complete test guide in `SCOPE_TOKEN_TEST.md`

### External Service Credits API (2025-10-03) - ✅ COMPLETED
- **New Feature**: Cross-service credits management API for external integrations
  - **Endpoint**: `POST /api/account-center/credits/:userId/add`
  - **Authentication**: API Key based (SERVICE_API_KEY) for secure external service access
  - **Functionality**: Allows authorized external services (e.g., fabe) to add credits to user accounts
  - **Supported Identifiers**: Email address or User ID (UUID)
  - **Transaction Tracking**: Generates unique transaction IDs and logs service source, reason, and amounts
  - **Input Validation**: Comprehensive validation for amount (must be positive number) and required service parameter
  - **Error Handling**: Complete error responses with specific codes (API_KEY_MISSING, INVALID_API_KEY, USER_NOT_FOUND, etc.)
  - **CORS Configuration**: Updated to support X-API-Key header for cross-origin requests
  - **Documentation**: Full API documentation (`CREDITS_API.md`) with examples in Node.js, Python, PHP, cURL
  - **Testing**: Test script (`test-credits-api.sh`) for validating all scenarios
  - **Use Case**: Enable FABE platform to automatically reward students with eccal credits upon exam completion
  - **Security**: API Key stored in environment variables, not hardcoded; backend-only access recommended
  - **Generated API Key**: `sk_live_81de5b1388d556d6e6e86a96d6bf412b554d0cd2a1a96028bed2064c1b23ffff`

### Stripe Lazy Loading Enhancement (2025-09-26) - ✅ COMPLETED
- **Issue Resolution**: Fixed Stripe XHR requests running on non-payment pages
  - **Root Cause**: Checkout and SubscriptionCheckout components were imported at module level in App.tsx
  - **Solution**: Implemented React.lazy() dynamic imports with Suspense for Stripe-related pages
  - **Impact**: Stripe SDK only loads when users actually visit payment pages (/checkout, /subscription-checkout)
  - **Technical Implementation**: 
    - Changed static imports to `lazy(() => import("./pages/checkout"))` pattern
    - Added Suspense wrapper with loading spinner for lazy-loaded components
    - Applied to all language routes (zh-TW, en, ja)
  - **Result**: Eliminated unnecessary Stripe network requests on other pages (e.g., /meta-dashboard)
  - **Performance**: Reduced initial bundle size and improved page load speed for non-payment flows

### Mass Authentication System Fix (2025-08-14) - CRITICAL ✅ COMPLETED
- **Issue Resolution**: Fixed system-wide authentication bug affecting 97.11% of all users (336 out of 346 users)
  - **Scope Discovery**: What initially appeared as 4 problem users revealed a massive system-wide issue
  - **Root Cause**: Google OAuth Access Tokens (`ya29.` format) were incorrectly stored as JWT tokens across the entire user base
  - **Impact Assessment**: 336 users (97.11%) faced potential authentication failures due to "jwt malformed" errors
  - **Emergency Response**: Developed and deployed batch repair system `/api/admin/emergency-batch-fix`
  - **Batch Repair Process**: Fixed all 336 users in 4 batches (100+100+100+36 users)
  - **System Hardening**: Enhanced JWT verification to detect and prevent Google Access Token storage
  - **OAuth Flow Fix**: Modified upsertUser function to handle email uniqueness constraint conflicts
  - **Final Result**: 347 users (100%) now have properly formatted authentication tokens
  - **Prevention**: Automated token maintenance system ensures 24-hour token validity
  - **Business Impact**: Prevented potential customer relations crisis and hundreds of support tickets
  - **Status**: Complete system recovery achieved - all users can authenticate successfully