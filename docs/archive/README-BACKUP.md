# 自動備份系統使用指南

## 🛡️ 系統概述
這套自動備份系統會在每次資料庫 schema 變更時自動執行備份，確保資料安全。

## 📋 使用方法

### 日常開發時
```bash
# 🔒 安全版本 - 會自動檢測變更並備份
./db-push-with-backup.sh

# ⚠️ 不安全版本 - 直接推送，不備份
npm run db:push
```

### 手動操作
```bash
# 手動執行備份
node backup-script.js

# 檢查是否有 schema 變更
node auto-backup-on-schema-change.js

# 重新設定系統
node setup-auto-backup.js
```

## 🔍 工作原理

1. **變更檢測**：計算 `shared/schema.ts` 的 MD5 checksum
2. **自動觸發**：檢測到變更時自動執行 `backup-script.js`
3. **雙重保護**：資料庫內備份 + 檔案系統備份

## 📁 備份檔案位置

所有備份檔案存放在 `./backups/` 目錄：
- `eccal_full_backup_YYYY-MM-DD.sql` - 完整 SQL 備份
- `users_YYYY-MM-DD.csv` - 用戶資料 CSV
- `credit_transactions_YYYY-MM-DD.csv` - 積分交易 CSV
- `backup_summary_YYYY-MM-DD.json` - 備份摘要

## 🔄 恢復資料

### 從 SQL 備份完整恢復
```bash
psql "$DATABASE_URL" < backups/eccal_full_backup_YYYY-MM-DD.sql
```

### 從資料庫內備份恢復
```sql
-- 恢復用戶資料
DROP TABLE users;
ALTER TABLE users_backup_20250801 RENAME TO users;
```

## ⚠️ 重要提醒

1. **使用正確命令**：開發時請使用 `./db-push-with-backup.sh`
2. **定期下載備份**：將 `backups/` 目錄的檔案下載到本地
3. **檢查備份狀態**：注意腳本的執行結果
4. **保留多個版本**：不要刪除舊的備份檔案

## 🆘 緊急情況

如果資料遺失：
1. 停止所有寫入操作
2. 檢查 `backups/` 目錄中的最新備份
3. 使用上述恢復指令
4. 聯繫技術人員協助

---
*此系統於 2025-08-01 建立，旨在提供最高等級的資料安全保護*