import jwt from 'jsonwebtoken';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import passport from 'passport';
import type { Express, Request, Response, NextFunction } from 'express';
import { storage } from './storage';

// JWT 設定
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
const JWT_EXPIRES_IN = '7d'; // 7天有效期

// JWT 用戶介面
interface JWTUser {
  id: string;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  googleAccessToken?: string | null;
  googleRefreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  // Facebook tokens 從資料庫載入，不存在 JWT 中
}

// JWT 工具函數
export const jwtUtils = {
  // 生成 JWT token
  generateToken(user: any): string {
    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        // 移除敏感的 access token，只在資料庫中存儲，透過 middleware 載入
        sub: user.id // 標準 JWT subject claim
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
  },

  // 驗證 JWT token
  verifyToken(token: string): JWTUser | null {
    try {
      // 檢查 token 格式
      if (!token || typeof token !== 'string') {
        console.log('JWT verification failed: invalid token format');
        return null;
      }
      
      // 清理 token（移除可能的前綴或空白）
      const cleanToken = token.trim();
      if (cleanToken.length === 0) {
        console.log('JWT verification failed: empty token');
        return null;
      }
      
      // 檢查是否為 Google Access Token（不是我們的 JWT）
      if (cleanToken.startsWith('ya29.') || cleanToken.startsWith('ya30.')) {
        console.log(`JWT verification failed: this is a Google Access Token, not our JWT`);
        console.log(`Token preview: ${cleanToken.substring(0, 50)}...`);
        return null;
      }
      
      // 檢查 JWT 格式（必須有3個部分）
      const tokenParts = cleanToken.split('.');
      if (tokenParts.length !== 3) {
        console.log(`JWT verification failed: malformed token - has ${tokenParts.length} parts instead of 3`);
        console.log(`Token preview: ${cleanToken.substring(0, 50)}...`);
        return null;
      }
      
      const decoded = jwt.verify(cleanToken, JWT_SECRET) as any;
      return {
        id: decoded.id,
        email: decoded.email,
        firstName: decoded.firstName,
        lastName: decoded.lastName,
        profileImageUrl: decoded.profileImageUrl,
        // Facebook token 不存在 JWT 中，將由 middleware 從資料庫載入
        sub: decoded.sub
      } as JWTUser;
    } catch (error) {
      console.error('JWT verification error:', error);
      return null;
    }
  },

  // 從 request 中提取 JWT token
  extractTokenFromRequest(req: Request): string | null {
    // 1. 從 Authorization header 中提取
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // 2. 從 cookie 中提取
    const cookieToken = req.cookies?.auth_token;
    if (cookieToken) {
      return cookieToken;
    }

    return null;
  }
};

// JWT 中間件
export async function jwtMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = jwtUtils.extractTokenFromRequest(req);
  
  console.log('JWT middleware: token present:', !!token);
  
  if (token) {
    const jwtUser = jwtUtils.verifyToken(token);
    console.log('JWT middleware: token verified:', !!jwtUser);
    if (jwtUser) {
      // 從資料庫重新載入最新的用戶資料（包括 Facebook access token）
      try {
        const { storage } = await import('./storage');
        const fullUser = await storage.getUser(jwtUser.id);
        if (fullUser) {
          console.log('JWT middleware: User loaded from database:', fullUser.email);
          (req as any).user = fullUser;
          (req as any).isAuthenticated = () => true;
        } else {
          console.log('JWT middleware: User not found in database, using JWT data');
          (req as any).user = jwtUser;
          (req as any).isAuthenticated = () => true;
        }
      } catch (error) {
        console.error('JWT middleware: Error loading user from database:', error);
        (req as any).user = jwtUser;
        (req as any).isAuthenticated = () => true;
      }
    }
  } else {
    console.log('JWT middleware: No token found');
  }

  next();
}

