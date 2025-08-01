// 資料庫異地備份腳本
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DATABASE_URL = process.env.DATABASE_URL;
const BACKUP_DIR = './backups';

// 確保備份目錄存在
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');

console.log('🔄 開始建立異地備份...');

try {
  // 1. 匯出完整資料庫結構和資料
  const fullBackupFile = path.join(BACKUP_DIR, `eccal_full_backup_${timestamp}.sql`);
  execSync(`pg_dump "${DATABASE_URL}" > "${fullBackupFile}"`, { stdio: 'inherit' });
  console.log(`✅ 完整備份已建立: ${fullBackupFile}`);

  // 2. 匯出重要表格為 CSV (可讀性更好)
  const tables = [
    'users',
    'credit_transactions', 
    'user_credits',
    'user_referrals',
    'fabe_products',
    'fabe_purchases'
  ];

  for (const table of tables) {
    try {
      const csvFile = path.join(BACKUP_DIR, `${table}_${timestamp}.csv`);
      const command = `psql "${DATABASE_URL}" -c "\\COPY (SELECT * FROM ${table} ORDER BY created_at) TO '${csvFile}' WITH (FORMAT CSV, HEADER true)"`;
      execSync(command, { stdio: 'inherit' });
      console.log(`✅ ${table} CSV 備份完成`);
    } catch (err) {
      console.log(`⚠️ ${table} 表格可能不存在或為空`);
    }
  }

  // 3. 建立備份摘要
  const summaryFile = path.join(BACKUP_DIR, `backup_summary_${timestamp}.json`);
  const summary = {
    timestamp: new Date().toISOString(),
    backupFiles: fs.readdirSync(BACKUP_DIR).filter(f => f.includes(timestamp)),
    databaseUrl: DATABASE_URL?.substring(0, 20) + '...',
    note: '此備份包含完整資料庫結構和重要表格的 CSV 格式'
  };
  
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  console.log(`✅ 備份摘要: ${summaryFile}`);

  console.log('\n🎉 異地備份完成！');
  console.log(`📁 備份位置: ${BACKUP_DIR}`);
  console.log('💡 建議將備份檔案下載到本地或上傳到雲端硬碟');

} catch (error) {
  console.error('❌ 備份過程發生錯誤:', error.message);
}