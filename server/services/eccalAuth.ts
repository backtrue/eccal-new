import jwt from 'jsonwebtoken';

// JWT_SECRET is REQUIRED - fail fast if not set
if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Cannot generate secure tokens.');
}
const JWT_SECRET: string = process.env.JWT_SECRET;

interface UserData {
  id?: string;
  email: string;
  name?: string;
  membershipLevel?: string;
  credits?: number;
}

interface ScopedTokenPayload {
  sub?: string;
  email: string;
  name: string;
  membership: string;
  credits: number;
  scope: string[];
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

/**
 * 根據會員等級推導 scope 權限
 * @param membership - 會員等級 ('free', 'pro', 'founders')
 * @returns scope 陣列
 */
export function deriveScopes(membership: string): string[] {
  const normalizedMembership = (membership || 'free').toLowerCase();
  
  // Pro 和 Founders 會員擁有完整權限
  if (normalizedMembership === 'pro' || normalizedMembership === 'founders') {
    return [
      'user:profile',
      'line:read',
      'line:write',
      'line:manage'
    ];
  }
  
  // Free 會員只有基本讀取權限
  return [
    'user:profile',
    'line:read'
  ];
}

/**
 * 生成短效的 Internal JWT (15 分鐘有效期)
 * 包含 scope 權限控制，用於子服務 API 調用
 * @param userData - 用戶資料
 * @returns JWT token 字串
 */
export function generateInternalJWT(userData: UserData): string {
  const now = Math.floor(Date.now() / 1000);
  const membership = userData.membershipLevel || 'free';
  const scopes = deriveScopes(membership);
  
  const payload: ScopedTokenPayload = {
    sub: userData.id,
    email: userData.email,
    name: userData.name || userData.email,
    membership: membership,
    credits: userData.credits || 0,
    scope: scopes,
    iat: now,
    exp: now + 15 * 60, // 15 分鐘後過期
    iss: 'eccal.thinkwithblack.com',
    aud: 'eccal-services'
  };
  
  return jwt.sign(payload, JWT_SECRET);
}

/**
 * 驗證 Internal JWT
 * @param token - JWT token
 * @returns 解碼後的 payload 或 null
 */
export function verifyInternalJWT(token: string): ScopedTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    // 確保 scope 是陣列格式
    if (typeof decoded.scope === 'string') {
      decoded.scope = decoded.scope.split(' ');
    }
    
    return decoded as ScopedTokenPayload;
  } catch (error) {
    console.error('Internal JWT verification failed:', error);
    return null;
  }
}

/**
 * 檢查用戶是否擁有指定的 scope
 * @param userScopes - 用戶的 scope 陣列
 * @param requiredScopes - 需要的 scope（至少符合一個）
 * @returns 是否有權限
 */
export function hasScope(userScopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.some(scope => userScopes.includes(scope));
}
