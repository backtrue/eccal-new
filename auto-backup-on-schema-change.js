// 自動檢測資料庫 schema 變更並執行備份
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';

const SCHEMA_FILE = './shared/schema.ts';
const DRIZZLE_CONFIG = './drizzle.config.ts';
const CHECKSUM_FILE = './.schema-checksum';

// 計算檔案的 MD5 checksum
function calculateChecksum(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('md5').update(content).digest('hex');
}

// 檢查是否有 schema 變更
function hasSchemaChanged() {
  const currentChecksum = calculateChecksum(SCHEMA_FILE);
  
  if (!fs.existsSync(CHECKSUM_FILE)) {
    // 首次執行，記錄當前 checksum
    fs.writeFileSync(CHECKSUM_FILE, currentChecksum);
    return false;
  }
  
  const savedChecksum = fs.readFileSync(CHECKSUM_FILE, 'utf8').trim();
  return currentChecksum !== savedChecksum;
}

// 更新儲存的 checksum
function updateChecksum() {
  const currentChecksum = calculateChecksum(SCHEMA_FILE);
  fs.writeFileSync(CHECKSUM_FILE, currentChecksum);
}

// 執行備份
function runBackup() {
  console.log('🔍 檢測到資料庫 schema 變更');
  console.log('🔄 自動執行備份...');
  
  try {
    execSync('node backup-script.js', { stdio: 'inherit' });
    console.log('✅ 自動備份完成');
    return true;
  } catch (error) {
    console.error('❌ 自動備份失敗:', error.message);
    return false;
  }
}

// 主要檢查邏輯
function checkAndBackup() {
  console.log('🔍 檢查 schema 變更...');
  
  if (hasSchemaChanged()) {
    const backupSuccess = runBackup();
    if (backupSuccess) {
      updateChecksum();
      console.log('✅ Schema 變更檢測和備份完成');
    } else {
      console.log('⚠️ 備份失敗，未更新 checksum');
    }
  } else {
    console.log('ℹ️ Schema 無變更，跳過備份');
  }
}

// 如果作為腳本直接執行
if (import.meta.url === `file://${process.argv[1]}`) {
  checkAndBackup();
}

export { checkAndBackup, hasSchemaChanged };