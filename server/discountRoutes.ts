import express from 'express';
import { db } from './db';
import { discountCodes, discountUsages, serviceConfigs, users } from '@shared/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { requireJWTAuth } from './jwtAuth';
import { z } from 'zod';

const router = express.Router();

// Validation schemas
const validateDiscountSchema = z.object({
  code: z.string().min(1).max(50),
  amount: z.number().positive(),
  currency: z.string().length(3).default('TWD'),
  service_name: z.string().min(1).max(50).default('eccal'),
  user_email: z.string().email().optional(),
  user_id: z.string().optional()
});

const applyDiscountSchema = z.object({
  usage_tracking_id: z.string().uuid(),
  external_transaction_id: z.string().optional(),
  payment_status: z.enum(['pending', 'completed', 'failed']).default('pending')
});

// Temporary storage for pending discount applications
const pendingApplications = new Map<string, any>();

// Cross-platform discount validation (main API for other services)
router.post('/validate-cross-platform', async (req, res) => {
  try {
    const validatedInput = validateDiscountSchema.parse(req.body);
    const { code, amount, currency, service_name, user_email, user_id } = validatedInput;

    console.log(`Validating discount code: ${code} for service: ${service_name}`);

    // Get discount code
    const [discountCode] = await db
      .select()
      .from(discountCodes)
      .where(eq(discountCodes.code, code.toUpperCase()));

    if (!discountCode) {
      return res.status(404).json({
        valid: false,
        error: 'DISCOUNT_NOT_FOUND',
        message: '折扣碼不存在'
      });
    }

    // Check if active
    if (!discountCode.isActive) {
      return res.status(400).json({
        valid: false,
        error: 'DISCOUNT_INACTIVE',
        message: '折扣碼已停用'
      });
    }

    // Check service applicability
    if (!discountCode.applicableServices?.includes(service_name)) {
      return res.status(400).json({
        valid: false,
        error: 'SERVICE_NOT_APPLICABLE',
        message: `此折扣碼不適用於 ${service_name} 服務`
      });
    }

    // Check date validity
    const now = new Date();
    if (discountCode.validFrom && now < discountCode.validFrom) {
      return res.status(400).json({
        valid: false,
        error: 'DISCOUNT_NOT_YET_VALID',
        message: '折扣碼尚未生效'
      });
    }
    if (discountCode.validUntil && now > discountCode.validUntil) {
      return res.status(400).json({
        valid: false,
        error: 'DISCOUNT_EXPIRED',
        message: '折扣碼已過期'
      });
    }

    // Check usage limits
    if (discountCode.usageLimit && discountCode.usedCount >= discountCode.usageLimit) {
      return res.status(400).json({
        valid: false,
        error: 'USAGE_LIMIT_EXCEEDED',
        message: '折扣碼使用次數已達上限'
      });
    }

    // Check per-user limit if user is identified
    if ((user_email || user_id) && discountCode.perUserLimit > 0) {
      let userUsageConditions = [
        eq(discountUsages.discountCodeId, discountCode.id),
        eq(discountUsages.serviceName, service_name),
        eq(discountUsages.paymentStatus, 'completed')
      ];

      if (user_email) {
        userUsageConditions.push(eq(discountUsages.userEmail, user_email));
      }
      if (user_id) {
        userUsageConditions.push(eq(discountUsages.userId, user_id));
      }

      const [userUsage] = await db
        .select({ count: sql<number>`count(*)` })
        .from(discountUsages)
        .where(and(...userUsageConditions));
      if (userUsage && userUsage.count >= discountCode.perUserLimit) {
        return res.status(400).json({
          valid: false,
          error: 'USER_LIMIT_EXCEEDED',
          message: '您已達到此折扣碼的使用次數上限'
        });
      }
    }

    // Check minimum amount
    const amountInCents = currency === 'JPY' ? Math.round(amount) : Math.round(amount * 100);
    if (discountCode.minimumAmount && amountInCents < discountCode.minimumAmount) {
      const minDisplay = currency === 'JPY' 
        ? discountCode.minimumAmount 
        : (discountCode.minimumAmount / 100);
      return res.status(400).json({
        valid: false,
        error: 'MINIMUM_AMOUNT_NOT_MET',
        message: `最低消費金額為 ${currency} ${minDisplay}`
      });
    }

    // Check currency compatibility
    if (discountCode.currency !== 'ALL' && discountCode.currency !== currency) {
      return res.status(400).json({
        valid: false,
        error: 'CURRENCY_MISMATCH',
        message: `此折扣碼僅適用於 ${discountCode.currency}`
      });
    }

    // Calculate discount
    let discountAmount = 0;
    if (discountCode.discountType === 'percentage') {
      discountAmount = Math.round((amountInCents * parseFloat(discountCode.discountValue)) / 100);
    } else if (discountCode.discountType === 'fixed') {
      const fixedDiscount = parseFloat(discountCode.discountValue);
      discountAmount = currency === 'JPY' ? Math.round(fixedDiscount) : Math.round(fixedDiscount * 100);
    }

    const finalAmount = Math.max(0, amountInCents - discountAmount);

    // Generate tracking ID for application
    const usageTrackingId = crypto.randomUUID();
    
    // Store pending application
    pendingApplications.set(usageTrackingId, {
      discountCodeId: discountCode.id,
      userId: user_id,
      userEmail: user_email,
      serviceName: service_name,
      originalAmount: (amountInCents / (currency === 'JPY' ? 1 : 100)).toFixed(2),
      discountAmount: (discountAmount / (currency === 'JPY' ? 1 : 100)).toFixed(2),
      finalAmount: (finalAmount / (currency === 'JPY' ? 1 : 100)).toFixed(2),
      currency: currency,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
      createdAt: new Date()
    });

    // Auto-expire tracking after 30 minutes
    setTimeout(() => {
      pendingApplications.delete(usageTrackingId);
    }, 30 * 60 * 1000);

    res.json({
      valid: true,
      discount_code: {
        id: discountCode.id,
        code: discountCode.code,
        discount_type: discountCode.discountType,
        discount_value: discountCode.discountValue,
        description: discountCode.description
      },
      calculation: {
        original_amount: amountInCents,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        currency: currency
      },
      service_allowed: true,
      usage_tracking_id: usageTrackingId,
      expires_in: 1800 // 30 minutes
    });

  } catch (error) {
    console.error('Error validating discount code:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        valid: false,
        error: 'INVALID_INPUT',
        message: '輸入參數錯誤',
        details: error.errors
      });
    }
    res.status(500).json({
      valid: false,
      error: 'SERVER_ERROR',
      message: '驗證折扣碼時發生錯誤'
    });
  }
});

