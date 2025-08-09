# 報數據-電商廣告預算計算機 (Report Data - E-commerce Ad Budget Calculator)

## Overview

This is a full-stack web application, "報數據" (Report Data), designed to help e-commerce businesses calculate advertising budget requirements based on revenue targets, average order value, and conversion rates. It features a React frontend and a Node.js/Express backend, providing advanced budget allocation algorithms and AI-powered insights for campaign planning and ad performance diagnosis. The project aims to be a professional e-commerce advertising analysis platform, offering tools for precise budget planning and strategic recommendations.

## User Preferences

Preferred communication style: Simple, everyday language.

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
- **Authentication**: JWT (jsonwebtoken) based authentication using httpOnly cookies, integrated with Google OAuth and Facebook OAuth.
- **Session Management**: Session-based for specific functionalities, but moving towards stateless JWT.

### Key Features and Design Patterns
- **Campaign Budget Planner**: Advanced algorithms for 3-60 day campaigns with dynamic budget allocation across pre-heat, launch, main, final, and repurchase periods. Server-side calculation for security.
- **Facebook Ad Performance Diagnosis System**: AI-powered diagnosis reports (using OpenAI GPT-4) based on real-time Facebook Marketing API data, providing account-level health analysis and strategic recommendations. Includes ad account selection and comprehensive permission diagnostics.
- **Project Saving System**: Users can save and manage calculation projects.
- **Enterprise Admin Dashboard**: Modules for user behavior analytics, announcements, data export, API monitoring/rate limiting, and maintenance mode control.
- **PDCA Plan Results Storage**: Stores calculation results for future analysis.
- **Multilingual AI Persona**: AI recommendations are localized for Chinese (小黑老師), English (Mr.Kuro), and Japanese (小黒先生) with accurate business terminology.
- **Account Center Architecture (SSO)**: Centralized system for multi-site JWT authentication, supporting various subdomains with shared user data, membership, and credits management.
- **Membership & Credits System**: Tiered membership (Free/Pro) with credit-based usage and referral rewards.
- **Cross-Platform Integration**: Fully functional Fabe platform integration API enabling automatic course access for eccal founders (5990 NT$ lifetime → 999 NT$/year value).
- **Responsive UI/UX**: Mobile-first design using shadcn/ui and custom theming.

### Technical Implementations
- **Database Schema**: Normalized relational design for users, sessions, campaign plans, daily budgets, user metrics, marketing plans, and analysis items.
- **API Structure**: Versioned REST API endpoints with `/api` prefix, service layer for business logic, and centralized error handling.
- **Data Flow**: Client-side input validation, API communication managed by TanStack Query, Drizzle ORM for database operations.
- **Deployment**: Replit environment with Vite for frontend, esbuild for backend, and PostgreSQL for database.

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
- **Brevo (formerly Sendinblue)**: Email marketing API integration for user sync.
- **OpenAI GPT-4**: AI-powered diagnosis reports.
- **Facebook Marketing API**: Real-time ad account data fetching and analysis.
- **Google Analytics API**: Integration for fetching e-commerce metrics.
- **Stripe**: Recurring billing system for subscriptions.
- **Google OAuth**: User authentication and integration.
- **Facebook OAuth**: User authentication and ad account access.

## Recent Architectural Changes (2025-08-06)

### Unified Discount Code System (NEW)
- **Cross-Platform Discount Management**: Eccal serves as central discount hub for entire ecosystem
  - **API Endpoints**: `/api/discount-codes/validate-cross-platform`, `/api/discount-codes/apply-cross-platform`, `/api/admin/discount-codes/*`
  - **Database Schema**: `discount_codes`, `discount_usages`, `service_configs` tables with cross-service support
  - **Features**: Percentage/fixed discounts, multi-currency (TWD/USD/JPY), usage limits, time restrictions, minimum amounts
  - **Integration**: Works with Stripe payments, supports eccal and fabe services
  - **Admin Interface**: Complete management dashboard for creating and monitoring discount codes
  - **Security**: 30-minute tracking IDs, duplicate prevention, comprehensive usage logging

### Cross-Platform Integration System (2025-08-01)
- **Fabe Platform Integration**: Complete API implementation for cross-platform user synchronization
  - **API Endpoints**: `/api/fabe/sync-permissions`, `/api/fabe/founders-list`, `/api/fabe/trigger-sync`
  - **Business Logic**: Eccal founders (5990 NT$ lifetime payment) automatically receive fabe course access (999 NT$/year value)
  - **Database Integration**: Leverages existing `stripe_payments` table with `payment_type='founders_membership'` identification
  - **Testing Status**: Fully tested with 7 production founders members, all endpoints operational
  - **Documentation**: Comprehensive integration guide created for fabe development team

### Meta Purchase Event Tracking Fix (2025-08-07)
- **Issue Resolution**: Fixed incorrect Purchase event triggering in calculator usage
  - **Problem**: Purchase events were triggering when users completed budget calculations instead of actual payments
  - **Solution**: Moved Purchase event to proper Stripe webhook success handler (`payment_intent.succeeded`)
  - **Implementation**: Added `triggerMetaPurchaseEvent` function and frontend polling mechanism via `useMetaTracking` hook
  - **Impact**: Accurate conversion tracking for Facebook ads optimization and ROI calculation

### Deployment Configuration Optimization (2025-08-09)
- **Issue Resolution**: Fixed deployment initialization failures with port configuration improvements
  - **Server Binding**: Updated server to bind to `0.0.0.0:5000` instead of localhost for deployment compatibility
  - **Health Check Endpoints**: Added `/health`, `/ready`, and `/ping` endpoints for deployment readiness checks
    - `/health`: Basic server status with uptime and memory usage
    - `/ready`: Database connectivity verification with error handling
    - `/ping`: Simple connectivity confirmation
  - **Database Optimization**: Reduced connection pool configuration for better resource management
    - Lowered max connections from 5 to 3, min from 1 to 0 for on-demand connections
    - Shortened timeout values for faster failure detection
  - **External Service Lazy Loading**: Implemented lazy initialization for resource-intensive services
    - Stripe API: Converted to lazy loading pattern to reduce startup time
    - All Stripe calls now use `getStripeInstance()` for on-demand initialization
  - **Error Handling**: Enhanced server startup with proper error handling and graceful shutdown
    - Added port binding validation and descriptive error messages
    - Implemented SIGTERM/SIGINT handlers for clean shutdowns
  - **Impact**: Faster server startup, reduced resource usage, and improved deployment reliability

### SSO Token Format Issue Resolution (2025-08-09)
- **Issue Resolution**: Fixed SSO token format problem where tokens had incorrect JWT structure (1 part instead of 3)
  - **Problem**: Duplicate `/api/sso/verify-token` endpoints causing confusion; JWT tokens not properly passed to external services in URL parameters
  - **Root Cause**: Two different SSO implementations - cookie-based for internal use and URL parameter-based for cross-domain SSO
  - **Solution**: Unified token handling logic
    - Removed duplicate endpoint in `server/accountCenterRoutes.ts`
    - Enhanced JWT token validation with proper 3-part format checking
    - Modified JWT OAuth callback to include token in URL parameters for external domains
    - Added comprehensive token format debugging and validation
  - **Implementation**: Updated `server/jwtAuth.ts` OAuth callback to distinguish between internal (cookie-based) and external (URL parameter-based) redirects
  - **Impact**: Proper SSO functionality for cross-platform authentication with external services