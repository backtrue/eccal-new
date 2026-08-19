import type { db } from './db';
import { aeoCoursePurchases, users } from '@shared/schema';
import { and, eq, sql } from 'drizzle-orm';

export interface AccountSnapshot {
  id: string;
  email: string;
  name: string;
  membership: 'free' | 'pro';
  membershipExpires: string | null;
  credits: number;
  aeo_course_purchased: boolean;
  profileImageUrl: string | null;
  createdAt: string | null;
}

export type AccountSnapshotDatabase = Pick<typeof db, 'select'>;

/**
 * 取得帳號快照 — verify-token 與 account-center 唯一的資料來源
 * membership 判斷邏輯：
 *   level === 'pro' 或 'founders'
 *   且 expires 為 null（終身）或在未來（定期）
 * 兩個 S2S endpoint 都呼叫這個 function，確保資料完全一致
 */
export function createAccountSnapshotService(database: AccountSnapshotDatabase) {
  return async function getAccountSnapshot(
    userIdOrEmail: string,
  ): Promise<AccountSnapshot | null> {
    const isEmail = userIdOrEmail.includes('@');

    const rows = await database
      .select()
      .from(users)
      .where(isEmail ? eq(users.email, userIdOrEmail) : eq(users.id, userIdOrEmail))
      .limit(1);

    if (rows.length === 0) return null;

    const u = rows[0];
    const normalizedEmail = String(u.email || '').trim().toLowerCase();
    const purchaseRows = await database
      .select({ match: sql<number>`1` })
      .from(aeoCoursePurchases)
      .where(
        and(
          eq(aeoCoursePurchases.email, normalizedEmail),
          eq(aeoCoursePurchases.courseSlug, 'seo-101'),
        ),
      )
      .limit(1);

    const isProLevel = u.membershipLevel === 'pro' || u.membershipLevel === 'founders';
    const notExpired = u.membershipExpires == null || new Date(u.membershipExpires) > new Date();
    const isPro = isProLevel && notExpired;

    return {
      id: String(u.id),
      email: String(u.email || ''),
      name: String(u.name || u.firstName || u.email || ''),
      membership: isPro ? 'pro' : 'free',
      membershipExpires: u.membershipExpires
        ? new Date(u.membershipExpires).toISOString()
        : null,
      credits: Number.isFinite(Number(u.credits)) ? Number(u.credits) : 0,
      aeo_course_purchased: purchaseRows.length > 0,
      profileImageUrl: u.profileImageUrl || null,
      createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
    };
  };
}

export async function getAccountSnapshot(
  userIdOrEmail: string,
): Promise<AccountSnapshot | null> {
  const { db: database } = await import('./db');
  return createAccountSnapshotService(database)(userIdOrEmail);
}
