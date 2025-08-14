import { db } from "./db";
import { users } from "../shared/schema";
import { lt, and, isNotNull, eq } from "drizzle-orm";

// 自動維護過期 token 的背景服務
export class TokenMaintenanceService {
  private intervalId: NodeJS.Timeout | null = null;

  start() {
    console.log('[TOKEN-MAINTENANCE] 啟動自動 token 維護服務');
    
    // 立即執行一次
    this.maintainTokens();
    
    // 每小時執行一次
    this.intervalId = setInterval(() => {
      this.maintainTokens();
    }, 60 * 60 * 1000); // 1小時
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[TOKEN-MAINTENANCE] 停止自動 token 維護服務');
    }
  }

  private async maintainTokens() {
    try {
      const now = new Date();
      const sixHoursFromNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);
      
      // 查找即將在6小時內過期的 token
      const expiringSoonUsers = await db
        .select({ email: users.email, id: users.id })
        .from(users)
        .where(
          and(
            lt(users.tokenExpiresAt, sixHoursFromNow),
            isNotNull(users.googleAccessToken)
          )
        );

      if (expiringSoonUsers.length > 0) {
        console.log(`[TOKEN-MAINTENANCE] 發現 ${expiringSoonUsers.length} 個即將過期的 token`);
        
        // 批量延長這些用戶的 token
        const newExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        
        for (const user of expiringSoonUsers) {
          await db
            .update(users)
            .set({
              tokenExpiresAt: newExpiry,
              updatedAt: now
            })
            .where(eq(users.id, user.id));
        }
        
        console.log(`[TOKEN-MAINTENANCE] 成功延長 ${expiringSoonUsers.length} 個用戶的 token 至 24 小時`);
        
        // 記錄受影響的用戶（只記錄前10個，避免日誌過長）
        const emailList = expiringSoonUsers.slice(0, 10).map(u => u.email).join(', ');
        console.log(`[TOKEN-MAINTENANCE] 受影響用戶: ${emailList}${expiringSoonUsers.length > 10 ? '...' : ''}`);
      } else {
        console.log('[TOKEN-MAINTENANCE] 沒有即將過期的 token');
      }

    } catch (error) {
      console.error('[TOKEN-MAINTENANCE] 維護 token 時發生錯誤:', error);
    }
  }

  // 手動觸發維護（用於測試）
  async runMaintenance() {
    await this.maintainTokens();
  }
}

// 創建全域實例
export const tokenMaintenance = new TokenMaintenanceService();