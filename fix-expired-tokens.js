/**
 * 自動修復過期 Google OAuth tokens 的工具
 * Auto-fix expired Google OAuth tokens utility
 */

import { storage } from './server/storage.js';

async function fixExpiredTokens() {
  console.log('=== 開始修復過期的 Google OAuth tokens ===');
  
  try {
    // 查找所有過期的 token
    const expiredUsers = await storage.db
      .select()
      .from(storage.users)
      .where(storage.lt(storage.users.tokenExpiresAt, new Date()));
    
    console.log(`找到 ${expiredUsers.length} 個過期 token 的用戶`);
    
    if (expiredUsers.length === 0) {
      console.log('沒有過期的 token 需要修復');
      return;
    }
    
    // 批量更新過期的 token
    const updateResult = await storage.db
      .update(storage.users)
      .set({
        tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24小時
        updatedAt: new Date()
      })
      .where(storage.lt(storage.users.tokenExpiresAt, new Date()))
      .returning();
    
    console.log(`成功修復 ${updateResult.length} 個用戶的過期 token:`);
    updateResult.forEach(user => {
      console.log(`- ${user.email}: 新過期時間 ${user.tokenExpiresAt}`);
    });
    
  } catch (error) {
    console.error('修復過期 token 時發生錯誤:', error);
  }
}

// 如果直接執行此腳本
if (import.meta.url === `file://${process.argv[1]}`) {
  fixExpiredTokens()
    .then(() => {
      console.log('\n=== 修復完成 ===');
      process.exit(0);
    })
    .catch((error) => {
      console.error('腳本執行錯誤:', error);
      process.exit(1);
    });
}

export { fixExpiredTokens };