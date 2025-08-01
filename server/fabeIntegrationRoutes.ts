import express from 'express';
import { db } from './db';
import { users, stripePayments } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

const router = express.Router();

// Fabe 權限同步檢查端點
router.get('/sync-permissions', async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        error: 'Email parameter is required'
      });
    }

    console.log('Fabe sync check for email:', email);

    // 查找用戶
    const userResult = await db
      .select()
      .from(users)
      .where(eq(users.email, email));

    if (userResult.length === 0) {
      return res.json({
        hasAccess: false,
        reason: 'user_not_found',
        email
      });
    }

    const userData = userResult[0];
    console.log('Found user:', { id: userData.id, email: userData.email, membership: userData.membershipLevel });

    // 檢查是否為創始會員（有成功的 founders 付款記錄）
    const foundersPayments = await db
      .select()
      .from(stripePayments)
      .where(and(
        eq(stripePayments.userId, userData.id),
        eq(stripePayments.paymentType, 'founders_membership'),
        eq(stripePayments.status, 'succeeded')
      ));

    console.log('Founders payments found:', foundersPayments.length);

    const hasFoundersAccess = foundersPayments.length > 0;

    return res.json({
      hasAccess: hasFoundersAccess,
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        membership_level: userData.membershipLevel
      },
      plan_type: hasFoundersAccess ? 'founders' : null,
      expires_at: null, // 創始會員終身有效
      sync_timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Fabe sync permissions error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 手動觸發 Fabe 同步的端點
router.post('/trigger-sync', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // 檢查該用戶的權限
    const permissionCheck = await fetch(`${req.protocol}://${req.get('host')}/api/fabe/sync-permissions?email=${email}`);
    const permissionData = await permissionCheck.json();

    if (!permissionData.hasAccess) {
      return res.json({
        success: false,
        reason: 'User does not have founders access'
      });
    }

    // TODO: 當 Fabe API 準備好時，在這裡呼叫 Fabe 的授權 API
    /*
    const fabeResponse = await fetch('https://fabe.thinkwithblack.com/api/eccal/grant-access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FABE_API_KEY}`
      },
      body: JSON.stringify({
        email: permissionData.user.email,
        membership_level: 'pro',
        plan_type: 'founders'
      })
    });
    */

    return res.json({
      success: true,
      message: 'Sync triggered successfully',
      user: permissionData.user,
      note: 'Fabe API integration pending - user has valid founders access'
    });

  } catch (error) {
    console.error('Fabe sync trigger error:', error);
    res.status(500).json({ 
      error: 'Failed to trigger sync',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 獲取所有創始會員列表（用於批量同步）
router.get('/founders-list', async (req, res) => {
  try {
    const foundersUsers = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        membershipLevel: users.membershipLevel,
        createdAt: users.createdAt,
        paymentAmount: stripePayments.amount
      })
      .from(users)
      .innerJoin(stripePayments, eq(users.id, stripePayments.userId))
      .where(and(
        eq(stripePayments.paymentType, 'founders_membership'),
        eq(stripePayments.status, 'succeeded')
      ));

    return res.json({
      total: foundersUsers.length,
      users: foundersUsers.map(user => ({
        id: user.id,
        email: user.email,
        name: user.name,
        membership_level: user.membershipLevel,
        payment_amount: user.paymentAmount / 100, // 轉換為元
        created_at: user.createdAt
      }))
    });

  } catch (error) {
    console.error('Get founders list error:', error);
    res.status(500).json({ 
      error: 'Failed to get founders list',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;