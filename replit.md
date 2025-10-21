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