// 在執行 db:push 前自動備份
import { checkAndBackup } from './auto-backup-on-schema-change.js';

console.log('🛡️ 執行資料庫變更前的安全檢查...');
checkAndBackup();
console.log('🚀 繼續執行 db:push...');