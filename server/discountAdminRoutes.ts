import express from 'express';
import { db } from './db';
import { discountCodes, discountUsages, users } from '@shared/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { requireJWTAuth } from './jwtAuth';
import { z } from 'zod';

const router = express.Router();

// Admin middleware
const requireAdmin = async (req: any, res: any, next: any) => {
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.user.id));

    if (!user?.isAdmin) {
      return res.status(403).json({ error: '需要管理員權限' });
    }
    next();
  } catch (error) {
    res.status(500).json({ error: '權限驗證失敗' });
  }
};

// Validation schema for creating discount codes
const createDiscountCodeSchema = z.object({
  code: z.string().min(1).max(50).transform(s => s.toUpperCase()),
  discountType: z.enum(['percentage', 'fixed']),
  discountValue: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3).default('ALL'),
  applicableServices: z.array(z.string()).default(['eccal', 'fabe']),
  usageLimit: z.number().positive().optional(),
  perUserLimit: z.number().positive().default(1),
  minimumAmount: z.number().positive().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  description: z.string().optional(),
  campaignName: z.string().max(100).optional(),
  isActive: z.boolean().default(true)
});

// Create discount code (admin only)
router.post('/create', requireJWTAuth, requireAdmin, async (req: any, res) => {
  try {
    const validatedData = createDiscountCodeSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.id, req.user.id));

    // Convert minimum amount to cents if provided
    const minimumAmountInCents = validatedData.minimumAmount 
      ? (validatedData.currency === 'JPY' ? validatedData.minimumAmount : validatedData.minimumAmount * 100)
      : undefined;

    const [discountCode] = await db
      .insert(discountCodes)
      .values({
        code: validatedData.code,
        discountType: validatedData.discountType,
        discountValue: validatedData.discountValue,
        currency: validatedData.currency,
        applicableServices: validatedData.applicableServices,
        usageLimit: validatedData.usageLimit,
        perUserLimit: validatedData.perUserLimit,
        minimumAmount: minimumAmountInCents,
        validFrom: validatedData.validFrom ? new Date(validatedData.validFrom) : null,
        validUntil: validatedData.validUntil ? new Date(validatedData.validUntil) : null,
        description: validatedData.description,
        campaignName: validatedData.campaignName,
        isActive: validatedData.isActive,
        createdBy: user?.email || 'admin'
      })
      .returning();

    res.json({
      success: true,
      discountCode,
      message: '折扣碼創建成功'
    });

  } catch (error) {
    console.error('Error creating discount code:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: '輸入參數錯誤',
        details: error.errors
      });
    }
    
    // Handle unique constraint violation
    if ((error as any)?.code === '23505') {
      return res.status(400).json({
        error: 'CODE_EXISTS',
        message: '此折扣碼已存在'
      });
    }

    res.status(500).json({
      error: 'SERVER_ERROR',
      message: '創建折扣碼失敗'
    });
  }
});

// List all discount codes (admin only)
router.get('/list', requireJWTAuth, requireAdmin, async (req: any, res) => {
  try {
    const { page = 1, limit = 20, active_only } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereConditions = [];
    if (active_only === 'true') {
      whereConditions.push(eq(discountCodes.isActive, true));
    }

    const codes = await db
      .select({
        id: discountCodes.id,
        code: discountCodes.code,
        discountType: discountCodes.discountType,
        discountValue: discountCodes.discountValue,
        currency: discountCodes.currency,
        applicableServices: discountCodes.applicableServices,
        usageLimit: discountCodes.usageLimit,
        usedCount: discountCodes.usedCount,
        perUserLimit: discountCodes.perUserLimit,
        minimumAmount: discountCodes.minimumAmount,
        isActive: discountCodes.isActive,
        validFrom: discountCodes.validFrom,
        validUntil: discountCodes.validUntil,
        description: discountCodes.description,
        campaignName: discountCodes.campaignName,
        createdBy: discountCodes.createdBy,
        createdAt: discountCodes.createdAt,
        updatedAt: discountCodes.updatedAt
      })
      .from(discountCodes)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(discountCodes.createdAt))
      .limit(parseInt(limit))
      .offset(offset);

    // Get total count
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(discountCodes)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

    res.json({
      codes: codes.map(code => ({
        ...code,
        minimumAmountDisplay: code.minimumAmount 
          ? (code.currency === 'JPY' ? code.minimumAmount : code.minimumAmount / 100)
          : null
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error listing discount codes:', error);
    res.status(500).json({ error: '獲取折扣碼列表失敗' });
  }
});

// Update discount code (admin only)
router.put('/:id', requireJWTAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const updates = req.body;

    // Process minimum amount if provided
    if (updates.minimumAmount !== undefined) {
      updates.minimumAmount = updates.currency === 'JPY' 
        ? updates.minimumAmount 
        : updates.minimumAmount * 100;
    }

    // Process dates
    if (updates.validFrom) {
      updates.validFrom = new Date(updates.validFrom);
    }
    if (updates.validUntil) {
      updates.validUntil = new Date(updates.validUntil);
    }

    const [updatedCode] = await db
      .update(discountCodes)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(discountCodes.id, id))
      .returning();

    if (!updatedCode) {
      return res.status(404).json({ error: '折扣碼不存在' });
    }

    res.json({
      success: true,
      discountCode: updatedCode,
      message: '折扣碼更新成功'
    });

  } catch (error) {
    console.error('Error updating discount code:', error);
    res.status(500).json({ error: '更新折扣碼失敗' });
  }
});

// Delete/deactivate discount code (admin only)
router.delete('/:id', requireJWTAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const { permanent = false } = req.query;

    if (permanent === 'true') {
      // Permanent deletion (use with caution)
      const result = await db
        .delete(discountCodes)
        .where(eq(discountCodes.id, id));

      if (result.rowCount === 0) {
        return res.status(404).json({ error: '折扣碼不存在' });
      }
    } else {
      // Soft delete - just deactivate
      const [updatedCode] = await db
        .update(discountCodes)
        .set({
          isActive: false,
          updatedAt: new Date()
        })
        .where(eq(discountCodes.id, id))
        .returning();

      if (!updatedCode) {
        return res.status(404).json({ error: '折扣碼不存在' });
      }
    }

    res.json({
      success: true,
      message: permanent === 'true' ? '折扣碼已永久刪除' : '折扣碼已停用'
    });

  } catch (error) {
    console.error('Error deleting discount code:', error);
    res.status(500).json({ error: '刪除折扣碼失敗' });
  }
});