// 自動修復過期 token 的中間件
async function autoFixExpiredTokens(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user;
    if (user && user.email) {
      // 檢查 token 是否即將過期或已過期 (少於2小時)
      const tokenExpiresAt = user.tokenExpiresAt ? new Date(user.tokenExpiresAt) : null;
      const now = new Date();
      const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      
      if (!tokenExpiresAt || tokenExpiresAt < twoHoursFromNow) {
        console.log(`[AUTO-FIX] 自動修復即將過期的 token: ${user.email}`);
        
        // 自動延長 token 24小時
        const { storage } = await import('./storage');
        const newTokenExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        
        const { db } = await import('./db');
        const { users } = await import('../shared/schema');
        const { eq } = await import('drizzle-orm');
        
        await db
          .update(users)
          .set({
            tokenExpiresAt: newTokenExpiry,
            updatedAt: now
          })
          .where(eq(users.email, user.email));
        
        // 更新記憶體中的用戶資料
        user.tokenExpiresAt = newTokenExpiry;
        
        console.log(`[AUTO-FIX] 成功延長 ${user.email} 的 token 至: ${newTokenExpiry}`);
      }
    }
  } catch (error) {
    console.error('[AUTO-FIX] Token 自動修復失敗:', error);
  }
  
  next();
}

// 需要認證的路由保護中間件
export function requireJWTAuth(req: Request, res: Response, next: NextFunction) {
  if ((req as any).user) {
    // 自動修復過期 token
    return autoFixExpiredTokens(req, res, next);
  }

  res.status(401).json({ error: 'Authentication required' });
}

