import { Router } from 'express';
import { storage } from '../storage';

const router = Router();

// 診斷特定用戶的認證狀態
router.post('/api/admin/diagnose-user', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: '需要提供用戶郵箱' });
    }
    
    console.log(`[USER-DIAGNOSIS] 開始診斷用戶: ${email}`);
    
    // 1. 檢查用戶是否存在
    const users = await storage.getAllUsers();
    const user = users.find(u => u.email === email);
    
    if (!user) {
      return res.status(404).json({ 
        error: '用戶不存在',
        email,
        diagnosis: 'USER_NOT_FOUND'
      });
    }
    
    // 2. 檢查 token 狀態
    const now = new Date();
    const tokenExpiry = user.tokenExpiresAt ? new Date(user.tokenExpiresAt) : null;
    const hoursRemaining = tokenExpiry ? Math.floor((tokenExpiry.getTime() - now.getTime()) / (1000 * 60 * 60)) : 0;
    
    // 3. 檢查 Google OAuth 數據完整性
    const hasGoogleAccessToken = !!user.googleAccessToken;
    const hasGoogleRefreshToken = !!user.googleRefreshToken;
    const tokenLength = user.googleAccessToken ? user.googleAccessToken.length : 0;
    
    // 4. 判斷認證問題的根本原因
    let diagnosis = 'UNKNOWN';
    let issue = '';
    
    if (!hasGoogleAccessToken) {
      diagnosis = 'MISSING_ACCESS_TOKEN';
      issue = '缺少 Google Access Token';
    } else if (!hasGoogleRefreshToken) {
      diagnosis = 'MISSING_REFRESH_TOKEN';
      issue = '缺少 Google Refresh Token';
    } else if (tokenLength < 50) {
      diagnosis = 'INVALID_TOKEN_FORMAT';
      issue = 'Google Access Token 格式異常';
    } else if (!tokenExpiry) {
      diagnosis = 'MISSING_TOKEN_EXPIRY';
      issue = '缺少 Token 過期時間';
    } else if (tokenExpiry < now) {
      diagnosis = 'TOKEN_EXPIRED';
      issue = 'Token 已過期';
    } else if (hoursRemaining < 2) {
      diagnosis = 'TOKEN_EXPIRING_SOON';
      issue = 'Token 即將過期';
    } else {
      diagnosis = 'DATA_LOOKS_GOOD';
      issue = '數據看起來正常，可能是認證流程問題';
    }
    
    const result = {
      success: true,
      email,
      diagnosis,
      issue,
      user: {
        id: user.id,
        email: user.email,
        membershipLevel: user.membershipLevel,
        credits: user.credits,
        lastLogin: user.lastLoginAt,
        created: user.createdAt
      },
      tokenStatus: {
        hasGoogleAccessToken,
        hasGoogleRefreshToken,
        tokenLength,
        tokenExpiry: tokenExpiry?.toISOString(),
        hoursRemaining,
        isExpired: tokenExpiry ? tokenExpiry < now : null,
        isExpiringSoon: hoursRemaining < 2
      },
      recommendation: getRecommendation(diagnosis)
    };
    
    console.log(`[USER-DIAGNOSIS] 診斷完成:`, result);
    
    res.json(result);
    
  } catch (error) {
    console.error('[USER-DIAGNOSIS] 診斷錯誤:', error);
    res.status(500).json({ 
      error: '診斷失敗',
      message: error instanceof Error ? error.message : '未知錯誤'
    });
  }
});

// 批量診斷問題用戶
router.post('/api/admin/diagnose-problem-users', async (req, res) => {
  try {
    const problemUsers = [
      'ming2635163@gmail.com',
      'kaoic08@gmail.com', 
      'pin10andy@gmail.com',
      'jamesboyphs@gmail.com'
    ];
    
    console.log('[BATCH-DIAGNOSIS] 開始批量診斷問題用戶');
    
    const results = [];
    
    for (const email of problemUsers) {
      try {
        const diagnosisReq = { body: { email } };
        const diagnosisRes = { 
          json: (data: any) => results.push(data),
          status: () => ({ json: (data: any) => results.push({ error: true, ...data }) })
        };
        
        // 重用單個用戶診斷邏輯
        const users = await storage.getAllUsers();
        const user = users.find(u => u.email === email);
        
        if (user) {
          const now = new Date();
          const tokenExpiry = user.tokenExpiresAt ? new Date(user.tokenExpiresAt) : null;
          const hoursRemaining = tokenExpiry ? Math.floor((tokenExpiry.getTime() - now.getTime()) / (1000 * 60 * 60)) : 0;
          
          results.push({
            email,
            status: tokenExpiry && tokenExpiry > now ? 'NORMAL' : 'PROBLEM',
            hoursRemaining,
            lastLogin: user.lastLoginAt,
            membershipLevel: user.membershipLevel,
            hasTokens: !!user.googleAccessToken && !!user.googleRefreshToken
          });
        } else {
          results.push({
            email,
            status: 'USER_NOT_FOUND',
            error: '用戶不存在'
          });
        }
      } catch (error) {
        results.push({
          email,
          status: 'DIAGNOSIS_ERROR',
          error: error instanceof Error ? error.message : '診斷失敗'
        });
      }
    }
    
    const summary = {
      totalUsers: problemUsers.length,
      normalUsers: results.filter(r => r.status === 'NORMAL').length,
      problemUsers: results.filter(r => r.status !== 'NORMAL').length,
      timestamp: new Date().toISOString()
    };
    
    console.log('[BATCH-DIAGNOSIS] 批量診斷完成:', summary);
    
    res.json({
      success: true,
      summary,
      results
    });
    
  } catch (error) {
    console.error('[BATCH-DIAGNOSIS] 批量診斷錯誤:', error);
    res.status(500).json({
      error: '批量診斷失敗',
      message: error instanceof Error ? error.message : '未知錯誤'
    });
  }
});

function getRecommendation(diagnosis: string): string {
  switch (diagnosis) {
    case 'MISSING_ACCESS_TOKEN':
      return '建議：重新進行 Google OAuth 認證以獲取 Access Token';
    case 'MISSING_REFRESH_TOKEN':
      return '建議：重新進行 Google OAuth 認證以獲取 Refresh Token';
    case 'INVALID_TOKEN_FORMAT':
      return '建議：清除現有 Token 並重新認證';
    case 'TOKEN_EXPIRED':
      return '建議：使用自動修復 API 延長 Token 有效期';
    case 'TOKEN_EXPIRING_SOON':
      return '建議：預防性延長 Token 有效期';
    case 'DATA_LOOKS_GOOD':
      return '建議：檢查 JWT 中間件和認證流程，可能是服務器端問題';
    default:
      return '建議：需要進一步調查認證流程';
  }
}

export default router;