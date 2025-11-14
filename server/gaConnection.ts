/**
 * Google Analytics Connection Management
 * Allows users to link a separate Google account for GA4 access
 */
import type { Express } from "express";
import { storage } from "./storage";
import { google } from "googleapis";
import { db } from "./db";
import { googleAnalyticsConnections } from "@shared/schema";
import { eq } from "drizzle-orm";
import { secureTokenService } from "./secureTokenService";

export function setupGAConnection(app: Express) {
  const getBaseUrl = () => {
    if (process.env.NODE_ENV === 'production') {
      return 'https://eccal.thinkwithblack.com';
    }
    return 'http://localhost:5000';
  };

  // Initialize OAuth2 client
  const createOAuth2Client = () => {
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${getBaseUrl()}/api/auth/google-analytics/callback`
    );
  };

  /**
   * Start GA4 account linking process
   * Requires user to be logged in
   */
  app.get('/api/auth/google-analytics', (req: any, res) => {
    // Check if user is logged in
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Not authenticated',
        message: '請先登入再連結 GA4 帳號' 
      });
    }

    const oauth2Client = createOAuth2Client();
    
    // Store user ID in session for callback
    (req.session as any).gaLinkUserId = req.user.id;

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // Force consent to get refresh token
      scope: [
        'profile',
        'email',
        'https://www.googleapis.com/auth/analytics.readonly'
      ],
    });

    console.log(`🔗 User ${req.user.email} starting GA4 account linking`);
    res.redirect(authUrl);
  });

  /**
   * Handle OAuth callback for GA4 linking
   */
  app.get('/api/auth/google-analytics/callback', async (req: any, res) => {
    try {
      const code = req.query.code as string;
      const userId = (req.session as any).gaLinkUserId;

      if (!userId) {
        return res.status(401).send('Session expired. Please try again.');
      }

      const oauth2Client = createOAuth2Client();
      
      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Get user info from Google
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data } = await oauth2.userinfo.get();

      console.log(`✅ GA4 OAuth successful for user ${userId}, linking to ${data.email}`);

      // Get existing connection to preserve refresh token if needed
      const existingConnection = await db
        .select()
        .from(googleAnalyticsConnections)
        .where(eq(googleAnalyticsConnections.userId, userId))
        .limit(1);

      // Determine refresh token to store
      // CRITICAL: Preserve old refresh token if Google doesn't provide a new one
      let refreshTokenToStore = tokens.refresh_token;
      if (!refreshTokenToStore && existingConnection.length > 0) {
        // Fetch old token from secure storage
        const oldToken = await secureTokenService.getToken(userId, 'google_analytics');
        if (oldToken?.refreshToken) {
          refreshTokenToStore = oldToken.refreshToken;
          console.log(`⚠️ Preserving existing refresh token for user ${userId}`);
        }
      }

      // Store tokens securely in secureTokenService
      await secureTokenService.storeToken(userId, 'google_analytics', {
        accessToken: tokens.access_token || '',
        refreshToken: refreshTokenToStore || undefined,
        // Google's expiry_date is already in milliseconds, use it directly
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600000),
      });

      // Store only non-sensitive metadata in database
      const connectionData = {
        userId,
        googleEmail: data.email || '',
        googleId: data.id || '',
        updatedAt: new Date(),
      };

      if (existingConnection.length > 0) {
        // Update existing connection
        await db
          .update(googleAnalyticsConnections)
          .set(connectionData)
          .where(eq(googleAnalyticsConnections.userId, userId));
        
        console.log(`🔄 Updated GA4 connection metadata for user ${userId}`);
      } else {
        // Create new connection
        await db.insert(googleAnalyticsConnections).values(connectionData);
        console.log(`➕ Created new GA4 connection for user ${userId}`);
      }

      // Clear session data
      delete (req.session as any).gaLinkUserId;

      // Redirect to settings page with success message
      res.redirect('/settings?ga_linked=success');
    } catch (error) {
      console.error('GA4 OAuth callback error:', error);
      res.redirect('/settings?ga_linked=error');
    }
  });

  /**
   * Get current GA4 connection status
   */
  app.get('/api/analytics/ga-connection', async (req: any, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const connection = await db
        .select({
          googleEmail: googleAnalyticsConnections.googleEmail,
          createdAt: googleAnalyticsConnections.createdAt,
        })
        .from(googleAnalyticsConnections)
        .where(eq(googleAnalyticsConnections.userId, req.user.id))
        .limit(1);

      if (connection.length === 0) {
        return res.json({ 
          connected: false,
          message: '尚未連結 GA4 帳號' 
        });
      }

      // Check if token exists in secure storage
      const tokenValid = await secureTokenService.hasValidToken(req.user.id, 'google_analytics');

      res.json({
        connected: true,
        googleEmail: connection[0].googleEmail,
        connectedAt: connection[0].createdAt,
        tokenValid,
      });
    } catch (error) {
      console.error('Error fetching GA connection:', error);
      res.status(500).json({ error: 'Failed to fetch GA connection status' });
    }
  });

  /**
   * Disconnect GA4 account
   */
  app.post('/api/analytics/disconnect-ga', async (req: any, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Delete tokens from secure storage
      await secureTokenService.deleteToken(req.user.id, 'google_analytics');

      // Delete metadata from database
      await db
        .delete(googleAnalyticsConnections)
        .where(eq(googleAnalyticsConnections.userId, req.user.id));

      console.log(`🗑️ Disconnected GA4 account for user ${req.user.id}`);

      res.json({ 
        success: true,
        message: 'GA4 帳號已斷開連結' 
      });
    } catch (error) {
      console.error('Error disconnecting GA:', error);
      res.status(500).json({ error: 'Failed to disconnect GA account' });
    }
  });
}

/**
 * Helper function to get OAuth client for GA4 operations
 * Checks for dedicated GA4 connection first, falls back to main account
 * Uses secureTokenService and safe OAuth2 client creation with 32-bit expiry guard
 */
export async function getGAOAuthClient(userId: string): Promise<any> {
  // Try to get dedicated GA4 connection metadata first
  const gaConnection = await db
    .select()
    .from(googleAnalyticsConnections)
    .where(eq(googleAnalyticsConnections.userId, userId))
    .limit(1);

  if (gaConnection.length > 0) {
    // Fetch tokens from secure storage
    const tokenData = await secureTokenService.getToken(userId, 'google_analytics');
    
    if (tokenData) {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );

      // Set credentials with Google's expiry_date
      const credentials: any = {
        access_token: tokenData.accessToken,
        refresh_token: tokenData.refreshToken,
      };

      if (tokenData.expiresAt) {
        // Google's expiry_date is in milliseconds, use it directly
        credentials.expiry_date = tokenData.expiresAt.getTime();
      } else {
        // Default to 1 hour from now
        credentials.expiry_date = Date.now() + 3600000;
      }

      oauth2Client.setCredentials(credentials);
      console.log(`✅ Using dedicated GA4 connection for user ${userId} (${gaConnection[0].googleEmail})`);
      return oauth2Client;
    }
  }

  // Fall back to main account via secure token service
  const { createSecureOAuth2Client } = require('./googleOAuthHelper');
  console.log(`⚠️ No dedicated GA4 connection, falling back to main account for user ${userId}`);
  return await createSecureOAuth2Client(userId);
}
