import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { aeoCoursePurchases } from "../shared/schema";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
};

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("AEO purchase schema has only the approved fields and one email-course identity", () => {
  const config = getTableConfig(aeoCoursePurchases);

  assert.equal(config.name, "aeo_course_purchases");
  assert.deepEqual(
    config.columns.map((column) => column.name),
    ["id", "email", "course_slug", "source", "recorded_at"],
  );
  assert.equal(config.columns[0]?.columnType, "PgUUID");
  assert.equal(config.columns[1]?.notNull, true);
  assert.equal(config.columns[2]?.default, "seo-101");
  assert.equal(config.columns[3]?.default, "aeo-class-admin-sync");
  assert.equal(config.columns[4]?.notNull, true);
  assert.equal(config.columns[4]?.hasDefault, true);
  assert.deepEqual(
    config.indexes.map((index) => index.config.name),
    ["aeo_course_purchases_email_course_slug_idx"],
  );
  assert.deepEqual(
    config.checks.map((check) => check.name),
    [
      "aeo_course_purchases_course_slug_check",
      "aeo_course_purchases_source_check",
    ],
  );
});

test("AEO purchase endpoint authenticates, normalizes email, and is idempotent", async () => {
  const { createAeoCoursePurchaseHandler } = await import("./accountCenterRoutes");
  const recordedEmails: string[] = [];
  const existing = new Set<string>();
  const handler = createAeoCoursePurchaseHandler({
    getApiKey: () => "test-aeo-sync-api-key",
    recordPurchase: async (email) => {
      recordedEmails.push(email);
      const created = !existing.has(email);
      existing.add(email);
      return created;
    },
  });

  const firstResponse = createResponse();
  await handler(
    {
      headers: { "x-api-key": "test-aeo-sync-api-key" },
      body: { email: "  Student@Example.COM " },
    } as never,
    firstResponse as never,
  );

  assert.equal(firstResponse.statusCode, 200);
  assert.deepEqual(firstResponse.body, {
    success: true,
    purchase: {
      email: "student@example.com",
      courseSlug: "seo-101",
      source: "aeo-class-admin-sync",
    },
    created: true,
  });

  const secondResponse = createResponse();
  await handler(
    {
      headers: { "x-api-key": "test-aeo-sync-api-key" },
      body: { email: "student@example.com" },
    } as never,
    secondResponse as never,
  );

  assert.equal(secondResponse.statusCode, 200);
  assert.equal((secondResponse.body as { created: boolean }).created, false);
  assert.deepEqual(recordedEmails, ["student@example.com", "student@example.com"]);
});

test("AEO purchase endpoint rejects missing or invalid API keys without writing", async () => {
  const { createAeoCoursePurchaseHandler } = await import("./accountCenterRoutes");
  let writes = 0;
  const handler = createAeoCoursePurchaseHandler({
    getApiKey: () => "test-aeo-sync-api-key",
    recordPurchase: async () => {
      writes += 1;
      return true;
    },
  });
  for (const [headers, expectedStatus] of [
    [{}, 401],
    [{ "x-api-key": "wrong-key" }, 403],
  ] as const) {
    const response = createResponse();
    await handler(
      {
        headers,
        body: { email: "student@example.com" },
      } as never,
      response as never,
    );
    assert.equal(response.statusCode, expectedStatus);
  }

  assert.equal(writes, 0);
});
