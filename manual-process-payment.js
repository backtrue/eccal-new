// 手動處理付款 - 直接調用 Node.js 函數
const { storage } = require('./server/storage.js');

async function processPayment() {
  const paymentIntent = {
    id: "pi_2RrIdcYDQY3sAQES1VdZDl7i",
    amount: 599000,
    currency: "twd", 
    customer: "cus_SmP9EF1etwSLi3",
    status: "succeeded",
    metadata: {
      paymentType: "founders_membership",
      userId: "101017118047810033810"
    }
  };

  const userId = paymentIntent.metadata?.userId;
  const paymentType = paymentIntent.metadata?.paymentType;

  if (!userId) {
    console.error('No userId in payment intent metadata');
    return;
  }

  try {
    console.log(`Processing ${paymentType} payment for user ${userId}`);
    
    // 升級用戶到 Pro
    if (paymentType === 'founders_membership') {
      await storage.upgradeToPro(userId, 365 * 10); // 10年
      console.log(`Upgraded user ${userId} to founders membership (lifetime Pro access)`);
    }

    // 記錄 eccal_purchases
    const { db } = await import("./server/db.js");
    const { eccalPurchases } = await import("./shared/schema.js");

    const [purchase] = await db.insert(eccalPurchases).values({
      userId,
      planType: 'founders',
      purchaseAmount: 5990,
      paymentMethod: "stripe",
      paymentStatus: "completed", 
      stripePaymentIntentId: paymentIntent.id,
      accessStartDate: new Date(),
      fabeAccess: true,
      fabeAccessSynced: true,
      metadata: {
        originalPaymentType: paymentType,
        stripeAmount: paymentIntent.amount,
        currency: paymentIntent.currency,
        processedViaScript: true
      }
    }).returning();

    console.log(`✅ Successfully processed payment:`, purchase.id);
    console.log(`✅ User upgraded to Pro with FABE access`);
    
  } catch (error) {
    console.error('❌ Error processing payment:', error);
  }
}

processPayment();