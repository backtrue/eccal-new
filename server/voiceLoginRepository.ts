import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { VoiceQuotaError } from '../shared/voiceQuota';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function createVoiceLoginRepository(pool: Pick<Pool, 'query' | 'connect'>) {
  return {
    async createCode(userId: string, state: string, audience: string, sessionExpiresAt: number) {
      const code = randomBytes(32).toString('base64url');
      await pool.query(`INSERT INTO voice_login_codes(code_hash,state_hash,user_id,audience,expires_at,session_expires_at)
        VALUES($1,$2,$3,$4,LEAST(clock_timestamp()+interval '120 seconds',$5),$5)`, [digest(code), digest(state), userId, audience, new Date(sessionExpiresAt)]);
      // 到期資料每次分批清理，保留當下有效的登入與會話
      await pool.query('DELETE FROM voice_login_codes WHERE code_hash IN (SELECT code_hash FROM voice_login_codes WHERE expires_at <= now() LIMIT 100)');
      await pool.query('DELETE FROM voice_sessions WHERE token_hash IN (SELECT token_hash FROM voice_sessions WHERE expires_at <= now() LIMIT 100)');
      return code;
    },
    async exchange(code: string, state: string, audience: string) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const row = (await client.query(`UPDATE voice_login_codes SET consumed_at=clock_timestamp()
          WHERE code_hash=$1 AND state_hash=$2 AND audience=$3 AND consumed_at IS NULL AND expires_at > clock_timestamp()
          RETURNING user_id,session_expires_at`, [digest(code), digest(state), audience])).rows[0];
        if (!row) throw new VoiceQuotaError('LOGIN_CODE_INVALID', 400);
        const token = randomBytes(32).toString('base64url');
        await client.query('INSERT INTO voice_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [digest(token), row.user_id, row.session_expires_at]);
        await client.query('COMMIT');
        return { memberId: row.user_id as string, sessionToken: token, expiresAt: (row.session_expires_at as Date).getTime() };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async authenticate(token: string): Promise<{ memberId: string; expiresAt: number } | null> {
      const row = (await pool.query('SELECT s.user_id,s.expires_at FROM voice_sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at > clock_timestamp()', [digest(token)])).rows[0];
      return row ? { memberId: row.user_id, expiresAt: row.expires_at.getTime() } : null;
    },
    async revoke(token: string) { await pool.query('DELETE FROM voice_sessions WHERE token_hash=$1', [digest(token)]); },
    async matchesAccount(memberId: string, accountEmail: string) {
      const rows = (await pool.query('SELECT id FROM users WHERE lower(btrim(email))=lower(btrim($1)) LIMIT 2', [accountEmail])).rows;
      return rows.length === 1 && rows[0].id === memberId;
    },
  };
}
export type VoiceLoginRepository = ReturnType<typeof createVoiceLoginRepository>;
