// Eccal 購買記錄處理和跨平台權限同步
import express from "express";
import { db } from "./db.js";
import { eccalPurchases, fabeProducts, fabePurchases, users } from "../shared/schema.js";
import { eq, and } from "drizzle-orm";
import type { InsertEccalPurchase } from "../shared/schema.js";

const router = express.Router();

// 記錄 eccal 購買（當用戶購買 5990 創始會員時）
router.post("/record-purchase", async (req, res) => {
  try {
    const {
      userId,
      planType,
      purchaseAmount,
      stripePaymentIntentId,
      stripeSubscriptionId,
      subscriptionStatus
    } = req.body;

    // 驗證必要欄位
    if (!userId || !planType || !purchaseAmount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: userId, planType, purchaseAmount"
      });
    }

    // 檢查是否為創始會員方案 (5990)
    const isFoundersPlan = planType === 'founders' && purchaseAmount === 5990;
    
    const purchaseData: InsertEccalPurchase = {
      userId,
      planType,
      purchaseAmount,
      paymentMethod: "stripe",
      paymentStatus: "completed",
      stripePaymentIntentId,
      stripeSubscriptionId,
      subscriptionStatus,
      accessStartDate: new Date(),
      accessEndDate: isFoundersPlan ? null : undefined, // 創始會員為終身
      fabeAccess: isFoundersPlan, // 創始會員獲得 fabe 權限
      fabeAccessSynced: false, // 等待同步到 fabe
      metadata: {
        crossPlatformBenefits: isFoundersPlan,
        originalPlan: planType
      }
    };

    const [purchase] = await db.insert(eccalPurchases).values(purchaseData).returning();

    // 如果是創始會員，觸發 fabe 權限同步
    if (isFoundersPlan) {
      try {
        await syncFounderAccessToFabe(userId, purchase.id);
      } catch (syncError) {
        console.error('Fabe 同步失敗:', syncError);
        // 同步失敗不影響購買記錄，之後可以重試
      }
    }

    res.json({
      success: true,
      message: "Purchase recorded successfully",
      data: {
        purchaseId: purchase.id,
        fabeAccess: purchase.fabeAccess,
        needsFabeSync: purchase.fabeAccess && !purchase.fabeAccessSynced
      }
    });

  } catch (error) {
    console.error('Record purchase error:', error);
    res.status(500).json({
      success: false,
      error: "Failed to record purchase"
    });
  }
});

// 查詢用戶的 eccal 購買記錄和跨平台權限
router.get("/user-purchases/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const purchases = await db
      .select()
      .from(eccalPurchases)
      .where(eq(eccalPurchases.userId, userId));

    // 檢查用戶是否有 fabe 權限
    const hasFabeAccess = purchases.some(p => p.fabeAccess && p.paymentStatus === 'completed');
    const foundersPlan = purchases.find(p => p.planType === 'founders' && p.paymentStatus === 'completed');

    res.json({
      success: true,
      data: {
        purchases,
        crossPlatformBenefits: {
          hasFabeAccess,
          foundersPlan: foundersPlan ? {
            purchaseId: foundersPlan.id,
            purchaseDate: foundersPlan.createdAt,
            fabeAccessSynced: foundersPlan.fabeAccessSynced
          } : null
        }
      }
    });

  } catch (error) {
    console.error('Get user purchases error:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get user purchases"
    });
  }
});

// 手動同步創始會員權限到 fabe
router.post("/sync-founder-to-fabe", async (req, res) => {
  try {
    const { userId, purchaseId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId is required"
      });
    }

    const result = await syncFounderAccessToFabe(userId, purchaseId);

    res.json({
      success: true,
      message: "Founder access synced to Fabe successfully",
      data: result
    });

  } catch (error) {
    console.error('Sync to fabe error:', error);
    res.status(500).json({
      success: false,
      error: "Failed to sync founder access to Fabe"
    });
  }
});

// 同步創始會員權限到 fabe 的核心函數
async function syncFounderAccessToFabe(userId: string, purchaseId?: string) {
  try {
    // 獲取用戶資訊
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      throw new Error('User not found');
    }

    // 獲取創始會員購買記錄
    const foundersPurchase = await db
      .select()
      .from(eccalPurchases)
      .where(
        and(
          eq(eccalPurchases.userId, userId),
          eq(eccalPurchases.planType, 'founders'),
          eq(eccalPurchases.paymentStatus, 'completed')
        )
      );

    if (foundersPurchase.length === 0) {
      throw new Error('No valid founders purchase found');
    }

    // 檢查是否已有 fabe 課程記錄
    const existingFabePurchase = await db
      .select()
      .from(fabePurchases)
      .where(eq(fabePurchases.userId, userId));

    if (existingFabePurchase.length === 0) {
      // 創建 fabe 產品記錄（如果不存在）
      const fabeProduct = await ensureFabeFoundersProduct();

      // 為創始會員添加 fabe 課程權限
      await db.insert(fabePurchases).values({
        userId,
        productId: fabeProduct.id,
        purchaseAmount: 0, // 創始會員免費獲得
        paymentMethod: "other", // 使用允許的值
        paymentStatus: "completed",
        accessStartDate: new Date(),
        accessEndDate: null, // 永久權限
        metadata: {
          sourceplan: "eccal_founders",
          originalPurchaseId: purchaseId,
          grantedBy: "eccal_cross_platform_benefit",
          actualPaymentMethod: "eccal_founders_benefit"
        }
      });
    }

    // 更新 eccal 購買記錄的同步狀態
    if (purchaseId) {
      await db
        .update(eccalPurchases)
        .set({ fabeAccessSynced: true, updatedAt: new Date() })
        .where(eq(eccalPurchases.id, purchaseId));
    }

    return {
      userId,
      email: user.email,
      fabeAccess: true,
      syncedAt: new Date()
    };

  } catch (error) {
    console.error('Sync founder access error:', error);
    throw error;
  }
}

// 確保 fabe 有創始會員專用的產品記錄
async function ensureFabeFoundersProduct() {
  const existingProduct = await db
    .select()
    .from(fabeProducts)
    .where(eq(fabeProducts.type, 'lifetime_access'));

  if (existingProduct.length > 0) {
    return existingProduct[0];
  }

  // 創建創始會員專用的 fabe 產品
  const [newProduct] = await db.insert(fabeProducts).values({
    name: "FABE × SPIN 完整課程（創始會員專享）",
    price: 0, // 創始會員免費
    originalPrice: 999,
    type: "lifetime_access",
    description: "eccal 創始會員專享 - FABE 完整課程永久使用權",
    isActive: true
  }).returning();

  return newProduct;
}

export default router;