// 設置 JWT 為主的 Google OAuth 認證
export function setupJWTGoogleAuth(app: Express) {
  const getBaseUrl = (req?: any) => {
    if (process.env.NODE_ENV === 'production') {
      return 'https://eccal.thinkwithblack.com';
    }
    
    // 在 Replit 環境中，使用實際的外部 URL
    if (req && req.get('host') && req.get('host').includes('replit.dev')) {
      return `${req.protocol}://${req.get('host')}`;
    }
    
    return req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:5000';
  };

  // Google OAuth Strategy (保持相同)
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL: process.env.NODE_ENV === 'production' 
      ? "https://eccal.thinkwithblack.com/api/auth/google/callback"
      : "/api/auth/google/callback",
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/analytics.readonly'
    ]
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      console.log('Google OAuth 策略處理用戶:', {
        profileId: profile.id,
        email: profile.emails?.[0]?.value,
        name: profile.name?.givenName + ' ' + profile.name?.familyName
      });

      // 設置更長的 token 過期時間 (24小時)，避免頻繁過期
      const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24小時
      
      const user = await storage.upsertUser({
        id: profile.id,
        email: profile.emails?.[0]?.value || null,
        firstName: profile.name?.givenName || null,
        lastName: profile.name?.familyName || null,
        profileImageUrl: profile.photos?.[0]?.value || null,
        googleAccessToken: accessToken,
        googleRefreshToken: refreshToken,
        tokenExpiresAt: tokenExpiresAt,
      });

      console.log('用戶 upsert 結果:', {
        success: !!user,
        userId: user?.id,
        email: user?.email
      });

      // 為所有問題用戶增加詳細日誌 (包含新問題用戶 kaoic08@gmail.com)
      const userEmail = profile.emails?.[0]?.value;
      const problemUsers = [
        'kikichuan860618@gmail.com',
        'frances.yeh1966@gmail.com', 
        'jamesboyphs@gmail.com',
        'willy91322@gmail.com',
        'qazwsx132914@gmail.com',
        'kaoic08@gmail.com',
        'pin10andy@gmail.com',
        'ming2635163@gmail.com'
      ];
      
      // 為特定問題用戶增加超詳細日誌
      const criticalUsers = ['jamesboyphs@gmail.com', 'kaoic08@gmail.com', 'pin10andy@gmail.com', 'ming2635163@gmail.com'];
      if (userEmail && criticalUsers.includes(userEmail)) {
        const debugMap: Record<string, string> = {
          'jamesboyphs@gmail.com': 'JAMES-SUPER-DEBUG',
          'kaoic08@gmail.com': 'KAOIC-SUPER-DEBUG', 
          'pin10andy@gmail.com': 'PIN10ANDY-CRITICAL-DEBUG',
          'ming2635163@gmail.com': 'MING-CRITICAL-DEBUG'
        };
        const debugPrefix = debugMap[userEmail];
        console.log(`[${debugPrefix}] 完整認證流程:`, {
          step: 'after_upsert',
          userFound: !!user,
          userId: user?.id,
          userEmail: user?.email,
          tokenExpiresAt: user?.tokenExpiresAt,
          hasGoogleAccessToken: !!user?.googleAccessToken,
          hasGoogleRefreshToken: !!user?.googleRefreshToken,
          profileId: profile.id,
          profileEmail: profile.emails?.[0]?.value,
          membershipLevel: user?.membershipLevel,
          credits: user?.credits,
          timestamp: new Date().toISOString()
        });
      }
      
      if (userEmail && problemUsers.includes(userEmail)) {
        console.log(`[AUTH-DEBUG-${userEmail}] Upsert 完成:`, {
          userCreated: !!user,
          userId: user?.id,
          userEmail: user?.email,
          tokenExpiresAt: user?.tokenExpiresAt,
          timestamp: new Date().toISOString()
        });
      }

      return done(null, user || false);
    } catch (error) {
      console.error('Google OAuth 策略錯誤:', error);
      
      // 嘗試自動修復認證錯誤
      const userEmail = profile?.emails?.[0]?.value;
      if (userEmail && (error as any).message?.includes('token') || (error as any).message?.includes('expired')) {
        console.log(`[AUTO-RECOVERY] 嘗試自動修復 ${userEmail} 的認證錯誤`);
        
        try {
          // 重新生成用戶資料，強制刷新 token
          const user = await storage.upsertUser({
            id: profile.id,
            email: userEmail,
            firstName: profile.name?.givenName || null,
            lastName: profile.name?.familyName || null,
            profileImageUrl: profile.photos?.[0]?.value || null,
            googleAccessToken: accessToken,
            googleRefreshToken: refreshToken,
            tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          });
          
          console.log(`[AUTO-RECOVERY] 成功修復 ${userEmail} 的認證問題`);
          return done(null, user);
        } catch (recoveryError) {
          console.error(`[AUTO-RECOVERY] 無法修復 ${userEmail}:`, recoveryError);
        }
      }
      
      return done(error, false);
    }
  }));

  // 簡化的 serialize/deserialize (JWT 不需要)
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      // 為問題用戶添加詳細的 deserialize 日誌
      const criticalUsers = ['jamesboyphs@gmail.com', 'kaoic08@gmail.com', 'pin10andy@gmail.com', 'ming2635163@gmail.com'];
      
      const user = await storage.getUser(id);
      
      // 為關鍵用戶記錄詳細的 deserialize 過程
      if (user && user.email && criticalUsers.includes(user.email)) {
        const debugMap: Record<string, string> = {
          'jamesboyphs@gmail.com': 'JAMES-DESERIALIZE-DEBUG',
          'kaoic08@gmail.com': 'KAOIC-DESERIALIZE-DEBUG', 
          'pin10andy@gmail.com': 'PIN10ANDY-DESERIALIZE-DEBUG',
          'ming2635163@gmail.com': 'MING-DESERIALIZE-DEBUG'
        };
        const debugPrefix = debugMap[user.email];
        console.log(`[${debugPrefix}] deserializeUser 過程:`, {
          userId: id,
          userFound: !!user,
          email: user.email,
          tokenExpiresAt: user.tokenExpiresAt,
          isTokenExpired: user.tokenExpiresAt ? new Date(user.tokenExpiresAt) < new Date() : null,
          hasGoogleAccessToken: !!user.googleAccessToken,
          membershipLevel: user.membershipLevel,
          timestamp: new Date().toISOString()
        });
      }
      
      // 檢查 token 是否過期
      if (user && user.tokenExpiresAt && new Date(user.tokenExpiresAt) < new Date()) {
        console.log('用戶 token 已過期:', {
          userId: user.id,
          email: user.email,
          expiredAt: user.tokenExpiresAt
        });
        
        // Token 過期時返回 null，強制重新認證
        done(null, null);
        return;
      }
      
      done(null, user || null);
    } catch (error) {
      console.error('deserializeUser 錯誤:', error);
      done(error, null);
    }
  });

  // Google OAuth 起始點
  app.get('/api/auth/google', (req, res, next) => {
    console.log('[GOOGLE-OAUTH] Starting Google OAuth with JWT');
    
    // 防止無限重定向循環
    const userAgent = req.get('User-Agent') || '';
    if (userAgent.includes('HeadlessChrome') || userAgent.includes('bot')) {
      console.log('[GOOGLE-OAUTH] Blocking OAuth for automated request');
      return res.status(400).json({ error: 'OAuth not available for automated requests' });
    }
    
    // 儲存 returnTo 參數到 req 物件 (因為沒有 session)
    const returnTo = req.query.returnTo as string || req.get('Referer') || '/';
    console.log('[GOOGLE-OAUTH] Saving returnTo in request:', returnTo);
    
    // 將 returnTo 作為 state 參數傳遞
    const state = Buffer.from(JSON.stringify({ returnTo })).toString('base64');
    
    passport.authenticate('google', {
      accessType: 'offline',
      prompt: 'consent',
      state: state
    })(req, res, next);
  });

  // Google OAuth 回調 - 生成 JWT
  app.get('/api/auth/google/callback', (req, res, next) => {
    console.log('Google OAuth callback with JWT');
    
    passport.authenticate('google', (err: any, user: any, info: any) => {
      console.log('Google OAuth 回調處理:', {
        hasError: !!err,
        hasUser: !!user,
        userEmail: user?.email,
        errorMessage: err?.message,
        info: info
      });

      if (err) {
        console.error('Google OAuth error details:', {
          error: err,
          message: err.message,
          stack: err.stack
        });
        return res.status(500).send('Authentication failed');
      }

      if (!user) {
        console.error('Google OAuth failed - no user returned:', {
          info: info,
          reason: 'user object is null/undefined',
          profileId: req.query?.state ? 'check state parameter' : 'no state'
        });
        
        // 為所有問題用戶記錄失敗詳情 (包含 pin10andy@gmail.com)
        const problemUsers = [
          'kikichuan860618@gmail.com',
          'frances.yeh1966@gmail.com', 
          'jamesboyphs@gmail.com',
          'willy91322@gmail.com',
          'qazwsx132914@gmail.com',
          'kaoic08@gmail.com',
          'pin10andy@gmail.com',
          'ming2635163@gmail.com'
        ];
        
        // 特別為 jamesboyphs@gmail.com 記錄超詳細失敗信息
        if (req.user && (req.user as any).email === 'jamesboyphs@gmail.com') {
          console.error('[JAMES-SUPER-FAIL] 超詳細失敗記錄:', {
            timestamp: new Date().toISOString(),
            userAgent: req.get('User-Agent'),
            ip: req.ip,
            info: info,
            errorType: 'no_user_returned',
            sessionId: req.sessionID,
            cookies: req.headers.cookie,
            referer: req.get('Referer'),
            acceptLanguage: req.get('Accept-Language')
          });
        }
        
        if (req.user && problemUsers.includes((req.user as any).email)) {
          console.error(`[AUTH-FAIL-${(req.user as any).email}] 登入失敗詳細記錄:`, {
            timestamp: new Date().toISOString(),
            userAgent: req.get('User-Agent'),
            ip: req.ip,
            info: info,
            errorType: 'no_user_returned'
          });
        }
        
        // 提供更詳細的錯誤信息
        const errorMessage = info ? `認證失敗: ${JSON.stringify(info)}` : '認證失敗: 無法建立用戶';
        return res.status(401).send(`Authentication failed: ${errorMessage}`);
      }

      try {
        // 生成 JWT token
        const token = jwtUtils.generateToken(user);
        
        // 調試 JWT token 格式
        console.log('Generated JWT token details:', {
          tokenLength: token.length,
          tokenParts: token.split('.').length,
          tokenPrefix: token.substring(0, 20) + '...',
          isValidJWT: token.split('.').length === 3
        });
        
        // 設置 httpOnly cookie (更安全)
        const cookieOptions = {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax' as const,
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7天
          path: '/' // 確保整個網站都能訪問 cookie
        };
        
        console.log('Setting JWT cookie with options:', cookieOptions);
        res.cookie('auth_token', token, cookieOptions);

        // 處理推薦碼 (如果有)
        // Note: 這裡需要從 query 或其他地方獲取推薦碼
        // 因為沒有 session，我們可以用 query parameter 或其他方式

        console.log('JWT token generated for user:', user.id);

        const baseUrl = getBaseUrl(req);
        
        // 從 state 參數中解析 returnTo
        let returnTo = '/';
        try {
          const stateParam = req.query.state as string;
          if (stateParam) {
            const decoded = JSON.parse(Buffer.from(stateParam, 'base64').toString());
            returnTo = decoded.returnTo || '/';
          }
        } catch (error) {
          console.error('Error parsing state parameter:', error);
          returnTo = '/';
        }
        
        console.log('Extracted returnTo from state:', returnTo);
        
        let redirectUrl: string;
        if (returnTo.startsWith('http')) {
          // 外部 URL - 包含 token (用於跨域 SSO)
          redirectUrl = `${returnTo}${returnTo.includes('?') ? '&' : '?'}auth_success=1&token=${encodeURIComponent(token)}`;
        } else {
          // 內部 URL - 只設置 auth_success (使用 cookie)
          const cleanPath = returnTo.startsWith('/') ? returnTo : `/${returnTo}`;
          redirectUrl = `${baseUrl}${cleanPath}${cleanPath.includes('?') ? '&' : '?'}auth_success=1`;
        }

        console.log('Redirecting to:', redirectUrl);
        res.redirect(redirectUrl);
      } catch (error) {
        console.error('JWT generation error:', error);
        const baseUrl = getBaseUrl(req);
        res.redirect(`${baseUrl}/?error=auth_failed`);
      }
    })(req, res, next);
  });

  // 登出 - 清除 JWT cookie
  app.get('/api/auth/logout', (req, res) => {
    console.log('Clearing JWT cookie for logout');
    res.clearCookie('auth_token', { path: '/' });
    const baseUrl = getBaseUrl(req);
    res.redirect(`${baseUrl}/`);
  });

  // 清除 cookie 測試端點 (僅開發環境)
  if (process.env.NODE_ENV === 'development') {
    app.get('/api/auth/clear-cookie', (req, res) => {
      console.log('Clearing JWT cookie for testing');
      res.clearCookie('auth_token', { path: '/' });
      res.json({ 
        success: true, 
        message: 'JWT cookie cleared',
        timestamp: new Date().toISOString()
      });
    });
  }

  // JWT 狀態診斷端點
  app.get('/api/auth/debug', (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const cookieToken = req.cookies?.auth_token;
      const hasPassportUser = !!(req as any).user;
      let tokenVerification = 'No token';
      
      if (cookieToken) {
        const verified = jwtUtils.verifyToken(cookieToken);
        tokenVerification = verified ? `Valid: ${verified.email}` : 'Invalid token';
      }
      
      console.log('JWT Debug:', {
        authHeader: authHeader ? 'Present' : 'Missing',
        cookieToken: cookieToken ? 'Present' : 'Missing',
        hasPassportUser,
        cookies: Object.keys(req.cookies || {}),
        tokenVerification
      });
      
      res.json({
        authHeader: authHeader ? 'Present' : 'Missing',
        cookieToken: cookieToken ? 'Present' : 'Missing',
        hasPassportUser,
        cookies: Object.keys(req.cookies || {}),
        jwtVerification: tokenVerification
      });
    } catch (error) {
      console.error('Debug endpoint error:', error);
      res.status(500).json({ error: 'Debug failed' });
    }
  });

  // 測試 JWT 設置端點 (僅開發環境)
  if (process.env.NODE_ENV === 'development') {
    app.get('/api/auth/test-jwt', async (req, res) => {
      try {
        // 創建測試用戶
        const testUser = {
          id: 'test-user-123',
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User'
        };
        
        // 生成 JWT token
        const token = jwtUtils.generateToken(testUser);
        
        // 設置 cookie
        const cookieOptions = {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax' as const,
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7天
          path: '/' // 確保整個網站都能訪問 cookie
        };
        
        console.log('Test JWT: Setting cookie with options:', cookieOptions);
        res.cookie('auth_token', token, cookieOptions);
        
        console.log('Test JWT cookie set for:', testUser.email);
        res.json({ 
          success: true, 
          message: 'Test JWT cookie set',
          user: testUser
        });
      } catch (error) {
        console.error('Test JWT error:', error);
        res.status(500).json({ error: 'Test JWT failed' });
      }
    });
  }

  // 前端檢查 cookie 存在性端點
  app.get('/api/auth/check-cookie', (req, res) => {
    const cookies = req.cookies;
    const authToken = cookies?.auth_token;
    
    res.json({
      hasCookie: !!authToken,
      cookieExists: authToken ? 'Yes' : 'No',
      allCookies: Object.keys(cookies || {}),
      timestamp: new Date().toISOString()
    });
  });

  // 簡單的測試登入端點 (開發環境)
  if (process.env.NODE_ENV === 'development') {
    app.post('/api/auth/test-login', async (req, res) => {
      try {
        const testUser = {
          id: 'test-admin-' + Date.now(),
          email: 'backtrue@gmail.com',
          firstName: 'Test',
          lastName: 'Admin'
        };

        const token = jwtUtils.generateToken(testUser);
        
        const cookieOptions = {
          httpOnly: true,
          secure: false,
          sameSite: 'lax' as const,
          maxAge: 7 * 24 * 60 * 60 * 1000,
          path: '/'
        };
        
        res.cookie('auth_token', token, cookieOptions);
        console.log('[TEST-LOGIN] Test admin login created for:', testUser.email);
        
        res.json({ 
          success: true, 
          message: 'Test admin login successful',
          user: testUser,
          redirectTo: '/bdmin'
        });
      } catch (error) {
        console.error('[TEST-LOGIN] Test login error:', error);
        res.status(500).json({ error: 'Test login failed' });
      }
    });
  }

  // 認證狀態檢查端點 - 兼容前端的 /api/auth/check
  app.get('/api/auth/check', jwtMiddleware, (req, res) => {
    try {
      const token = jwtUtils.extractTokenFromRequest(req);
      console.log('Auth check - token present:', !!token);
      
      if ((req as any).user) {
        console.log('JWT auth check successful:', (req as any).user.email);
        res.set('Cache-Control', 'private, max-age=300');
        
        // 安全處理：不暴露敏感的 access tokens 給前端
        const safeUser = {
          id: (req as any).user.id,
          email: (req as any).user.email,
          firstName: (req as any).user.firstName,
          lastName: (req as any).user.lastName,
          profileImageUrl: (req as any).user.profileImageUrl,
          membershipLevel: (req as any).user.membershipLevel,
          credits: (req as any).user.credits,
          // 只提供連接狀態，不暴露實際 token
          hasFacebookAuth: !!(req as any).user.metaAccessToken,
          hasSelectedAdAccount: !!(req as any).user.metaAdAccountId,
          metaAdAccountId: (req as any).user.metaAdAccountId // 廣告帳戶ID可以暴露
        };
        
        res.json({
          isAuthenticated: true,
          user: safeUser
        });
      } else {
        console.log('JWT auth check failed - no valid user in request');
        res.status(401).json({
          isAuthenticated: false,
          user: null
        });
      }
    } catch (error) {
      console.error('Auth check error:', error);
      res.status(500).json({
        isAuthenticated: false,
        user: null,
        error: 'Authentication check failed'
      });
    }
  });

  // JWT Token 提供端點 - 供子服務使用
  app.get('/api/auth/get-token', jwtMiddleware, (req, res) => {
    try {
      if ((req as any).user) {
        // 重新生成一個新的 token（確保最新狀態）
        const token = jwtUtils.generateToken((req as any).user);
        
        res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.json({ 
          token,
          expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7天後過期
        });
        console.log('JWT token provided for user:', (req as any).user.email);
      } else {
        res.status(401).json({ error: 'Not authenticated' });
      }
    } catch (error) {
      console.error('Get token error:', error);
      res.status(500).json({ error: 'Failed to generate token' });
    }
  });

  // 用戶認證狀態 API - 使用 JWT (舊端點，保持向後兼容)
  app.get('/api/auth/user', jwtMiddleware, (req, res) => {
    try {
      const token = jwtUtils.extractTokenFromRequest(req);
      console.log('Auth user - token present:', !!token);
      
      if ((req as any).user) {
        console.log('JWT auth user check successful:', (req as any).user.email);
        res.set('Cache-Control', 'private, max-age=300'); // 5分鐘 cache
        res.json((req as any).user);
      } else {
        console.log('JWT auth check failed: no valid user in request');
        res.status(401).json({ error: 'Not authenticated' });
      }
    } catch (error) {
      console.error('JWT auth endpoint error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

// 工具函數：為現有用戶生成 JWT (一次性遷移用)
export async function generateJWTForExistingUser(userId: string): Promise<string | null> {
  try {
    const user = await storage.getUser(userId);
    if (!user) return null;
    
    return jwtUtils.generateToken(user);
  } catch (error) {
    console.error('Error generating JWT for existing user:', error);
    return null;
  }
}