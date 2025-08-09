import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

// Configure Neon for better stability
neonConfig.webSocketConstructor = ws;
neonConfig.useSecureWebSocket = true;
neonConfig.pipelineConnect = false;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// 優化連接池設定以提升部署穩定性
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 3, // 減少最大連線數以降低資源使用
  min: 0, // 啟動時不預先建立連線，按需建立
  idleTimeoutMillis: 15000, // 縮短閒置超時時間
  connectionTimeoutMillis: 8000, // 縮短連線超時時間
  ssl: true, // 確保 SSL 連線
});

export const db = drizzle({ client: pool, schema });

// 優雅的資料庫健康檢查函數
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT 1 as health_check');
    return result.rows.length > 0;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}