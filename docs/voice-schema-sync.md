# 保留語音資料並補齊開發庫結構

Replit 發布時會比對開發與正式資料庫的實際結構，將正式庫調整成開發庫的樣子。正式庫獨有的表會被列為刪除，應先把既有 migration 套用到開發庫

來源：[Replit 發布資料庫變更](https://docs.replit.com/features/data-and-storage/publish-database-changes)

`scripts/voice-schema-sync.mjs` 使用現有 `0004_voice_quotas.sql` 與 `0005_voice_login.sql`，只補 `voice_quotas`、`voice_reservations`、`voice_login_codes`、`voice_sessions` 四張表及其索引

連線 JSON 放在 repo 外的私密目錄，檔案權限為 0600，包含 `developmentDatabaseUrl` 與 `productionDatabaseUrl`。先執行唯讀計畫，再指定備份檔套用

```sh
node scripts/voice-schema-sync.mjs /private/connections.json plan
node scripts/voice-schema-sync.mjs /private/connections.json apply /private/voice-backup.json
```

正式連線設為唯讀，套用前備份四表資料並記錄所有 public 表的筆數與摘要值；開發庫使用交易套用，核對既有資料與四表結構後才提交。備份檔採 0600 與禁止覆寫，結構不符或資料變動即停止並撤回開發庫交易

本機測試使用兩個隨機命名的獨立 PostgreSQL 測試庫

```sh
node --test scripts/voice-schema-sync.test.mjs
```

開發連線必須能從執行機器存取。Replit Helium 的開發庫連線限工作區內使用；遇到內部主機連線時，先在本機輸出正式四表的結構摘要，取得該次開發庫操作的明確授權後，再於開發環境使用 `DATABASE_URL` 執行相同已驗證 SQL

```sh
umask 077
node scripts/voice-schema-sync.mjs /private/connections.json production-manifest > /private/voice-schema-manifest.json
node scripts/voice-schema-sync.mjs /private/voice-schema-manifest.json development-plan
node scripts/voice-schema-sync.mjs /private/voice-schema-manifest.json development-apply /private/development-voice-backup.json
```

結構摘要包含 migration 與四表結構的 SHA-256，開發環境依摘要核對結果，正式庫連線資訊留在本機

來源：[Replit 資料庫連線資訊](https://docs.replit.com/features/data-and-storage/connection-details)

完成結構對齊後，再用 Git 控制項同步及 Republish，核對發佈 SQL 與正式庫資料
