// 設定自動備份系統
import fs from 'fs';
import path from 'path';

console.log('🔧 設定自動備份系統...');

// 創建 alias 腳本來替代原本的 db:push
const aliasScript = `#!/bin/bash
# 自動備份版本的 db:push
echo "🛡️ 執行安全版本的資料庫推送..."
node auto-backup-on-schema-change.js
npx drizzle-kit push
`;

fs.writeFileSync('db-push-with-backup.sh', aliasScript);
fs.chmodSync('db-push-with-backup.sh', '755');

console.log('✅ 自動備份系統設定完成！');
console.log('');
console.log('📋 使用方法：');
console.log('  常規使用： ./db-push-with-backup.sh');
console.log('  手動備份： node backup-script.js');
console.log('  檢查變更： node auto-backup-on-schema-change.js');
console.log('');
console.log('🔒 安全特性：');
console.log('  ✅ 自動檢測 schema 變更');
console.log('  ✅ 變更時自動備份');
console.log('  ✅ 保留完整的還原能力');
console.log('');
console.log('⚠️ 記住：');
console.log('  - 使用 ./db-push-with-backup.sh 而不是 npm run db:push');
console.log('  - 重大變更前可以手動執行 node backup-script.js');