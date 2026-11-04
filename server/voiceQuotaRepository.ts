import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { VOICE_FREE_SECONDS, VoiceQuotaError, voiceBilledSeconds, normalizeVoiceEvents, type VoiceBalance, type VoiceReservation, type VoiceSettlement } from '../shared/voiceQuota';

type ReservationRow = { id: string; user_id: string; reserved_seconds: number; deadline: Date; settled_at: Date | null; billed_seconds: number | null; remaining_seconds: number | null; events_digest: string | null };
const reservationView = (row: ReservationRow): VoiceReservation => ({ id: row.id, memberId: row.user_id, seconds: row.reserved_seconds, deadline: row.deadline.getTime() });

export function createVoiceQuotaRepository(pool: Pick<Pool, 'connect' | 'query'>) {
  async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function lock(client: PoolClient, memberId: string) {
    await client.query('INSERT INTO voice_quotas (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [memberId]);
    return (await client.query('SELECT granted_seconds, billed_seconds FROM voice_quotas WHERE user_id=$1 FOR UPDATE', [memberId])).rows[0] as { granted_seconds: number; billed_seconds: number };
  }
  return {
    async balance(memberId: string): Promise<VoiceBalance> {
      const result = await pool.query(`SELECT q.granted_seconds, q.billed_seconds,
        COALESCE((SELECT reserved_seconds FROM voice_reservations WHERE user_id=q.user_id AND settled_at IS NULL), 0)::integer AS reserved_seconds
        FROM voice_quotas q WHERE user_id=$1`, [memberId]);
      const row = result.rows[0] ?? { granted_seconds: VOICE_FREE_SECONDS, billed_seconds: 0, reserved_seconds: 0 };
      return { memberId, totalSeconds: row.granted_seconds, billedSeconds: row.billed_seconds, reservedSeconds: row.reserved_seconds, remainingSeconds: row.granted_seconds - row.billed_seconds - row.reserved_seconds };
    },
    async reserve(memberId: string, operationId: string): Promise<VoiceReservation> {
      return transaction(async client => {
        const account = await lock(client, memberId);
        const previous = (await client.query('SELECT * FROM voice_reservations WHERE user_id=$1 AND operation_id=$2', [memberId, operationId])).rows[0] as ReservationRow | undefined;
        if (previous) return reservationView(previous);
        if ((await client.query('SELECT 1 FROM voice_reservations WHERE user_id=$1 AND settled_at IS NULL', [memberId])).rowCount) throw new VoiceQuotaError('RESERVATION_ACTIVE', 409);
        const seconds = account.granted_seconds - account.billed_seconds;
        if (seconds <= 0) throw new VoiceQuotaError('QUOTA_EXHAUSTED', 403);
        const result = await client.query(`INSERT INTO voice_reservations (id, user_id, operation_id, reserved_seconds, created_at, deadline)
          SELECT $1,$2,$3,$4::integer,t.started,t.started + $4::integer * interval '1 second'
          FROM (SELECT date_trunc('milliseconds',clock_timestamp()) AS started) t RETURNING *`, [randomUUID(), memberId, operationId, seconds]);
        return reservationView(result.rows[0]);
      });
    },
    async settle(memberId: string, reservationId: string, input: unknown): Promise<VoiceSettlement> {
      const events = normalizeVoiceEvents(input);
      const digest = createHash('sha256').update(JSON.stringify(events)).digest('hex');
      return transaction(async client => {
        // 與 reserve 採同一會員鎖，結算與下一次占用依序對帳
        const account = await lock(client, memberId);
        const row = (await client.query('SELECT * FROM voice_reservations WHERE id=$1 AND user_id=$2 FOR UPDATE', [reservationId, memberId])).rows[0] as ReservationRow | undefined;
        if (!row) throw new VoiceQuotaError('RESERVATION_NOT_FOUND', 404);
        if (row.settled_at) {
          if (row.events_digest !== digest) throw new VoiceQuotaError('SETTLEMENT_CONFLICT', 409);
          return { billedSeconds: row.billed_seconds!, remainingSeconds: row.remaining_seconds! };
        }
        const billedSeconds = voiceBilledSeconds(events, row.reserved_seconds);
        const remainingSeconds = account.granted_seconds - account.billed_seconds - billedSeconds;
        await client.query('UPDATE voice_quotas SET billed_seconds=billed_seconds+$2 WHERE user_id=$1', [memberId, billedSeconds]);
        await client.query(`UPDATE voice_reservations SET settled_at=clock_timestamp(), billed_seconds=$2, remaining_seconds=$3, events_digest=$4 WHERE id=$1`, [reservationId, billedSeconds, remainingSeconds, digest]);
        return { billedSeconds, remainingSeconds };
      });
    },
  };
}
export type VoiceQuotaRepository = ReturnType<typeof createVoiceQuotaRepository>;
