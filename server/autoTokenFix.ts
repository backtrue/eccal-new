import { secureTokenService, type TokenData } from "./secureTokenService";

export interface GoogleTokenService {
  getToken(userId: string, provider: "google"): Promise<TokenData | null>;
  storeToken(
    userId: string,
    provider: "google",
    token: Pick<TokenData, "accessToken" | "refreshToken" | "expiresAt">,
  ): Promise<void>;
  deleteToken(userId: string, provider: "google"): Promise<void>;
}

type Clock = () => Date;

const hoursFrom = (date: Date, hours: number): Date =>
  new Date(date.getTime() + hours * 60 * 60 * 1000);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "未知錯誤";

export function isOwnedGoogleToken(
  token: TokenData | null,
  userId: string,
): token is TokenData {
  return token?.userId === userId && token.provider === "google";
}

export async function getOwnedGoogleToken(
  userId: string,
  tokenService: GoogleTokenService = secureTokenService,
): Promise<TokenData | null> {
  const token = await tokenService.getToken(userId, "google");
  return isOwnedGoogleToken(token, userId) ? token : null;
}

async function extendGoogleTokenExpiry(
  userId: string,
  token: TokenData,
  expiresAt: Date,
  tokenService: GoogleTokenService,
): Promise<void> {
  await tokenService.storeToken(userId, "google", {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt,
  });
}

export async function batchFixExpiredTokens(
  userId: string,
  tokenService: GoogleTokenService = secureTokenService,
  now: Clock = () => new Date(),
): Promise<{ fixed: number; details: string[] }> {
  try {
    const currentTime = now();
    const token = await getOwnedGoogleToken(userId, tokenService);
    if (!token || !token.expiresAt || token.expiresAt.getTime() >= currentTime.getTime()) {
      return { fixed: 0, details: [] };
    }

    await extendGoogleTokenExpiry(
      userId,
      token,
      hoursFrom(currentTime, 48),
      tokenService,
    );
    return {
      fixed: 1,
      details: ["已更新已驗證會員的 Google token 到期時間"],
    };
  } catch (error: unknown) {
    return {
      fixed: 0,
      details: ["Google token 修復失敗：" + errorMessage(error)],
    };
  }
}

export async function forceFixUserToken(
  userId: string,
  tokenService: GoogleTokenService = secureTokenService,
  now: Clock = () => new Date(),
): Promise<{ success: boolean; newExpiry?: Date; error?: string }> {
  try {
    const token = await getOwnedGoogleToken(userId, tokenService);
    if (!token) {
      return { success: false, error: "找不到此會員的 Google token" };
    }

    const newExpiry = hoursFrom(now(), 72);
    await extendGoogleTokenExpiry(userId, token, newExpiry, tokenService);
    return { success: true, newExpiry };
  } catch (error: unknown) {
    return { success: false, error: errorMessage(error) };
  }
}

export async function clearGoogleTokenForOwner(
  userId: string,
  tokenService: GoogleTokenService = secureTokenService,
): Promise<boolean> {
  const token = await getOwnedGoogleToken(userId, tokenService);
  if (!token) {
    return false;
  }
  await tokenService.deleteToken(userId, "google");
  return true;
}
