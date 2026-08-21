import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { mcpAuthCodes } from "../shared/schema";
import {
  createMcpAuthService,
  MCP_AUDIENCE,
  type McpAuthServiceDependencies,
} from "./mcpAuthService";

const dialect = new PgDialect();

function compile(query: SQL) {
  return dialect.sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deterministicBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index);
}

function unusedSnapshot(): never {
  throw new Error("snapshot dependency must not be called");
}

test("mcp_auth_codes has the exact table, constraints, timestamps, and index", () => {
  const config = getTableConfig(mcpAuthCodes);
  const columns = Object.fromEntries(
    config.columns.map((column) => [column.name, column]),
  );

  assert.equal(config.name, "mcp_auth_codes");
  assert.deepEqual(Object.keys(columns), [
    "code_hash",
    "login_state_hash",
    "user_id",
    "audience",
    "expires_at",
    "consumed_at",
    "created_at",
  ]);
  assert.equal(columns.code_hash.primary, true);
  assert.equal(columns.code_hash.notNull, true);
  assert.equal(columns.login_state_hash.notNull, true);
  assert.equal(columns.login_state_hash.isUnique, true);
  assert.equal(columns.user_id.notNull, true);
  assert.equal(columns.audience.notNull, true);
  assert.equal(columns.expires_at.notNull, true);
  assert.equal(columns.consumed_at.notNull, false);
  assert.equal(columns.created_at.notNull, true);
  assert.equal(columns.created_at.hasDefault, true);
  assert.equal(
    (columns.expires_at as { withTimezone?: boolean }).withTimezone,
    true,
  );
  assert.equal(
    (columns.consumed_at as { withTimezone?: boolean }).withTimezone,
    true,
  );
  assert.equal(
    (columns.created_at as { withTimezone?: boolean }).withTimezone,
    true,
  );
  assert.deepEqual(
    config.indexes.map((index) => index.config.name),
    ["mcp_auth_codes_expires_at_idx"],
  );
  assert.deepEqual(
    config.checks.map((constraint) => constraint.name),
    [
      "mcp_auth_codes_code_hash_check",
      "mcp_auth_codes_login_state_hash_check",
      "mcp_auth_codes_audience_check",
    ],
  );
  const checks = Object.fromEntries(
    config.checks.map((constraint) => [
      constraint.name,
      normalizeSql(compile(constraint.value).sql),
    ]),
  );
  assert.match(
    checks.mcp_auth_codes_code_hash_check,
    /"mcp_auth_codes"\."code_hash" ~ '\^\[0-9a-f\]\{64\}\$'/u,
  );
  assert.match(
    checks.mcp_auth_codes_login_state_hash_check,
    /"mcp_auth_codes"\."login_state_hash" ~ '\^\[0-9a-f\]\{64\}\$'/u,
  );
  assert.match(
    checks.mcp_auth_codes_audience_check,
    /"mcp_auth_codes"\."audience" = 'https:\/\/mcp\.thinkwithblack\.com\/mcp'/u,
  );
  assert.equal(config.foreignKeys.length, 1);
  const reference = config.foreignKeys[0].reference();
  assert.deepEqual(
    reference.columns.map((column) => column.name),
    ["user_id"],
  );
  assert.deepEqual(
    reference.foreignColumns.map((column) => column.name),
    ["id"],
  );
  assert.equal(config.foreignKeys[0].onDelete, "cascade");
});