// Get discount code usage statistics (admin only)
router.get('/:id/stats', requireJWTAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);

    // Get discount code details
    const [discountCode] = await db
      .select()
      .from(discountCodes)
      .where(eq(discountCodes.id, id));

    if (!discountCode) {
      return res.status(404).json({ error: '折扣碼不存在' });
    }

    // Get usage statistics
    const usageStats = await db
      .select({
        serviceName: discountUsages.serviceName,
        totalUsage: sql<number>`count(*)`,
        completedUsage: sql<number>`count(*) filter (where ${discountUsages.paymentStatus} = 'completed')`,
        totalDiscount: sql<number>`sum(${discountUsages.discountAmount}) filter (where ${discountUsages.paymentStatus} = 'completed')`,
        totalRevenue: sql<number>`sum(${discountUsages.finalAmount}) filter (where ${discountUsages.paymentStatus} = 'completed')`
      })
      .from(discountUsages)
      .where(eq(discountUsages.discountCodeId, id))
      .groupBy(discountUsages.serviceName);

    // Get recent usage
    const recentUsage = await db
      .select({
        userEmail: discountUsages.userEmail,
        serviceName: discountUsages.serviceName,
        originalAmount: discountUsages.originalAmount,
        discountAmount: discountUsages.discountAmount,
        finalAmount: discountUsages.finalAmount,
        currency: discountUsages.currency,
        paymentStatus: discountUsages.paymentStatus,
        usedAt: discountUsages.usedAt
      })
      .from(discountUsages)
      .where(eq(discountUsages.discountCodeId, id))
      .orderBy(desc(discountUsages.usedAt))
      .limit(10);

    res.json({
      discountCode,
      usageStats,
      recentUsage,
      summary: {
        totalUsage: usageStats.reduce((sum, stat) => sum + stat.totalUsage, 0),
        completedUsage: usageStats.reduce((sum, stat) => sum + stat.completedUsage, 0),
        totalDiscountGiven: usageStats.reduce((sum, stat) => sum + parseFloat(stat.totalDiscount?.toString() || '0'), 0),
        totalRevenueGenerated: usageStats.reduce((sum, stat) => sum + parseFloat(stat.totalRevenue?.toString() || '0'), 0)
      }
    });

  } catch (error) {
    console.error('Error getting discount code stats:', error);
    res.status(500).json({ error: '獲取折扣碼統計失敗' });
  }
});

// Bulk operations (admin only)
router.post('/bulk-action', requireJWTAuth, requireAdmin, async (req: any, res) => {
  try {
    const { action, codeIds } = req.body;
    
    if (!action || !Array.isArray(codeIds) || codeIds.length === 0) {
      return res.status(400).json({ error: '無效的批量操作參數' });
    }

    let result;
    switch (action) {
      case 'activate':
        result = await db
          .update(discountCodes)
          .set({ isActive: true, updatedAt: new Date() })
          .where(inArray(discountCodes.id, codeIds));
        break;
        
      case 'deactivate':
        result = await db
          .update(discountCodes)
          .set({ isActive: false, updatedAt: new Date() })
          .where(inArray(discountCodes.id, codeIds));
        break;
        
      case 'delete':
        result = await db
          .delete(discountCodes)
          .where(inArray(discountCodes.id, codeIds));
        break;
        
      default:
        return res.status(400).json({ error: '不支援的批量操作' });
    }

    res.json({
      success: true,
      affectedRows: result.rowCount || 0,
      message: `批量${action}操作完成`
    });

  } catch (error) {
    console.error('Error in bulk action:', error);
    res.status(500).json({ error: '批量操作失敗' });
  }
});

export default router;