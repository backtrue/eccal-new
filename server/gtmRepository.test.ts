import assert from "node:assert/strict";
import test from "node:test";
import { createGtmRepository, createGtmPostgresRepository } from "./gtmRepository";

test("GTM offline repository fake enforces owner and generation", async () => {
  const repository = createGtmRepository();
  const connection = await repository.ensureConnection({ userId: "member", googleClientId: "client" });
  assert.equal(connection.status, "disconnected");
  await assert.rejects(
    repository.getConnectionState({ userId: "other", connectionId: connection.connectionId, generation: 0, status: "disconnected" }),
  );
  const disconnected = await repository.disconnectConnection({ userId: "member", connectionId: connection.connectionId, generation: 0 });
  assert.equal(disconnected.generation, 1);
  assert.equal(await repository.isResultEligible({ userId: "member", connectionId: connection.connectionId, generation: 0 }), false);
});

test("GTM PostgreSQL repository uses a supplied recording pool without opening one itself", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const row = {
    userId: "member", connectionId: "connection", googleClientId: "client",
    googleSubjectHash: null, credentialEnvelope: null, status: "disconnected",
    generation: 0, createdAt: new Date(0), updatedAt: new Date(0),
  };
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes("SELECT") && sql.includes("FROM gtm_connections")) return { rowCount: 1, rows: [row] };
      return { rowCount: 0, rows: [] };
    },
    connect: async () => ({ query: pool.query, release() {} }),
  };
  const repository = createGtmPostgresRepository(pool);
  const result = await repository.ensureConnection({ userId: "member", googleClientId: "client" });
  assert.equal(result.userId, "member");
  assert.ok(queries.some(query => query.sql.includes("$1") && query.values?.[0] === "member"));
  assert.ok(!queries.some(query => /\bmember\b|\bclient\b/.test(query.sql)));
});