test("createCode stores only hashes in one cleanup-and-insert transaction", async () => {
  const queries: SQL[] = [];
  let transactionCalls = 0;
  const database = {
    async execute(): Promise<never> {
      throw new Error("top-level execute must not be called");
    },
    async transaction<T>(
      callback: (transaction: {
        execute(query: SQL): Promise<{ rows: [] }>;
      }) => Promise<T>,
    ): Promise<T> {
      transactionCalls += 1;
      return callback({
        async execute(query) {
          queries.push(query);
          return { rows: [] };
        },
      });
    },
  };
  const now = new Date("2026-08-12T00:00:00.000Z");
  const service = createMcpAuthService({
    getDatabase: async () => database,
    getAccountSnapshot: async () => unusedSnapshot(),
    randomBytes: deterministicBytes,
    now: () => new Date(now),
  } as McpAuthServiceDependencies);

  const loginState = "v1.iv.ciphertext.mac";
  const result = await service.createCode({
    userId: "opaque-user",
    loginState,
  });
  const expectedCode = Buffer.from(deterministicBytes(32)).toString(
    "base64url",
  );

  assert.equal(result.code, expectedCode);
  assert.equal(result.code.length, 43);
  assert.match(result.code, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(result.expiresAt.toISOString(), "2026-08-12T00:02:00.000Z");
  assert.equal(transactionCalls, 1);
  assert.equal(queries.length, 2);

  const cleanup = compile(queries[0]);
  const cleanupSql = normalizeSql(cleanup.sql);
  assert.match(cleanupSql, /WITH expired AS/iu);
  assert.match(cleanupSql, /expires_at < now\(\) - interval '24 hours'/iu);
  assert.match(cleanupSql, /LIMIT 100/iu);
  assert.match(cleanupSql, /DELETE FROM mcp_auth_codes/iu);
  assert.deepEqual(cleanup.params, []);

  const insert = compile(queries[1]);
  const insertSql = normalizeSql(insert.sql);
  assert.match(insertSql, /^INSERT INTO mcp_auth_codes/iu);
  assert.match(
    insertSql,
    /code_hash, login_state_hash, user_id, audience, expires_at/iu,
  );
  assert.deepEqual(insert.params, [
    digest(expectedCode),
    digest(loginState),
    "opaque-user",
    MCP_AUDIENCE,
    result.expiresAt,
  ]);
  assert.match(String(insert.params[0]), /^[0-9a-f]{64}$/u);
  assert.match(String(insert.params[1]), /^[0-9a-f]{64}$/u);
  assert.equal(insert.params.includes(expectedCode), false);
  assert.equal(insert.params.includes(loginState), false);
});

test("createCode returns no code when cleanup or insert fails", async (context) => {
  for (const failingCall of [1, 2]) {
    await context.test(`transaction query ${failingCall} fails`, async () => {
      let executeCalls = 0;
      const service = createMcpAuthService({
        getDatabase: async () => ({
          async execute(): Promise<never> {
            throw new Error("top-level execute must not be called");
          },
          async transaction<T>(
            callback: (transaction: {
              execute(query: SQL): Promise<{ rows: [] }>;
            }) => Promise<T>,
          ): Promise<T> {
            return callback({
              async execute() {
                executeCalls += 1;
                if (executeCalls === failingCall) {
                  throw new Error("database unavailable");
                }
                return { rows: [] };
              },
            });
          },
        }),
        getAccountSnapshot: async () => unusedSnapshot(),
        randomBytes: deterministicBytes,
        now: () => new Date("2026-08-12T00:00:00.000Z"),
      } as McpAuthServiceDependencies);

      await assert.rejects(
        service.createCode({ userId: "opaque-user", loginState: "state" }),
        /database unavailable/u,
      );
      assert.equal(executeCalls, failingCall);
    });
  }
});

test("consumeCode uses one atomic bound update and allows exactly one concurrent consume", async () => {
  const code = "one-time-code";
  const loginState = "v1.bound.state";
  let consumed = false;
  const compiledQueries: ReturnType<typeof compile>[] = [];
  const database = {
    async transaction(): Promise<never> {
      throw new Error("transaction must not be called");
    },
    async execute(query: SQL) {
      const compiled = compile(query);
      compiledQueries.push(compiled);
      const expected = [digest(code), digest(loginState), MCP_AUDIENCE];
      const matches =
        compiled.params.length === expected.length &&
        compiled.params.every((value, index) => value === expected[index]);
      if (matches && !consumed) {
        consumed = true;
        return { rows: [{ user_id: "opaque-user" }] };
      }
      return { rows: [] };
    },
  };
  const service = createMcpAuthService({
    getDatabase: async () => database,
    getAccountSnapshot: async () => unusedSnapshot(),
    randomBytes: deterministicBytes,
    now: () => new Date("2026-08-12T00:00:00.000Z"),
  } as McpAuthServiceDependencies);

  const results = await Promise.all([
    service.consumeCode({ code, loginState, audience: MCP_AUDIENCE }),
    service.consumeCode({ code, loginState, audience: MCP_AUDIENCE }),
  ]);
  assert.deepEqual(results.sort(), [null, "opaque-user"]);
  assert.equal(compiledQueries.length, 2);
  for (const compiled of compiledQueries) {
    const statement = normalizeSql(compiled.sql);
    assert.match(
      statement,
      /^UPDATE mcp_auth_codes SET consumed_at = now\(\)/iu,
    );
    assert.match(statement, /code_hash = \$1/iu);
    assert.match(statement, /login_state_hash = \$2/iu);
    assert.match(statement, /audience = \$3/iu);
    assert.match(statement, /consumed_at IS NULL/iu);
    assert.match(statement, /expires_at > now\(\)/iu);
    assert.match(statement, /RETURNING user_id$/iu);
    assert.equal(compiled.params.includes(code), false);
    assert.equal(compiled.params.includes(loginState), false);
  }

  assert.equal(
    await service.consumeCode({
      code: "wrong",
      loginState,
      audience: MCP_AUDIENCE,
    }),
    null,
  );
  assert.equal(
    await service.consumeCode({
      code,
      loginState: "wrong",
      audience: MCP_AUDIENCE,
    }),
    null,
  );
  assert.equal(
    await service.consumeCode({
      code,
      loginState,
      audience: "https://wrong.example/mcp",
    }),
    null,
  );
});

test("consumeCode rejects malformed database results instead of treating them as invalid codes", async (context) => {
  for (const malformedResult of [
    {},
    { rows: "not-an-array" },
    { rows: [{}] },
    { rows: [{ user_id: "" }] },
    { rows: [{ user_id: "first" }, { user_id: "second" }] },
  ]) {
    await context.test(JSON.stringify(malformedResult), async () => {
      const service = createMcpAuthService({
        getDatabase: async () => ({
          async transaction(): Promise<never> {
            throw new Error("transaction must not be called");
          },
          async execute() {
            return malformedResult;
          },
        }),
        getAccountSnapshot: async () => unusedSnapshot(),
        randomBytes: deterministicBytes,
        now: () => new Date("2026-08-12T00:00:00.000Z"),
      } as unknown as McpAuthServiceDependencies);

      await assert.rejects(
        service.consumeCode({
          code: "one-time-code",
          loginState: "state",
          audience: MCP_AUDIENCE,
        }),
        /MCP database returned an invalid result/u,
      );
    });
  }
});

test("getMembership delegates once and returns only the fixed safe snapshot", async () => {
  let calls = 0;
  const service = createMcpAuthService({
    getDatabase: async () => {
      throw new Error("database dependency must not be called directly");
    },
    getAccountSnapshot: async (userId) => {
      calls += 1;
      return {
        id: userId,
        membership: "pro" as const,
        membershipExpires: null,
        credits: 9,
        aeo_course_purchased: true,
        email: "must-not-leak@example.com",
        name: "must-not-leak",
      };
    },
    randomBytes: deterministicBytes,
    now: () => new Date("2026-08-12T03:04:05.000Z"),
  } as McpAuthServiceDependencies);

  assert.deepEqual(await service.getMembership("opaque-user"), {
    user_id: "opaque-user",
    membership: "pro",
    membership_expires: null,
    credits: 9,
    aeo_course_purchased: true,
    checked_at: "2026-08-12T03:04:05.000Z",
  });
  assert.equal(calls, 1);

  const mismatchService = createMcpAuthService({
    getDatabase: async () => {
      throw new Error("database dependency must not be called directly");
    },
    getAccountSnapshot: async () => ({
      id: "different-user",
      membership: "free" as const,
      membershipExpires: null,
      credits: 0,
      aeo_course_purchased: false,
    }),
    randomBytes: deterministicBytes,
    now: () => new Date("2026-08-12T03:04:05.000Z"),
  } as McpAuthServiceDependencies);
  assert.equal(await mismatchService.getMembership("opaque-user"), null);

  const invalidTimestampService = createMcpAuthService({
    getDatabase: async () => {
      throw new Error("database dependency must not be called directly");
    },
    getAccountSnapshot: async (userId) => ({
      id: userId,
      membership: "pro" as const,
      membershipExpires: "not-a-timestamp",
      credits: 9,
      aeo_course_purchased: true,
    }),
    randomBytes: deterministicBytes,
    now: () => new Date("2026-08-12T03:04:05.000Z"),
  } as McpAuthServiceDependencies);
  assert.equal(
    await invalidTimestampService.getMembership("opaque-user"),
    null,
  );

  const validTimestampService = createMcpAuthService({
    getDatabase: async () => {
      throw new Error("database dependency must not be called directly");
    },
    getAccountSnapshot: async (userId) => ({
      id: userId,
      membership: "pro" as const,
      membershipExpires: "2026-09-12T03:04:05.000Z",
      credits: 9,
      aeo_course_purchased: false,
    }),
    randomBytes: deterministicBytes,
    now: () => new Date("2026-08-12T03:04:05.000Z"),
  } as McpAuthServiceDependencies);
  assert.equal(
    (await validTimestampService.getMembership("opaque-user"))
      ?.membership_expires,
    "2026-09-12T03:04:05.000Z",
  );
  assert.equal(
    (await validTimestampService.getMembership("opaque-user"))
      ?.aeo_course_purchased,
    false,
  );
});

test("getMembership fails closed when the account source marker is not boolean", async () => {
  const service = createMcpAuthService({
    getDatabase: async () => {
      throw new Error("database dependency must not be called directly");
    },
    getAccountSnapshot: async (userId) => ({
      id: userId,
      membership: "free",
      membershipExpires: null,
      credits: 0,
      aeo_course_purchased: "true",
    }),
    randomBytes: deterministicBytes,
    now: () => new Date("2026-08-12T03:04:05.000Z"),
  } as unknown as McpAuthServiceDependencies);

  assert.equal(await service.getMembership("opaque-user"), null);
});

test("getAccountStatus delegates once and returns normalized Email with the same safe snapshot", async () => {
  let calls = 0;
  const service = createMcpAuthService({
    getDatabase: async () => {
      throw new Error("database dependency must not be called directly");
    },
    getAccountSnapshot: async (userId) => {
      calls += 1;
      return {
        id: userId,
        email: "  Member.Name@Example.COM  ",
        membership: "free" as const,
        membershipExpires: null,
        credits: 30,
        aeo_course_purchased: true,
      };
    },
    randomBytes: deterministicBytes,
    now: () => new Date("2026-08-21T00:00:00.000Z"),
  } as McpAuthServiceDependencies);

  assert.deepEqual(await service.getAccountStatus("opaque-user"), {
    user_id: "opaque-user",
    account_email: "member.name@example.com",
    membership: "free",
    membership_expires: null,
    credits: 30,
    aeo_course_purchased: true,
    checked_at: "2026-08-21T00:00:00.000Z",
  });
  assert.equal(calls, 1);
});

test("getAccountStatus fails closed for invalid Email without changing getMembership", async (context) => {
  for (const email of [
    undefined,
    null,
    "",
    "not-an-email",
    "member@example",
    "member @example.com",
    "a..b@example.com",
    ".member@example.com",
    "member.@example.com",
    "member@-example.com",
    "member@example-.com",
    "a".repeat(321),
    42,
  ]) {
    await context.test(String(email), async () => {
      let calls = 0;
      const service = createMcpAuthService({
        getDatabase: async () => {
          throw new Error("database dependency must not be called directly");
        },
        getAccountSnapshot: async (userId) => {
          calls += 1;
          return {
            id: userId,
            email,
            membership: "pro" as const,
            membershipExpires: null,
            credits: 9,
            aeo_course_purchased: false,
          };
        },
        randomBytes: deterministicBytes,
        now: () => new Date("2026-08-21T00:00:00.000Z"),
      } as McpAuthServiceDependencies);

      assert.equal(await service.getAccountStatus("opaque-user"), null);
      assert.equal(calls, 1);
      assert.deepEqual(await service.getMembership("opaque-user"), {
        user_id: "opaque-user",
        membership: "pro",
        membership_expires: null,
        credits: 9,
        aeo_course_purchased: false,
        checked_at: "2026-08-21T00:00:00.000Z",
      });
      assert.equal(calls, 2);
    });
  }
});
