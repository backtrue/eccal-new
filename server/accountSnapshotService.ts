import { db } from './db';
import { users } from '@shared/schema';
import { eq, or } from 'drizzle-orm';

export interface AccountSnapshot {
  id: string;
  email: string;
  name: string;
  membership: 'free' | 'pro';
  membershipExpires: string | null;
  credits: number;
  profileImageUrl: string | null;
  createdAt: string | null;
}

/**
 * 取得帳號快照 — verify-token 與 account-center 唯一的資料來源
 * membership 判斷邏輯：level === 'pro' AND expires 在未來，才算 pro
 * 兩個 S2S endpoint 都呼叫這個 function，確保資料完全一致
 */
export async function getAccountSnapshot(userIdOrEmail: string): Promise<AccountSnapshot | null> {
  const isEmail = userIdOrEmail.includes('@');

  const rows = await db
    .select()
    .from(users)
    .where(isEmail ? eq(users.email, userIdOrEmail) : eq(users.id, userIdOrEmail))
    .limit(1);

  if (rows.length === 0) return null;

  const u = rows[0];

  const isPro =
    u.membershipLevel === 'pro' &&
    u.membershipExpires != null &&
    new Date(u.membershipExpires) > new Date();

  return {
    id: String(u.id),
    email: String(u.email || ''),
    name: String(u.name || u.firstName || u.email || ''),
    membership: isPro ? 'pro' : 'free',
    membershipExpires: u.membershipExpires
      ? new Date(u.membershipExpires).toISOString()
      : null,
    credits: Number.isFinite(Number(u.credits)) ? Number(u.credits) : 0,
    profileImageUrl: u.profileImageUrl || null,
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
  };
}