// Apply discount (complete usage)
router.post('/apply-cross-platform', async (req, res) => {
  try {
    const validatedInput = applyDiscountSchema.parse(req.body);
    const { usage_tracking_id, external_transaction_id, payment_status } = validatedInput;

    // Get pending application
    const pendingApp = pendingApplications.get(usage_tracking_id);
    if (!pendingApp) {
      return res.status(404).json({
        success: false,
        error: 'TRACKING_ID_NOT_FOUND',
        message: '找不到對應的折扣使用記錄或已過期'
      });
    }

    // Record usage
    const [usage] = await db
      .insert(discountUsages)
      .values({
        ...pendingApp,
        externalTransactionId: external_transaction_id,
        paymentStatus: payment_status,
        metadata: {
          applied_via: 'cross_platform_api',
          tracking_id: usage_tracking_id
        }
      })
      .returning();

    // Increment used count if payment is completed
    if (payment_status === 'completed') {
      await db
        .update(discountCodes)
        .set({ 
          usedCount: sql`${discountCodes.usedCount} + 1`,
          updatedAt: new Date()
        })
        .where(eq(discountCodes.id, pendingApp.discountCodeId));
    }

    // Remove from pending
    pendingApplications.delete(usage_tracking_id);

    res.json({
      success: true,
      usage_id: usage.id,
      message: '折扣碼使用記錄已建立'
    });

  } catch (error) {
    console.error('Error applying discount code:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: '輸入參數錯誤',
        details: error.errors
      });
    }
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: '應用折扣碼時發生錯誤'
    });
  }
});

// Legacy validation for eccal internal use
router.post('/validate', requireJWTAuth, async (req: any, res) => {
  try {
    const { code, originalAmount, currency = 'TWD' } = req.body;
    const userId = req.user.id;
    
    // Get user for email
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return res.status(404).json({ message: '用戶不存在' });
    }

    // Use cross-platform validation
    const validation = await fetch(`${req.protocol}://${req.get('host')}/api/discount-codes/validate-cross-platform`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        amount: originalAmount / (currency === 'JPY' ? 1 : 100), // Convert from cents
        currency,
        service_name: 'eccal',
        user_email: user.email,
        user_id: userId
      })
    });

    const result = await validation.json();
    
    if (result.valid) {
      // Convert back to eccal legacy format
      res.json({
        valid: true,
        discountCode: result.discount_code,
        originalAmount,
        discountAmount: result.calculation.discount_amount,
        finalAmount: result.calculation.final_amount,
        currency,
        usage_tracking_id: result.usage_tracking_id
      });
    } else {
      res.status(validation.status).json({
        message: result.message,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Error in legacy validation:', error);
    res.status(500).json({ message: '驗證折扣碼時發生錯誤' });
  }
});

// Get discount analytics (admin only)
router.get('/analytics', requireJWTAuth, async (req: any, res) => {
  try {
    const { code, service_name, date_range } = req.query;
    
    // Check if user is admin
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.user.id));

    if (!user?.isAdmin) {
      return res.status(403).json({ error: '需要管理員權限' });
    }

    let whereConditions = [eq(discountUsages.paymentStatus, 'completed')];

    if (code) {
      whereConditions.push(eq(discountCodes.code, code.toString().toUpperCase()));
    }

    if (service_name && service_name !== 'all') {
      whereConditions.push(eq(discountUsages.serviceName, service_name.toString()));
    }

    if (date_range) {
      const [start, end] = date_range.toString().split(',');
      if (start && end) {
        whereConditions.push(
          sql`${discountUsages.usedAt} >= ${start}`,
          sql`${discountUsages.usedAt} <= ${end}`
        );
      }
    }

    const analytics = await db
      .select({
        code: discountCodes.code,
        serviceName: discountUsages.serviceName,
        usageCount: sql<number>`count(*)`,
        totalDiscount: sql<number>`sum(${discountUsages.discountAmount})`,
        totalRevenue: sql<number>`sum(${discountUsages.finalAmount})`,
        currency: discountUsages.currency
      })
      .from(discountUsages)
      .innerJoin(discountCodes, eq(discountUsages.discountCodeId, discountCodes.id))
      .where(and(...whereConditions))
      .groupBy(discountCodes.code, discountUsages.serviceName, discountUsages.currency);



    res.json({
      analytics,
      total_usage: analytics.reduce((sum, item) => sum + item.usageCount, 0),
      total_discount_given: analytics.reduce((sum, item) => sum + parseFloat(item.totalDiscount.toString()), 0),
      total_revenue_after_discount: analytics.reduce((sum, item) => sum + parseFloat(item.totalRevenue.toString()), 0)
    });

  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: '獲取統計資料時發生錯誤' });
  }
});

export default router;