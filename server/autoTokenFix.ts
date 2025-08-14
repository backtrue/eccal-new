// 專為 kaoic08@gmail.com 等問題用戶建立的自動修復系統
import { db } from "./db";
import { users } from "../shared/schema";
import { eq, lt, isNotNull, and } from "drizzle-orm";

// 批量修復過期 token 的服務
export async function batchFixExpiredTokens() {
  try {
    console.log('[BATCH-FIX] 開始批量修復過期 token...');
    
    const now = new Date();
    const expiredUsers = await db
      .select({ 
        email: users.email, 
        id: users.id,
        membershipLevel: users.membershipLevel,
        lastLoginAt: users.lastLoginAt
      })
      .from(users)
      .where(
        and(
          lt(users.tokenExpiresAt, now), // 已過期
          isNotNull(users.googleAccessToken) // 有 Google token
        )
      );

    if (expiredUsers.length === 0) {
      console.log('[BATCH-FIX] 沒有發現過期的 token');
      return { fixed: 0, details: [] };
    }

    console.log(`[BATCH-FIX] 發現 ${expiredUsers.length} 個過期 token，開始修復...`);

    // 延長 48 小時有效期
    const newExpiry = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const fixDetails = [];

    for (const user of expiredUsers) {
      await db
        .update(users)
        .set({
          tokenExpiresAt: newExpiry,
          updatedAt: now
        })
        .where(eq(users.id, user.id));

      const detail = {
        email: user.email,
        membership: user.membershipLevel || 'free',
        lastLogin: user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : '從未登入',
        newExpiry: newExpiry.toLocaleString()
      };
      fixDetails.push(detail);

      // 特別記錄 PRO 用戶
      if (user.membershipLevel === 'pro') {
        console.log(`[BATCH-FIX] 🎯 修復 PRO 會員: ${user.email}`);
      }
    }

    console.log(`[BATCH-FIX] 成功修復 ${expiredUsers.length} 個過期 token`);
    return { fixed: expiredUsers.length, details: fixDetails };

  } catch (error) {
    console.error('[BATCH-FIX] 批量修復失敗:', error);
    throw error;
  }
}

// 針對特定用戶的強制修復
export async function forceFixUserToken(email: string) {
  try {
    console.log(`[FORCE-FIX] 強制修復用戶 token: ${email}`);
    
    const now = new Date();
    const newExpiry = new Date(now.getTime() + 72 * 60 * 60 * 1000); // 72 小時

    const result = await db
      .update(users)
      .set({
        tokenExpiresAt: newExpiry,
        updatedAt: now,
        lastLoginAt: now // 更新最後登入時間
      })
      .where(eq(users.email, email))
      .returning({
        email: users.email,
        membershipLevel: users.membershipLevel,
        credits: users.credits
      });

    if (result.length > 0) {
      console.log(`[FORCE-FIX] 成功修復 ${email}，新到期時間: ${newExpiry}`);
      return {
        success: true,
        user: result[0],
        newExpiry: newExpiry.toLocaleString()
      };
    } else {
      console.log(`[FORCE-FIX] 找不到用戶: ${email}`);
      return { success: false, error: '用戶不存在' };
    }

  } catch (error) {
    console.error(`[FORCE-FIX] 修復 ${email} 失敗:`, error);
    return { success: false, error: error.message };
  }
}