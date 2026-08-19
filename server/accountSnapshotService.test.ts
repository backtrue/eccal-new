import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { aeoCoursePurchases, users } from "../shared/schema";
import {
  createAccountSnapshotService,
  type AccountSnapshotDatabase,
} from "./accountSnapshotService";

const dialect = new PgDialect();

type CapturedQuery = {
  selection: unknown;
  table?: unknown;
  predicate?: SQL;
  limit?: number;
};

type UserFixture = Readonly<{
  id: string;
  email: string | null;
  name: string | null;
  firstName: string | null;
  membershipLevel: string;
  membershipExpires: Date | null;
  credits: number;
  profileImageUrl: string | null;
  createdAt: Date | null;
}>;

function createDatabaseFixture(input: Readonly<{
  userRows: readonly UserFixture[];
  purchaseRows?: readonly Readonly<{ match: number }>[];
  failPurchaseQuery?: boolean;
}>): {
  database: AccountSnapshotDatabase;
  queries: CapturedQuery[];
} {
  const queries: CapturedQuery[] = [];
  const database = {
    select(selection?: unknown) {
      const query: CapturedQuery = { selection };
      queries.push(query);
      return {
        from(table: unknown) {
          query.table = table;
          return {
            where(predicate: SQL) {
              query.predicate = predicate;
              return {
                async limit(limit: number) {
                  query.limit = limit;
                  if (table === aeoCoursePurchases) {
                    if (input.failPurchaseQuery === true) {
                      throw new Error("purchase database unavailable");
                    }
                    return input.purchaseRows ?? [];
                  }
                  assert.equal(table, users);
                  return input.userRows;
                },
              };
            },
          };
        },
      };
    },
  } as unknown as AccountSnapshotDatabase;
  return { database, queries };
}

function userFixture(
  overrides: Partial<UserFixture> = {},
): UserFixture {
  return {
    id: "opaque-user",
    email: "  Member.Name@Example.COM  ",
    name: "Member",
    firstName: "Member",
    membershipLevel: "free",
    membershipExpires: null,
    credits: 7,
    profileImageUrl: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function compilePredicate(query: CapturedQuery) {
  assert.notEqual(query.predicate, undefined);
  return dialect.sqlToQuery(query.predicate as SQL);
}

test("account snapshot normalizes the current DB email and performs one exact read-only seo-101 existence query", async () => {
  const fixture = createDatabaseFixture({
    userRows: [userFixture()],
    purchaseRows: [{ match: 1 }],
  });
  const getAccountSnapshot = createAccountSnapshotService(fixture.database);

  const snapshot = await getAccountSnapshot("opaque-user");

  assert.equal(snapshot?.aeo_course_purchased, true);
  assert.equal(fixture.queries.length, 2);

  const userQuery = fixture.queries[0];
  assert.equal(userQuery.table, users);
  assert.equal(userQuery.limit, 1);
  assert.deepEqual(compilePredicate(userQuery).params, ["opaque-user"]);

  const purchaseQuery = fixture.queries[1];
  assert.equal(purchaseQuery.table, aeoCoursePurchases);
  assert.equal(purchaseQuery.limit, 1);
  assert.deepEqual(Object.keys(purchaseQuery.selection as object), ["match"]);
  const compiledPurchase = compilePredicate(purchaseQuery);
  assert.match(
    compiledPurchase.sql,
    /"aeo_course_purchases"\."email" = \$1.+"aeo_course_purchases"\."course_slug" = \$2/u,
  );
  assert.deepEqual(compiledPurchase.params, [
    "member.name@example.com",
    "seo-101",
  ]);
});

test("account snapshot returns false when the exact seo-101 row is absent, regardless of other-course data", async () => {
  const fixture = createDatabaseFixture({
    userRows: [userFixture()],
    purchaseRows: [],
  });
  const getAccountSnapshot = createAccountSnapshotService(fixture.database);

  const snapshot = await getAccountSnapshot("opaque-user");

  assert.equal(snapshot?.aeo_course_purchased, false);
  assert.deepEqual(compilePredicate(fixture.queries[1]).params, [
    "member.name@example.com",
    "seo-101",
  ]);
});

test("missing current user returns null without reading purchase data", async () => {
  const fixture = createDatabaseFixture({ userRows: [] });
  const getAccountSnapshot = createAccountSnapshotService(fixture.database);

  assert.equal(await getAccountSnapshot("opaque-user"), null);
  assert.equal(fixture.queries.length, 1);
});

test("purchase table, connection, or query failure rejects instead of becoming false", async () => {
  const fixture = createDatabaseFixture({
    userRows: [userFixture()],
    failPurchaseQuery: true,
  });
  const getAccountSnapshot = createAccountSnapshotService(fixture.database);

  await assert.rejects(
    getAccountSnapshot("opaque-user"),
    /purchase database unavailable/u,
  );
  assert.equal(fixture.queries[1].limit, 1);
});

test("AEO entitlement source contains no write, cache, retry, or logging path", async () => {
  const source = await readFile(
    new URL("./accountSnapshotService.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\.(?:insert|update|delete)\s*\(|\b(?:cache|retry)\b|console\s*\./iu,
  );
});
