import { sql, type SQL } from "drizzle-orm";

export const MCP_AUDIENCE = "https://mcp.thinkwithblack.com/mcp";

const CODE_BYTES = 32;
const CODE_TTL_MS = 120_000;

type SqlRows = readonly Record<string, unknown>[];
type SqlResult = SqlRows | { rows?: SqlRows };

type SqlExecutor = {
  execute(query: SQL): Promise<SqlResult>;
};

type McpDatabase = SqlExecutor & {
  transaction<T>(callback: (transaction: SqlExecutor) => Promise<T>): Promise<T>;
};

type AccountSnapshotSource = Readonly<{
  id: string;
  membership: "free" | "pro";
  membershipExpires: string | null;
  credits: number;
}>;

export type McpMembershipSnapshot = Readonly<{
  user_id: string;
  membership: "free" | "pro";
  membership_expires: string | null;
  credits: number;
  checked_at: string;
}>;

export type McpAuthServiceDependencies = Readonly<{
  getDatabase: () => Promise<McpDatabase>;
  getAccountSnapshot: (
    userId: string,
  ) => Promise<AccountSnapshotSource | null>;
  randomBytes: (length: number) => Uint8Array;
  now: () => Date;
}>;

export type CreateMcpAuthCodeInput = Readonly<{
  userId: string;
  loginState: string;
}>;

export type ConsumeMcpAuthCodeInput = Readonly<{
  code: string;
  loginState: string;
  audience: string;
}>;

function rowsFrom(result: SqlResult): SqlRows {
  const rows = Array.isArray(result)
    ? result
    : result !== null &&
        typeof result === "object" &&
        "rows" in result &&
        Array.isArray(result.rows)
      ? result.rows
      : null;
  if (
    rows === null ||
    rows.some(
      (row) => row === null || typeof row !== "object" || Array.isArray(row),
    )
  ) {
    throw new TypeError("MCP database returned an invalid result");
  }
  return rows;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function generateCode(randomBytes: (length: number) => Uint8Array): string {
  const bytes = randomBytes(CODE_BYTES);
  if (bytes.length !== CODE_BYTES) {
    throw new Error("MCP code generator returned an invalid byte length");
  }
  return Buffer.from(bytes).toString("base64url");
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function cleanupExpiredCodesQuery(): SQL {
  return sql`
    WITH expired AS (
      SELECT code_hash
      FROM mcp_auth_codes
      WHERE expires_at < now() - interval '24 hours'
      ORDER BY expires_at ASC
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM mcp_auth_codes
    WHERE code_hash IN (SELECT code_hash FROM expired)
  `;
}

function insertCodeQuery(input: {
  codeHash: string;
  loginStateHash: string;
  userId: string;
  expiresAt: Date;
}): SQL {
  return sql`
    INSERT INTO mcp_auth_codes (
      code_hash,
      login_state_hash,
      user_id,
      audience,
      expires_at
    ) VALUES (
      ${input.codeHash},
      ${input.loginStateHash},
      ${input.userId},
      ${MCP_AUDIENCE},
      ${input.expiresAt}
    )
  `;
}

function consumeCodeQuery(input: {
  codeHash: string;
  loginStateHash: string;
  audience: string;
}): SQL {
  return sql`
    UPDATE mcp_auth_codes
    SET consumed_at = now()
    WHERE code_hash = ${input.codeHash}
      AND login_state_hash = ${input.loginStateHash}
      AND audience = ${input.audience}
      AND consumed_at IS NULL
      AND expires_at > now()
    RETURNING user_id
  `;
}

export function createMcpAuthService(
  dependencies: McpAuthServiceDependencies,
) {
  async function createCode(input: CreateMcpAuthCodeInput) {
    if (input.userId.length === 0) {
      throw new TypeError("MCP user ID is required");
    }
    if (input.loginState.length === 0 || input.loginState.length > 3000) {
      throw new TypeError("MCP login state is invalid");
    }

    const code = generateCode(dependencies.randomBytes);
    const [codeHash, loginStateHash] = await Promise.all([
      sha256(code),
      sha256(input.loginState),
    ]);
    const expiresAt = new Date(dependencies.now().getTime() + CODE_TTL_MS);
    const database = await dependencies.getDatabase();

    await database.transaction(async (transaction) => {
      await transaction.execute(cleanupExpiredCodesQuery());
      await transaction.execute(
        insertCodeQuery({
          codeHash,
          loginStateHash,
          userId: input.userId,
          expiresAt,
        }),
      );
    });

    return { code, expiresAt } as const;
  }

  async function consumeCode(
    input: ConsumeMcpAuthCodeInput,
  ): Promise<string | null> {
    const [codeHash, loginStateHash] = await Promise.all([
      sha256(input.code),
      sha256(input.loginState),
    ]);
    const database = await dependencies.getDatabase();
    const result = await database.execute(
      consumeCodeQuery({ codeHash, loginStateHash, audience: input.audience }),
    );
    const rows = rowsFrom(result);
    if (rows.length === 0) {
      return null;
    }
    const userId = rows[0]?.user_id;
    if (
      rows.length !== 1 ||
      typeof userId !== "string" ||
      userId.length === 0
    ) {
      throw new TypeError("MCP database returned an invalid result");
    }
    return userId;
  }

  async function getMembership(
    userId: string,
  ): Promise<McpMembershipSnapshot | null> {
    const snapshot = await dependencies.getAccountSnapshot(userId);
    if (snapshot === null || snapshot.id !== userId) {
      return null;
    }
    if (
      (snapshot.membership !== "free" && snapshot.membership !== "pro") ||
      (snapshot.membershipExpires !== null &&
        (typeof snapshot.membershipExpires !== "string" ||
          !isCanonicalTimestamp(snapshot.membershipExpires))) ||
      !Number.isFinite(snapshot.credits)
    ) {
      return null;
    }
    return {
      user_id: snapshot.id,
      membership: snapshot.membership,
      membership_expires: snapshot.membershipExpires,
      credits: snapshot.credits,
      checked_at: dependencies.now().toISOString(),
    };
  }

  return Object.freeze({ createCode, consumeCode, getMembership });
}

const defaultService = createMcpAuthService({
  getDatabase: async () => {
    const { db } = await import("./db");
    return db as unknown as McpDatabase;
  },
  getAccountSnapshot: async (userId) => {
    const { getAccountSnapshot } = await import("./accountSnapshotService");
    return getAccountSnapshot(userId);
  },
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  now: () => new Date(),
});

export const createMcpAuthCode = defaultService.createCode;
export const consumeMcpAuthCode = defaultService.consumeCode;
export const getMcpMembershipSnapshot = defaultService.getMembership;
