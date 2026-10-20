# ThinkWithBlack 營運總覽

正式入口：`/bdmin/thinkwithblack/`，由原管理後台開啟

- 使用既有報數據 Google 登入 cookie，路由重新核對 JWT 與目前資料庫會員，僅允許 backtrue@gmail.com
- 快照儲存在私人資料表 thinkwithblack_dashboard_snapshots；HTML 與 JSON 來源需要相同權限
- 私人前端模板採官方 Data App 分離資料編譯，模板只保留空查詢 bootstrap；完整資料由受保護的 snapshot.<sha256>.json 取得
- 同步來源為專用 Cloudflare Worker，直接讀取 OAuth KV、原始問題 KV 與 Analytics SQL，會員 Email／方案由報數據後端對照
- Analytics SQL 的 COUNT／SUM 已由 Cloudflare 自動套用取樣權重
- 每日自動更新一次，以最近成功同步後 24 小時計算；開啟頁面、停留或切回分頁時，達到更新間隔才重新同步
- 「同步正式資料」按鈕可隨時手動更新，成功後重新計算下一次自動更新時間
- 自動更新保留日期、平台、方案及內部帳號篩選，編輯或查看帳號／問題明細時暫停換頁
- 每次同步重新讀取 GitHub 星數、Fork 與最近 14 天 traffic

content 目錄保存目前 JSX、計算函式與 CSS；index.html 為官方 Data App build --separate-data 產物，未包含查詢資料列

驗證：npm run check、npm run build、node --import tsx --test server/thinkwithblackDashboard.test.ts cloudflare/thinkwithblack-dashboard-data/src/index.test.ts server/thinkwithblack-dashboard/auto-refresh.test.mjs
