import express from 'express';
import { db } from './db';
import { users, fabePurchases, fabeProducts } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

const router = express.Router();

const PRODUCT_ID_ANNUAL   = 'be7f0d8c-657d-4b81-be3e-d4c96965411b';
const PRODUCT_ID_LIFETIME = '1f1c10f9-499e-4d8d-ba8a-fa2bdf359ead';

function resolveProductId(subscriptionType: string): string {
  const t = subscriptionType.toLowerCase();
  if (t === 'lifetime' || t === 'founders') return PRODUCT_ID_LIFETIME;
  return PRODUCT_ID_ANNUAL;
}

// API Key 驗證 middleware
function requireFabeApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const apiKey = process.env.FABE_SYNC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'FABE_SYNC_API_KEY not configured on server' });
  }
  const authHeader = req.headers.authorization || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

// 查找或建立用戶，回傳用戶資料
// 注意：Fabe 購買不影響 ECCAL 的 membership_level，新用戶一律以 free 建立
async function findOrCreateUser(email: string) {
  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length > 0) return existing[0];
  const [newUser] = await db
    .insert(users)
    .values({
      email,
      service: 'fabe',
      membershipLevel: 'free',
    })
    .returning();
  return newUser;
}

// 寫入 fabe_purchases，跳過重複（依 fabe_order_id）
async function upsertFabePurchase(opts: {
  userId: string;
  productId: string;
  purchaseAmount: number;
  paymentMethod: 'stripe' | 'manual' | 'other';
  paymentStatus: 'pending' | 'completed' | 'failed' | 'refunded';
  accessStartDate?: Date;
  accessEndDate?: Date | null;
  stripePaymentIntentId?: string;
  fabeOrderId?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ record: unknown; skipped: boolean }> {
  // 防重複：根據 fabe_order_id 存在 metadata 裡判斷
  if (opts.fabeOrderId) {
    const existing = await db
      .select()
      .from(fabePurchases)
      .where(
        and(
          eq(fabePurchases.userId, opts.userId),
          eq(fabePurchases.stripePaymentIntentId, `fabe_${opts.fabeOrderId}`)
        )
      );
    if (existing.length > 0) return { record: existing[0], skipped: true };
  }

  const [record] = await db
    .insert(fabePurchases)
    .values({
      userId: opts.userId,
      productId: opts.productId,
      purchaseAmount: opts.purchaseAmount,
      paymentMethod: opts.paymentMethod,
      paymentStatus: opts.paymentStatus,
      accessStartDate: opts.accessStartDate ?? new Date(),
      accessEndDate: opts.accessEndDate ?? null,
      stripePaymentIntentId: opts.fabeOrderId ? `fabe_${opts.fabeOrderId}` : opts.stripePaymentIntentId,
      metadata: opts.metadata ?? {},
    })
    .returning();

  return { record, skipped: false };
}

// ────────────────────────────────────────────────────
// 即時通知端點（Fabe 用戶付款後呼叫）
// POST /api/fabe-reverse/notify-subscription
// ────────────────────────────────────────────────────
router.post('/notify-subscription', requireFabeApiKey, async (req, res) => {
  try {
    const { email, subscription_type, amount, currency, fabe_subscription_id, expires_at } = req.body;

    if (!email || !subscription_type) {
      return res.status(400).json({ error: 'Missing required fields: email, subscription_type' });
    }

    const userData = await findOrCreateUser(email);

    const productId = resolveProductId(subscription_type);
    const { record, skipped } = await upsertFabePurchase({
      userId: userData.id,
      productId,
      purchaseAmount: amount ?? 0,
      paymentMethod: 'stripe',
      paymentStatus: 'completed',
      accessStartDate: new Date(),
      accessEndDate: expires_at ? new Date(expires_at) : null,
      fabeOrderId: fabe_subscription_id,
      metadata: {
        source: 'fabe',
        fabe_subscription_id,
        subscription_type,
        currency: currency ?? 'twd',
        expires_at,
        syncedAt: new Date().toISOString(),
      },
    });

    return res.json({
      success: true,
      skipped,
      message: skipped ? 'Already synced' : 'Subscription synced successfully',
      user: {
        id: userData.id,
        email: userData.email,
      },
    });
  } catch (error) {
    console.error('Fabe subscription sync error:', error);
    res.status(500).json({ error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ────────────────────────────────────────────────────
// 批次歷史匯入端點（一次性補登）
// POST /api/fabe-reverse/import-purchases
// ────────────────────────────────────────────────────
router.post('/import-purchases', requireFabeApiKey, async (req, res) => {
  try {
    const { purchases } = req.body as {
      purchases?: Array<{
        email: string;
        product_id?: string;
        subscription_type?: string;
        purchase_amount?: number;
        payment_method?: string;
        payment_status?: string;
        fabe_order_id?: string;
        stripe_payment_intent_id?: string;
        access_start_date?: string;
        access_end_date?: string;
        expires_at?: string;
        purchased_at?: string;
        currency?: string;
      }>;
    };

    if (!Array.isArray(purchases) || purchases.length === 0) {
      return res.status(400).json({ error: 'purchases must be a non-empty array' });
    }

    let imported = 0;
    let skipped = 0;
    const errors: Array<{ index: number; email: string; error: string }> = [];

    for (let i = 0; i < purchases.length; i++) {
      const p = purchases[i];
      try {
        if (!p.email) throw new Error('email is required');

        const expiresAt = p.expires_at ?? p.access_end_date;
        const userData = await findOrCreateUser(p.email);

        const productId = p.product_id ?? resolveProductId(p.subscription_type ?? 'annual');
        const { skipped: isSkipped } = await upsertFabePurchase({
          userId: userData.id,
          productId,
          purchaseAmount: p.purchase_amount ?? 0,
          paymentMethod: (p.payment_method as 'stripe' | 'manual' | 'other') ?? 'stripe',
          paymentStatus: (p.payment_status as 'pending' | 'completed' | 'failed' | 'refunded') ?? 'completed',
          accessStartDate: p.access_start_date ? new Date(p.access_start_date) : (p.purchased_at ? new Date(p.purchased_at) : new Date()),
          accessEndDate: expiresAt ? new Date(expiresAt) : null,
          fabeOrderId: p.fabe_order_id,
          stripePaymentIntentId: p.stripe_payment_intent_id,
          metadata: {
            source: 'fabe_import',
            fabe_order_id: p.fabe_order_id,
            subscription_type: p.subscription_type,
            currency: p.currency ?? 'twd',
            original_amount: p.purchase_amount,
            importedAt: new Date().toISOString(),
          },
        });

        if (isSkipped) skipped++; else imported++;
      } catch (err) {
        errors.push({ index: i, email: p.email ?? '(unknown)', error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return res.json({ success: true, imported, skipped, errors });
  } catch (error) {
    console.error('Fabe import-purchases error:', error);
    res.status(500).json({ error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ────────────────────────────────────────────────────
// 查詢單一用戶的 Fabe 訂閱狀態（ECCAL 儀表板用，不需要 API Key）
// GET /api/fabe-reverse/check-fabe-subscription/:userId
// ────────────────────────────────────────────────────
router.get('/check-fabe-subscription/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const records = await db
      .select()
      .from(fabePurchases)
      .where(and(eq(fabePurchases.userId, userId), eq(fabePurchases.paymentStatus, 'completed')));

    return res.json({
      has_fabe_purchase: records.length > 0,
      total: records.length,
      purchases: records.map(r => ({
        id: r.id,
        product_id: r.productId,
        amount: r.purchaseAmount,
        payment_method: r.paymentMethod,
        access_start: r.accessStartDate,
        access_end: r.accessEndDate,
        created_at: r.createdAt,
        source: (r.metadata as Record<string, unknown>)?.source ?? 'unknown',
      })),
    });
  } catch (error) {
    console.error('Check fabe subscription error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────
// 列出所有有 Fabe 購買紀錄的用戶（管理員用，需 API Key）
// GET /api/fabe-reverse/fabe-subscribers
// ────────────────────────────────────────────────────
router.get('/fabe-subscribers', requireFabeApiKey, async (req, res) => {
  try {
    const records = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        membershipLevel: users.membershipLevel,
        membershipExpires: users.membershipExpires,
        purchaseAmount: fabePurchases.purchaseAmount,
        paymentStatus: fabePurchases.paymentStatus,
        accessStart: fabePurchases.accessStartDate,
        accessEnd: fabePurchases.accessEndDate,
        purchasedAt: fabePurchases.createdAt,
        metadata: fabePurchases.metadata,
      })
      .from(fabePurchases)
      .innerJoin(users, eq(users.id, fabePurchases.userId))
      .where(eq(fabePurchases.paymentStatus, 'completed'));

    return res.json({
      total: records.length,
      subscribers: records.map(r => ({
        id: r.id,
        email: r.email,
        name: r.name,
        membership_level: r.membershipLevel,
        membership_expires: r.membershipExpires,
        purchase_amount: r.purchaseAmount,
        access_start: r.accessStart,
        access_end: r.accessEnd,
        purchased_at: r.purchasedAt,
        source: (r.metadata as Record<string, unknown>)?.source ?? 'unknown',
      })),
    });
  } catch (error) {
    console.error('Get fabe subscribers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
