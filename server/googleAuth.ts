import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import type { Express } from "express";
import { storage } from "./storage";
import { secureTokenService } from "./secureTokenService";

export function setupGoogleAuth(app: Express) {
  // Session 和 Passport 中間件已經在 server/index.ts 中設置

  // Get the base URL from environment or request
  const getBaseUrl = (req?: any) => {
    if (process.env.NODE_ENV === 'production') {
      return 'https://eccal.thinkwithblack.com';
    }
    return req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:5000';
  };

  // Google OAuth Strategy
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
      const user = await storage.upsertUser({
        id: profile.id,
        email: profile.emails?.[0]?.value || null,
        firstName: profile.name?.givenName || null,
        lastName: profile.name?.familyName || null,
        profileImageUrl: profile.photos?.[0]?.value || null,
        googleId: profile.id, // Store Google user ID instead of tokens
        // Note: OAuth tokens are now stored securely in secureTokenService
      });

      // 安全地儲存 OAuth tokens 到記憶體快取
      if (user && accessToken) {
        await secureTokenService.storeToken(profile.id, 'google', {
          accessToken,
          refreshToken: refreshToken || undefined,
          expiresAt: new Date(Date.now() + 3600000), // 1小時後過期
        });
        console.log(`✅ OAuth tokens securely stored for user ${profile.id}`);
      }

      return done(null, user || false);
    } catch (error) {
      return done(error, false);
    }
  }));

  // User cache to reduce database queries
  const userCache = new Map<string, { user: any; timestamp: number }>();
  const CACHE_TTL = 5 * 60 * 1000; // 5分鐘快取

  // Clean up expired cache entries every 30 minutes to reduce overhead
  setInterval(() => {
    const now = Date.now();
    userCache.forEach((value, key) => {
      if (now - value.timestamp > CACHE_TTL) {
        userCache.delete(key);
      }
    });
  }, 30 * 60 * 1000);

  // 使用記憶體存儲，不需要清理 session

  // Serialize/Deserialize user for sessions - 按照 PDF 建議修正
  passport.serializeUser((user: any, done) => {
    console.log('Serializing user:', user.id);
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      console.log('Deserializing user:', id);

      // Check cache first
      const cached = userCache.get(id);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('User found in cache:', id);
        return done(null, cached.user);
      }

      // Fetch from database
      const user = await storage.getUser(id);
      console.log('User fetched from database:', user ? user.id : 'not found');

      // Cache the result
      if (user) {
        userCache.set(id, { user, timestamp: Date.now() });
        console.log('User cached:', id);
      }

      done(null, user || null); // 使用 null 而不是 false
    } catch (error) {
      console.error('Deserialization error:', error);
      done(error, null);
    }
  });

  // Login endpoint - redirects to Google OAuth
  app.get('/api/login', (req, res) => {
    console.log('Login endpoint triggered, redirecting to Google OAuth');
    const returnTo = req.query.returnTo as string || req.get('Referer') || '/';
    res.redirect(`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`);
  });

  // Auth routes - force consent to ensure refresh token
  app.get('/api/auth/google', (req, res, next) => {
    console.log('Starting Google OAuth');

    // 檢測 Facebook 內建瀏覽器
    const userAgent = req.get('User-Agent') || '';
    const isFacebookBrowser = userAgent.includes('FBAN') || 
                              userAgent.includes('FBAV') || 
                              userAgent.includes('[FBAN') ||
                              userAgent.includes('Instagram');
    
    if (isFacebookBrowser) {
      console.log('[FB-BROWSER-DETECTED] Facebook browser login attempt:', {
        userAgent: userAgent,
        ip: req.ip,
        timestamp: new Date().toISOString(),
        email: 'jamesboyphs@gmail.com'  // 已知是這位用戶
      });
      
      // 重定向到 Facebook 瀏覽器幫助頁面
      return res.redirect('/facebook-browser-help.html');
    }

    // Save the referring page for post-login redirect
    const returnTo = req.query.returnTo as string || req.get('Referer') || '/';
    (req.session as any).returnTo = returnTo;
    console.log('Saving returnTo in session:', returnTo);

    // Determine language from query parameter or referrer, default to Traditional Chinese
    let language = req.query.hl as string || 'zh-TW';
    
    // Fallback: check referrer if no language parameter
    if (!req.query.hl) {
      const referer = req.get('Referer') || '';
      if (referer.includes('/en/') || referer.includes('/en')) {
        language = 'en';
      } else if (referer.includes('/jp/') || referer.includes('/jp')) {
        language = 'ja';
      }
    }

    // Convert locale codes to Google's expected format
    const googleLanguage = language === 'zh-TW' ? 'zh-TW' : 
                          language === 'ja' ? 'ja' : 
                          'en';

    console.log('Using Google OAuth language:', googleLanguage);

    // 也將 returnTo 加入 state 參數作為備用
    const state = Buffer.from(JSON.stringify({ returnTo, language })).toString('base64');

    passport.authenticate('google', {
      scope: ['profile', 'email', 'https://www.googleapis.com/auth/analytics.readonly'],
      accessType: 'offline',
      prompt: 'consent',
      state: state
    } as any)(req, res, next);
  });

  app.get('/api/auth/google/callback', (req, res, next) => {
    console.log('Google OAuth callback triggered');
    passport.authenticate('google', (err: any, user: any, info: any) => {
      console.log('Google OAuth authenticate result:', { err: !!err, user: !!user, userInfo: user?.email });

      if (err) {
        console.error('Google OAuth error:', err);
        return res.status(500).send('Authentication failed');
      }

      if (!user) {
        console.error('Google OAuth failed - no user returned:', info);
        return res.status(401).send('Authentication failed');
      }

      console.log('Attempting to log in user:', user.id);
      req.logIn(user, async (loginErr) => {
        if (loginErr) {
          console.error('Login error:', loginErr);
          return res.status(500).send('Login failed');
        }

        console.log('User successfully logged in:', user.id);
        console.log('Session ID:', (req.session as any).id);
        console.log('Is authenticated:', req.isAuthenticated());

        // 確保 session 被保存
        (req.session as any).save((saveErr: any) => {
          if (saveErr) {
            console.error('Session save error:', saveErr);
          } else {
            console.log('Session saved successfully');
          }
        });

        try {
          // Process referral if exists
          const referralCode = (req.session as any)?.referralCode;
          if (referralCode && user) {
            try {
              await storage.processReferral(referralCode, user.id);
              delete (req.session as any).referralCode;
            } catch (error) {
              console.error('Error processing referral:', error);
            }
          }

          // Temporarily disable Brevo sync due to IP whitelist issues
          console.log('Brevo sync disabled due to IP whitelist - user email:', user.email);

          // 🔧 CRITICAL FIX: 生成 JWT Token（與 Facebook OAuth 一致）
          const { jwtUtils } = await import('./jwtAuth');
          const jwtToken = jwtUtils.generateToken(user);
          
          // 設置 JWT Cookie
          res.cookie('auth_token', jwtToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
          });
          
          console.log('🔧 JWT token generated and set for Google OAuth user:', user.email);

          const baseUrl = getBaseUrl(req);
          
          // 優先從 session 取得 returnTo，然後從 state 參數
          let returnTo = (req.session as any)?.returnTo || '/';
          try {
            const stateParam = req.query.state as string;
            if (stateParam && !returnTo) {
              const decoded = JSON.parse(Buffer.from(stateParam, 'base64').toString());
              returnTo = decoded.returnTo || '/';
            }
          } catch (error) {
            console.error('Error parsing state parameter:', error);
          }
          
          delete (req.session as any).returnTo; // Clean up after use
          console.log('Using returnTo for redirect:', returnTo);

          // Ensure the redirect URL is properly formatted
          let redirectUrl: string;
          if (returnTo.startsWith('http')) {
            // Absolute URL - use as is
            redirectUrl = `${returnTo}${returnTo.includes('?') ? '&' : '?'}auth_success=1`;
          } else {
            // Relative URL - prepend base URL
            const cleanPath = returnTo.startsWith('/') ? returnTo : `/${returnTo}`;
            redirectUrl = `${baseUrl}${cleanPath}${cleanPath.includes('?') ? '&' : '?'}auth_success=1`;
          }

          console.log('Redirecting to:', redirectUrl);
          res.redirect(redirectUrl);
        } catch (error) {
          console.error('OAuth callback processing error:', error);
          const baseUrl = getBaseUrl(req);
          res.redirect(`${baseUrl}/?error=auth_failed`);
        }
      });
    })(req, res, next);
  });

  app.get('/api/auth/logout', (req, res) => {
    req.logout(() => {
      const baseUrl = getBaseUrl(req);
      res.redirect(`${baseUrl}/`);
    });
  });

  // JWT認證系統中的 /api/auth/user 端點在 jwtAuth.ts 中處理
  // 這裡移除重複的 session 端點以避免衝突
}

// Middleware to check if user is authenticated
export function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }

  // Return 401 for unauthenticated requests - this is the standard HTTP status
  res.status(401).json({ error: 'Authentication required' });
}