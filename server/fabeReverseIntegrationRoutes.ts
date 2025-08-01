import express from 'express';
import { db } from './db';
import { users, stripePayments } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

const router = express.Router();

// Fabe 通知 eccal 用戶購買年訂閱的端點
router.post('/notify-subscription', async (req, res) => {
  try {
    const { email, subscription_type, amount, currency, fabe_subscription_id, expires_at } = req.body;
    
    if (!email || !subscription_type) {
      return res.status(400).json({
        error: 'Missing required fields: email, subscription_type'
      });
    }

    console.log('Fabe subscription notification:', { email, subscription_type, amount });

    // 查找或創建用戶
    let userResult = await db
      .select()
      .from(users)
      .where(eq(users.email, email));

    let userData;
    if (userResult.length === 0) {
      // 創建新用戶（來自 fabe）
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          service: 'fabe',
          membershipLevel: 'pro', // fabe 年訂閱用戶在 eccal 中也是 pro 級別
          membershipExpires: expires_at ? new Date(expires_at) : null
        })
        .returning();
      userData = newUser;
      console.log('Created new user from fabe:', userData.id);
    } else {
      userData = userResult[0];
      
      // 更新現有用戶的會員資格
      await db
        .update(users)
        .set({
          membershipLevel: 'pro',
          membershipExpires: expires_at ? new Date(expires_at) : null,
          updatedAt: new Date()
        })
        .where(eq(users.id, userData.id));
      
      console.log('Updated existing user membership:', userData.id);
    }

    // 記錄來自 fabe 的訂閱資訊（用特殊的 payment_type）
    const paymentRecord = await db
      .insert(stripePayments)
      .values({
        userId: userData.id,
        stripePaymentIntentId: `fabe_${fabe_subscription_id}_${Date.now()}`, // 唯一標識符
        stripeCustomerId: `fabe_customer_${userData.id}`,
        amount: amount || 99900, // 999 TWD 轉換為分
        currency: currency || 'twd',
        status: 'succeeded',
        paymentType: 'fabe_annual_subscription', // 特殊標識來自 fabe
        description: `Fabe annual subscription - ${subscription_type}`,
        metadata: {
          source: 'fabe',
          fabe_subscription_id,
          original_amount: amount,
          expires_at
        }
      })
      .returning();

    return res.json({
      success: true,
      message: 'Subscription synced successfully',
      user: {
        id: userData.id,
        email: userData.email,
        membership_level: userData.membershipLevel,
        membership_expires: userData.membershipExpires
      },
      payment_record: paymentRecord[0].id
    });

  } catch (error) {
    console.error('Fabe subscription sync error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 檢查用戶是否有 fabe 年訂閱（給 eccal 儀表板使用）
router.get('/check-fabe-subscription/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // 查找用戶的 fabe 訂閱記錄
    const fabeSubscriptions = await db
      .select()
      .from(stripePayments)
      .where(and(
        eq(stripePayments.userId, userId),
        eq(stripePayments.paymentType, 'fabe_annual_subscription'),
        eq(stripePayments.status, 'succeeded')
      ));

    const hasFabeSubscription = fabeSubscriptions.length > 0;
    
    // 獲取最新的訂閱資訊
    const latestSubscription = hasFabeSubscription ? fabeSubscriptions[fabeSubscriptions.length - 1] : null;

    return res.json({
      has_fabe_subscription: hasFabeSubscription,
      subscription_details: latestSubscription ? {
        amount: latestSubscription.amount / 100, // 轉換為元
        currency: latestSubscription.currency,
        created_at: latestSubscription.createdAt,
        expires_at: latestSubscription.metadata?.expires_at || null,
        fabe_subscription_id: latestSubscription.metadata?.fabe_subscription_id
      } : null,
      total_fabe_subscriptions: fabeSubscriptions.length
    });

  } catch (error) {
    console.error('Check fabe subscription error:', error);
    res.status(500).json({ 
      error: 'Failed to check fabe subscription',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 獲取所有有 fabe 訂閱的用戶列表（管理員用）
router.get('/fabe-subscribers', async (req, res) => {
  try {
    const fabeSubscribers = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        membershipLevel: users.membershipLevel,
        membershipExpires: users.membershipExpires,
        createdAt: users.createdAt,
        subscriptionAmount: stripePayments.amount,
        subscriptionDate: stripePayments.createdAt
      })
      .from(users)
      .innerJoin(stripePayments, eq(users.id, stripePayments.userId))
      .where(and(
        eq(stripePayments.paymentType, 'fabe_annual_subscription'),
        eq(stripePayments.status, 'succeeded')
      ));

    return res.json({
      total: fabeSubscribers.length,
      subscribers: fabeSubscribers.map(user => ({
        id: user.id,
        email: user.email,
        name: user.name,
        membership_level: user.membershipLevel,
        membership_expires: user.membershipExpires,
        subscription_amount: user.subscriptionAmount / 100, // 轉換為元
        subscription_date: user.subscriptionDate,
        created_at: user.createdAt
      }))
    });

  } catch (error) {
    console.error('Get fabe subscribers error:', error);
    res.status(500).json({ 
      error: 'Failed to get fabe subscribers',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;