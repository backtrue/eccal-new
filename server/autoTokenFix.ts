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

export type BatchFixResult =
  | { success: true; fixed: number; details: string[] }
  | { success: false; fixed: 0; details: string[] };

export type ForceFixResult =
  | { success: true; newExpiry: Date }
  | { success: false; reason: "not_found" | "storage"; error: string };

export interface TokenFixResponse {
  status(code: number): TokenFixResponse;
  json(body: unknown): unknown;
}

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
): Promise<BatchFixResult> {
  try {
    const currentTime = now();
    const token = await getOwnedGoogleToken(userId, tokenService);
    if (!token || !token.expiresAt || token.expiresAt.getTime() >= currentTime.getTime()) {
      return { success: true, fixed: 0, details: [] };
    }

    await extendGoogleTokenExpiry(
      userId,
      token,
      hoursFrom(currentTime, 48),
      tokenService,
    );
    return {
      success: true,
      fixed: 1,
      details: ["已更新已驗證會員的 Google token 到期時間"],
    };
  } catch (error: unknown) {
    return {
      success: false,
      fixed: 0,
      details: ["Google token 修復失敗：" + errorMessage(error)],
    };
  }
}

export async function forceFixUserToken(
  userId: string,
  tokenService: GoogleTokenService = secureTokenService,
  now: Clock = () => new Date(),
): Promise<ForceFixResult> {
  try {
    const token = await getOwnedGoogleToken(userId, tokenService);
    if (!token) {
      return {
        success: false,
        reason: "not_found",
        error: "找不到此會員的 Google token",
      };
    }

    const newExpiry = hoursFrom(now(), 72);
    await extendGoogleTokenExpiry(userId, token, newExpiry, tokenService);
    return { success: true, newExpiry };
  } catch (error: unknown) {
    return {
      success: false,
      reason: "storage",
      error: errorMessage(error),
    };
  }
}

const batchFailureMessage = (result: Extract<BatchFixResult, { success: false }>): string =>
  result.details[0] || "Google token 修復失敗";

export function sendAdminBatchFixResult(
  res: TokenFixResponse,
  result: BatchFixResult,
): unknown {
  if (!result.success) {
    return res.status(500).json({
      success: false,
      error: batchFailureMessage(result),
    });
  }
  return res.json({
    success: true,
    message: "Token 修復完成",
    fixed: result.fixed,
    details: result.details,
  });
}

export function sendEmergencyBatchFixResult(
  res: TokenFixResponse,
  result: BatchFixResult,
  authenticatedEmail: string | null,
): unknown {
  if (!result.success) {
    return res.status(500).json({
      success: false,
      error: batchFailureMessage(result),
    });
  }
  return res.json({
    success: true,
    fixedCount: result.fixed,
    affectedUsers:
      result.fixed > 0 && authenticatedEmail
        ? [authenticatedEmail]
        : [],
    message: result.fixed > 0
      ? "已修復目前會員的 Google token 到期時間"
      : "目前會員沒有需要修復的 Google token",
  });
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
