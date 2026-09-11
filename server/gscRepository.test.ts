import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";
import {
  GSC_CREDENTIAL_FORMAT_VERSION,
  createGscCredentialService,
  type GscEncryptedEnvelope,
} from "./gscCredentialService";
import {
  GSC_OAUTH_REDIRECT_URI,
  GscRepositoryError,
  createGscRepository,
  type GscConnectionState,
} from "./gscRepository";
import {
  GSC_READONLY_SCOPE,
  GscOAuthError,
  createGscOAuthService,
} from "./gscOAuth";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required GSC repository test setting: ${name}`);
  }
  return value;
}

const TEST_CONFIG = Object.freeze({
  host: requiredEnvironment("GSC_TEST_PGHOST"),
  port: Number(requiredEnvironment("GSC_TEST_PGPORT")),
  database: requiredEnvironment("GSC_TEST_PGDATABASE"),
  user: requiredEnvironment("GSC_TEST_PGUSER"),
});
const SCHEMA_SQL_PATH = requiredEnvironment("GSC_TEST_SCHEMA_SQL");
const EVIDENCE_DIRECTORY = requiredEnvironment("GSC_TEST_EVIDENCE_DIR");
const EXPECTED_EVIDENCE_DIRECTORY = "/tmp/twb-gsc-a003-local-evidence";
const EXPECTED_REWORK_EVIDENCE_DIRECTORY =
  `${EXPECTED_EVIDENCE_DIRECTORY}/rework-1`;
const EXPECTED_TASK23_4_EVIDENCE_DIRECTORY =
  "/tmp/twb-gsc-a004-local-evidence/repository-regression";
const EXPECTED_TASK23_4_REWORK_EVIDENCE_DIRECTORY =
  "/tmp/twb-gsc-a004-local-evidence/rework-1/repository-regression";
const EXPECTED_TASK23_5_EVIDENCE_DIRECTORY =
  "/tmp/twb-gsc-a005-local-evidence/repository-regression";
const EXPECTED_TASK23_5_REWORK_EVIDENCE_DIRECTORY =
  "/tmp/twb-gsc-a005-local-evidence/rework-1/repository-regression";
const EXPECTED_TASK23_6_EVIDENCE_DIRECTORY =
  "/tmp/twb-gsc-a006-local-evidence/repository-regression";
const EXPECTED_TASK23_8_EVIDENCE_DIRECTORY =
  "/tmp/twb-gsc-a008-local-evidence/repository-regression";
const EXPECTED_DATA_DIRECTORY = `${EXPECTED_EVIDENCE_DIRECTORY}/pgdata`;
const EXPECTED_SOCKET_DIRECTORY = `${EXPECTED_EVIDENCE_DIRECTORY}/socket`;
const { Pool } = pg;
const pool = new Pool({ ...TEST_CONFIG, max: 12 });
const repository = createGscRepository(pool);
const credentialService = createGscCredentialService({
  credentialKey: Buffer.alloc(32, 7),
});
let sequence = 0;

function nextValue(label: string): string {
  sequence += 1;
  return `${label}-${process.pid}-${sequence}`;
}

function hash(
  kind: "ticket" | "state" | "browser_session" | "oidc_nonce",
  label: string,
): string {
  return credentialService.hashOpaqueProof(kind, nextValue(label));
}

function subjectHash(googleClientId: string, subject: string): string {
  return credentialService.hashGoogleSubject(googleClientId, subject);
}

function credentialEnvelope(
  connection: GscConnectionState,
  subject: string,
  suffix = "one",
): GscEncryptedEnvelope {
  return credentialService.encryptCredentialEnvelope(
    {
      userId: connection.userId,
      connectionId: connection.connectionId,
      googleClientId: connection.googleClientId,
      generation: connection.generation,
      formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
    },
    {
      refreshToken: `synthetic-refresh-${suffix}`,
      googleSubject: subject,
      displayEmail: `${suffix}@example.test`,
      grantedScopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/webmasters.readonly",
      ],
    },
  );
}

function pkceEnvelope(
  connection: GscConnectionState,
  stateHash: string,
  sessionProofHash: string,
): GscEncryptedEnvelope {
  return credentialService.encryptPkceVerifier(
    {
      userId: connection.userId,
      connectionId: connection.connectionId,
      googleClientId: connection.googleClientId,
      redirectUri: GSC_OAUTH_REDIRECT_URI,
      generation: connection.generation,
      browserSessionHash: sessionProofHash,
      stateHash,
      formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
    },
    "p".repeat(64),
  );
}

async function insertUser(userId: string): Promise<void> {
  await pool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
}

async function preparePendingFlow(
  connection: GscConnectionState,
  label: string,
) {
  const ticketHash = hash("ticket", `${label}-ticket`);
  const stateHash = hash("state", `${label}-state`);
  const sessionProofHash = hash("browser_session", `${label}-session`);
  const oidcNonceHash = hash("oidc_nonce", `${label}-nonce`);
  const intent = await repository.beginConnectionIntent({
    userId: connection.userId,
    connectionId: connection.connectionId,
    generation: connection.generation,
    googleClientId: connection.googleClientId,
    ticketHash,
  });
  const encryptedPkceVerifier = pkceEnvelope(
    connection,
    stateHash,
    sessionProofHash,
  );
  await repository.startOAuthFromIntent({
    userId: connection.userId,
    connectionId: connection.connectionId,
    generation: connection.generation,
    googleClientId: connection.googleClientId,
    ticketHash,
    stateHash,
    sessionProofHash,
    oidcNonceHash,
    encryptedPkceVerifier,
  });
  return Object.freeze({
    intent,
    ticketHash,
    stateHash,
    sessionProofHash,
    oidcNonceHash,
    encryptedPkceVerifier,
  });
}

async function prepareProcessingFlow(
  connection: GscConnectionState,
  label: string,
) {
  const pending = await preparePendingFlow(connection, label);
  const claimed = await repository.acquireOAuthProcessing({
    userId: connection.userId,
    connectionId: connection.connectionId,
    generation: connection.generation,
    googleClientId: connection.googleClientId,
    stateHash: pending.stateHash,
    sessionProofHash: pending.sessionProofHash,
  });
  return Object.freeze({ ...pending, claimed });
}

async function insertExpiredPendingFlow(
  connection: GscConnectionState,
  label: string,
) {
  const ticketHash = hash("ticket", `${label}-expired-ticket`);
  const stateHash = hash("state", `${label}-expired-state`);
  const sessionProofHash = hash(
    "browser_session",
    `${label}-expired-session`,
  );
  const oidcNonceHash = hash("oidc_nonce", `${label}-expired-nonce`);
  const encryptedPkceVerifier = pkceEnvelope(
    connection,
    stateHash,
    sessionProofHash,
  );
  const inserted = await pool.query<{ flowId: string }>(
    `INSERT INTO gsc_oauth_flows (
       connection_id, user_id, expected_generation, google_client_id,
       redirect_uri, status, ticket_hash, state_hash, session_proof_hash,
       oidc_nonce_hash, encrypted_pkce_verifier, expires_at, created_at,
       updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'oauth_pending', $6, $7, $8, $9, $10,
       CURRENT_TIMESTAMP - interval '1 minute',
       CURRENT_TIMESTAMP - interval '11 minutes',
       CURRENT_TIMESTAMP - interval '11 minutes'
     )
     RETURNING flow_id AS "flowId"`,
    [
      connection.connectionId,
      connection.userId,
      connection.generation,
      connection.googleClientId,
      GSC_OAUTH_REDIRECT_URI,
      ticketHash,
      stateHash,
      sessionProofHash,
      oidcNonceHash,
      encryptedPkceVerifier,
    ],
  );
  return Object.freeze({
    flowId: inserted.rows[0].flowId,
    stateHash,
    sessionProofHash,
    encryptedPkceVerifier,
  });
}

async function setupExpiredMembersAAndB(label: string) {
  await insertUser("member-a");
  await insertUser("member-b");
  const connectionA = await repository.ensureConnection({
    userId: "member-a",
    googleClientId: "gsc-client",
  });
  const connectionB = await repository.ensureConnection({
    userId: "member-b",
    googleClientId: "gsc-client",
  });
  const expiredA = await insertExpiredPendingFlow(connectionA, label);
  const expiredB = await insertExpiredPendingFlow(
    connectionB,
    `${label}-member-b`,
  );
  return Object.freeze({ connectionA, connectionB, expiredA, expiredB });
}

async function assertExpiredAIsClearedAndExpiredBIsPreserved(input: {
  expiredA: { flowId: string };
  expiredB: {
    flowId: string;
    encryptedPkceVerifier: GscEncryptedEnvelope;
  };
}): Promise<void> {
  const rows = await pool.query<{
    flowId: string;
    userId: string;
    status: string;
    encryptedPkceVerifier: GscEncryptedEnvelope | null;
  }>(
    `SELECT flow_id AS "flowId", user_id AS "userId", status,
            encrypted_pkce_verifier AS "encryptedPkceVerifier"
       FROM gsc_oauth_flows
      WHERE flow_id = ANY($1::uuid[])
      ORDER BY user_id`,
    [[input.expiredA.flowId, input.expiredB.flowId]],
  );
  assert.deepEqual(rows.rows, [{
    flowId: input.expiredA.flowId,
    userId: "member-a",
    status: "cancelled",
    encryptedPkceVerifier: null,
  }, {
    flowId: input.expiredB.flowId,
    userId: "member-b",
    status: "oauth_pending",
    encryptedPkceVerifier: input.expiredB.encryptedPkceVerifier,
  }]);
}

async function activateConnection(
  userId: string,
  googleClientId: string,
  googleSubject: string,
) {
  await insertUser(userId);
  const connection = await repository.ensureConnection({
    userId,
    googleClientId,
  });
  const flow = await prepareProcessingFlow(connection, `${userId}-activate`);
  const envelope = credentialEnvelope(connection, googleSubject, userId);
  const active = await repository.completeOAuthBinding({
    userId,
    connectionId: connection.connectionId,
    generation: connection.generation,
    flowId: flow.claimed.flowId,
    googleClientId,
    googleSubjectHash: subjectHash(googleClientId, googleSubject),
    credentialEnvelope: envelope,
  });
  return Object.freeze({ active, envelope });
}

async function runInvalidRefreshPoolScenario(input: {
  evidenceName: string;
  response: Readonly<{ status: number; body: Record<string, unknown> }>;
}): Promise<void> {
  const limitedPool = new Pool({
    ...TEST_CONFIG,
    max: 3,
    connectionTimeoutMillis: 8000,
  });
  let releaseResponses = () => undefined;
  let allRequestsArrived = () => undefined;
  const responseBarrier = new Promise<void>((resolve) => {
    releaseResponses = resolve;
  });
  const requestBarrier = new Promise<void>((resolve) => {
    allRequestsArrived = resolve;
  });
  let transportCalls = 0;
  let maxWaitingCount = 0;
  const samplePool = setInterval(() => {
    maxWaitingCount = Math.max(maxWaitingCount, limitedPool.waitingCount);
  }, 1);
  try {
    const connections = await Promise.all(
      ["member-refresh-a", "member-refresh-b", "member-refresh-c"].map(
        async (userId, index) => activateConnection(
          userId,
          "gsc-client",
          `refresh-subject-${index + 1}`,
        ),
      ),
    );
    const originalEnvelopes = new Map(
      connections.map(({ active, envelope }) => [active.userId, envelope]),
    );
    const service = createGscOAuthService({
      googleClientId: "gsc-client",
      googleClientSecret: "synthetic-client-secret-never-log",
      repository: createGscRepository(limitedPool),
      credentialService,
      transport: Object.freeze({
        request: async () => {
          transportCalls += 1;
          if (transportCalls === connections.length) allRequestsArrived();
          await responseBarrier;
          return input.response;
        },
      }),
    });
    const startedAt = Date.now();
    const refreshes = connections.map(({ active }) =>
      service.refreshCredential({
        userId: active.userId,
        connectionId: active.connectionId,
        generation: active.generation,
      })
    );
    await Promise.race([
      requestBarrier,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("refresh barrier was not reached")), 2000);
      }),
    ]);
    releaseResponses();
    const settled = await Promise.allSettled(refreshes);
    const elapsedMs = Date.now() - startedAt;
    maxWaitingCount = Math.max(maxWaitingCount, limitedPool.waitingCount);
    const rows = await pool.query<{
      userId: string;
      connectionId: string;
      status: string;
      generation: number;
      credentialEnvelope: GscEncryptedEnvelope | null;
    }>(
      `SELECT user_id AS "userId", connection_id AS "connectionId", status,
              generation, credential_envelope AS "credentialEnvelope"
         FROM gsc_connections
        WHERE user_id = ANY($1::varchar[])
        ORDER BY user_id`,
      [connections.map(({ active }) => active.userId)],
    );
    const evidence = {
      capturedAt: new Date().toISOString(),
      pool: {
        configuredMax: 3,
        connectionTimeoutMillis: 8000,
        totalCount: limitedPool.totalCount,
        idleCount: limitedPool.idleCount,
        waitingCount: limitedPool.waitingCount,
        maxWaitingCount,
      },
      transportCalls,
      elapsedMs,
      results: settled.map((result, index) => ({
        member: connections[index].active.userId,
        outcome: result.status,
        safeCode: result.status === "rejected" &&
            result.reason instanceof GscOAuthError
          ? result.reason.code
          : result.status === "fulfilled"
          ? "fulfilled"
          : "non_gsc_error",
      })),
      rows: rows.rows.map((row) => ({
        userId: row.userId,
        connectionId: row.connectionId,
        status: row.status,
        generation: row.generation,
        credentialUnchanged: row.credentialEnvelope !== null &&
          isDeepStrictEqual(
            row.credentialEnvelope,
            originalEnvelopes.get(row.userId),
          ),
      })),
      credentialChangeCount: rows.rows.filter((row) =>
        row.credentialEnvelope === null ||
        !isDeepStrictEqual(
          row.credentialEnvelope,
          originalEnvelopes.get(row.userId),
        )
      ).length,
    };
    await writeFile(
      resolve(EVIDENCE_DIRECTORY, input.evidenceName),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { mode: 0o600 },
    );
    assert.equal(transportCalls, 3);
    assert.equal(maxWaitingCount, 0);
    assert.deepEqual(
      evidence.results.map((result) => result.safeCode),
      Array(3).fill("GSC_OAUTH_REAUTHORIZATION_REQUIRED"),
    );
    assert.equal(rows.rows.length, 3);
    assert.deepEqual(
      rows.rows.map((row) => row.status),
      Array(3).fill("reauthorization_required"),
    );
    assert.deepEqual(
      rows.rows.map((row) => row.generation),
      connections.map(({ active }) => active.generation),
    );
    assert.equal(evidence.credentialChangeCount, 0);
  } finally {
    clearInterval(samplePool);
    releaseResponses();
    await limitedPool.end();
  }
}

function assertGenericRejection(
  operation: () => Promise<unknown>,
  sensitiveValues: readonly string[] = [],
): Promise<void> {
  return assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof GscRepositoryError);
    assert.equal(error.code, "GSC_REPOSITORY_REJECTED");
    for (const sensitive of sensitiveValues) {
      assert.equal(error.message.includes(sensitive), false);
    }
    return true;
  });
}

type WorkerResult = Readonly<{
  nodePid: number;
  backendPid: number;
  ok: boolean;
  code?: string;
  flowId?: string;
  marker?: string;
  startedAt?: number;
  enteredAt?: number;
  finishedAt?: number;
}>;

const repositoryUrl = pathToFileURL(
  resolve(process.cwd(), "server/gscRepository.ts"),
).href;
const workerSource = `
  import pg from "pg";
  import { createGscRepository } from ${JSON.stringify(repositoryUrl)};
  const payload = JSON.parse(process.env.GSC_WORKER_PAYLOAD);
  const { Pool } = pg;
  const pool = new Pool({
    host: process.env.GSC_TEST_PGHOST,
    port: Number(process.env.GSC_TEST_PGPORT),
    database: process.env.GSC_TEST_PGDATABASE,
    user: process.env.GSC_TEST_PGUSER,
    max: 1,
  });
  const repository = createGscRepository(pool);
  const backend = await pool.query("SELECT pg_backend_pid() AS pid");
  if (payload.barrierKey) {
    process.send({
      type: "ready",
      nodePid: process.pid,
      backendPid: backend.rows[0].pid,
    });
    await new Promise((resolve) => process.once("message", resolve));
    await pool.query(
      "SELECT pg_advisory_lock_shared(hashtextextended($1, 0))",
      [payload.barrierKey],
    );
  }
  const startedAt = Date.now();
  let result;
  try {
    if (payload.kind === "acquire") {
      const claimed = await repository.acquireOAuthProcessing(payload.input);
      result = { ok: true, flowId: claimed.flowId };
    } else if (payload.kind === "complete") {
      await repository.completeOAuthBinding(payload.input);
      result = { ok: true, marker: payload.marker };
    } else if (payload.kind === "refresh") {
      result = await repository.withRefreshLock(payload.input, async (session) => {
        const enteredAt = Date.now();
        await new Promise((resolve) => setTimeout(resolve, payload.holdMilliseconds));
        await session.replaceCredentialEnvelope(payload.credentialEnvelope);
        return { ok: true, enteredAt, finishedAt: Date.now() };
      });
    } else {
      throw new Error("unknown worker operation");
    }
  } catch (error) {
    result = { ok: false, code: error && error.code };
  }
  if (payload.barrierKey) {
    await pool.query(
      "SELECT pg_advisory_unlock_shared(hashtextextended($1, 0))",
      [payload.barrierKey],
    );
  }
  process.stdout.write(JSON.stringify({
    nodePid: process.pid,
    backendPid: backend.rows[0].pid,
    startedAt,
    ...result,
  }));
  await pool.end();
`;

async function runWorker(payload: unknown): Promise<WorkerResult> {
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", workerSource],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          GSC_TEST_PGHOST: TEST_CONFIG.host,
          GSC_TEST_PGPORT: String(TEST_CONFIG.port),
          GSC_TEST_PGDATABASE: TEST_CONFIG.database,
          GSC_TEST_PGUSER: TEST_CONFIG.user,
          GSC_WORKER_PAYLOAD: JSON.stringify(payload),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectWorker);
    child.once("close", (code) => {
      if (code !== 0) {
        rejectWorker(new Error(`worker exit ${code}: ${stderr}`));
        return;
      }
      resolveWorker(JSON.parse(stdout) as WorkerResult);
    });
  });
}

async function saveProcessEvidence(
  name: string,
  results: readonly WorkerResult[],
): Promise<void> {
  await writeFile(
    resolve(EVIDENCE_DIRECTORY, name),
    `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      workers: results,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function runWorkersAtDatabaseBarrier(
  evidenceName: string,
  payloads: readonly Record<string, unknown>[],
): Promise<readonly WorkerResult[]> {
  const barrierKey = nextValue(`barrier-${evidenceName}`);
  const barrierClient = await pool.connect();
  await barrierClient.query(
    "SELECT pg_advisory_lock(hashtextextended($1, 0))",
    [barrierKey],
  );
  const workers = payloads.map((payload) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", workerSource],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          GSC_TEST_PGHOST: TEST_CONFIG.host,
          GSC_TEST_PGPORT: String(TEST_CONFIG.port),
          GSC_TEST_PGDATABASE: TEST_CONFIG.database,
          GSC_TEST_PGUSER: TEST_CONFIG.user,
          GSC_WORKER_PAYLOAD: JSON.stringify({ ...payload, barrierKey }),
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const ready = new Promise<{
      nodePid: number;
      backendPid: number;
    }>((resolveReady, rejectReady) => {
      child.once("error", rejectReady);
      child.once("message", (message: unknown) => {
        const value = message as {
          type?: string;
          nodePid?: number;
          backendPid?: number;
        };
        if (
          value.type !== "ready" ||
          typeof value.nodePid !== "number" ||
          typeof value.backendPid !== "number"
        ) {
          rejectReady(new Error("worker did not provide barrier identity"));
          return;
        }
        resolveReady({
          nodePid: value.nodePid,
          backendPid: value.backendPid,
        });
      });
    });
    const result = new Promise<WorkerResult>((resolveResult, rejectResult) => {
      child.once("error", rejectResult);
      child.once("close", (code) => {
        if (code !== 0) {
          rejectResult(new Error(`barrier worker exit ${code}: ${stderr}`));
          return;
        }
        resolveResult(JSON.parse(stdout) as WorkerResult);
      });
    });
    return { child, ready, result };
  });

  try {
    const ready = await Promise.all(workers.map((worker) => worker.ready));
    const releasedToDatabaseBarrierAt = Date.now();
    for (const worker of workers) {
      worker.child.send({ type: "go" });
    }
    let waiters: Array<{
      pid: number;
      waitEventType: string | null;
      waitEvent: string | null;
    }> = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waiting = await pool.query<{
        pid: number;
        waitEventType: string | null;
        waitEvent: string | null;
      }>(
        `SELECT pid, wait_event_type AS "waitEventType", wait_event AS "waitEvent"
           FROM pg_stat_activity
          WHERE pid = ANY($1::integer[])
          ORDER BY pid`,
        [ready.map((worker) => worker.backendPid)],
      );
      waiters = waiting.rows;
      if (
        waiters.length === workers.length &&
        waiters.every((waiter) => waiter.waitEventType === "Lock")
      ) {
        break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.equal(waiters.length, workers.length);
    assert.equal(
      waiters.every((waiter) => waiter.waitEventType === "Lock"),
      true,
    );
    const databaseBarrierReleasedAt = Date.now();
    await barrierClient.query(
      "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
      [barrierKey],
    );
    const results = await Promise.all(workers.map((worker) => worker.result));
    await writeFile(
      resolve(EVIDENCE_DIRECTORY, evidenceName),
      `${JSON.stringify({
        capturedAt: new Date().toISOString(),
        barrierKey,
        ready,
        releasedToDatabaseBarrierAt,
        waiters,
        databaseBarrierReleasedAt,
        workers: results,
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
    return results;
  } finally {
    try {
      await barrierClient.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
        [barrierKey],
      );
    } finally {
      barrierClient.release();
    }
  }
}

before(async () => {
  assert.ok(Number.isInteger(TEST_CONFIG.port) && TEST_CONFIG.port > 0);
  assert.equal(TEST_CONFIG.host, EXPECTED_SOCKET_DIRECTORY);
  assert.equal(TEST_CONFIG.database, "gsc_repository_test");
  assert.equal(TEST_CONFIG.user, "gsc_test_role");
  assert.equal(
    EVIDENCE_DIRECTORY === EXPECTED_EVIDENCE_DIRECTORY ||
      EVIDENCE_DIRECTORY === EXPECTED_REWORK_EVIDENCE_DIRECTORY ||
      EVIDENCE_DIRECTORY === EXPECTED_TASK23_4_EVIDENCE_DIRECTORY ||
      EVIDENCE_DIRECTORY === EXPECTED_TASK23_4_REWORK_EVIDENCE_DIRECTORY ||
      EVIDENCE_DIRECTORY === EXPECTED_TASK23_5_EVIDENCE_DIRECTORY ||
      EVIDENCE_DIRECTORY === EXPECTED_TASK23_5_REWORK_EVIDENCE_DIRECTORY ||
      EVIDENCE_DIRECTORY === EXPECTED_TASK23_6_EVIDENCE_DIRECTORY ||
      EVIDENCE_DIRECTORY === EXPECTED_TASK23_8_EVIDENCE_DIRECTORY,
    true,
  );
  assert.equal(
    SCHEMA_SQL_PATH,
    `${EXPECTED_EVIDENCE_DIRECTORY}/gsc-two-table-schema.sql`,
  );
  const identity = await pool.query<{
    dataDirectory: string;
    listenAddresses: string;
    socketDirectories: string;
    databaseName: string;
    userName: string;
    backendPid: number;
  }>(
    `SELECT current_setting('data_directory') AS "dataDirectory",
            current_setting('listen_addresses') AS "listenAddresses",
            current_setting('unix_socket_directories') AS "socketDirectories",
            current_database() AS "databaseName",
            current_user AS "userName",
            pg_backend_pid() AS "backendPid"`,
  );
  assert.deepEqual(identity.rows[0], {
    dataDirectory: EXPECTED_DATA_DIRECTORY,
    listenAddresses: "",
    socketDirectories: EXPECTED_SOCKET_DIRECTORY,
    databaseName: "gsc_repository_test",
    userName: "gsc_test_role",
    backendPid: identity.rows[0].backendPid,
  });
  await writeFile(
    resolve(EVIDENCE_DIRECTORY, "database-identity.json"),
    `${JSON.stringify(identity.rows[0], null, 2)}\n`,
    { mode: 0o600 },
  );
  const schemaSql = await readFile(SCHEMA_SQL_PATH, "utf8");
  assert.deepEqual(
    [...schemaSql.matchAll(/CREATE TABLE ([a-z_]+)/gu)].map((match) => match[1]),
    ["gsc_connections", "gsc_oauth_flows"],
  );
  await pool.query("DROP TABLE IF EXISTS gsc_oauth_flows CASCADE");
  await pool.query("DROP TABLE IF EXISTS gsc_connections CASCADE");
  await pool.query("DROP TABLE IF EXISTS users CASCADE");
  await pool.query("CREATE TABLE users (id varchar PRIMARY KEY NOT NULL)");
  await pool.query(schemaSql);
});

beforeEach(async () => {
  await pool.query(
    "TRUNCATE TABLE gsc_oauth_flows, gsc_connections, users CASCADE",
  );
});

after(async () => {
  await pool.end();
});

test("schema enforces one unpredictable connection per user and required constraints", async () => {
  await insertUser("member-a");
  await insertUser("member-b");
  const first = await repository.ensureConnection({
    userId: "member-a",
    googleClientId: "gsc-client",
  });
  const same = await repository.ensureConnection({
    userId: "member-a",
    googleClientId: "gsc-client",
  });
  const second = await repository.ensureConnection({
    userId: "member-b",
    googleClientId: "gsc-client",
  });

  assert.equal(first.connectionId, same.connectionId);
  assert.notEqual(first.connectionId, second.connectionId);
  assert.match(first.connectionId, /^[0-9a-f-]{36}$/u);
  await assertGenericRejection(() =>
    repository.ensureConnection({
      userId: "member-a",
      googleClientId: "other-client",
    }),
  );

  const constraints = await pool.query<{ name: string }>(
    `SELECT conname AS name
       FROM pg_constraint
      WHERE conrelid IN ('gsc_connections'::regclass, 'gsc_oauth_flows'::regclass)
      ORDER BY conname`,
  );
  const indexes = await pool.query<{ indexname: string }>(
    `SELECT indexname
       FROM pg_indexes
      WHERE tablename IN ('gsc_connections', 'gsc_oauth_flows')
      ORDER BY indexname`,
  );
  assert.ok(
    constraints.rows.some(
      (row) => row.name === "gsc_oauth_flows_connection_owner_fk",
    ),
  );
  assert.ok(
    indexes.rows.some(
      (row) => row.indexname === "gsc_connections_active_google_subject_idx",
    ),
  );
  assert.ok(
    indexes.rows.some(
      (row) => row.indexname === "gsc_oauth_flows_state_hash_idx",
    ),
  );
});

test("owner, connection, generation, and status are all required before credential access", async () => {
  await insertUser("member-a");
  const memberA = await repository.ensureConnection({
    userId: "member-a",
    googleClientId: "gsc-client",
  });
  const { active: memberB } = await activateConnection(
    "member-b",
    "gsc-client",
    "subject-b",
  );
  const sensitive = [
    "synthetic-refresh-member-b",
    "member-b@example.test",
    "subject-b",
  ];

  const attempts = [
    () =>
      repository.getActiveCredential({
        userId: memberA.userId,
        connectionId: memberB.connectionId,
        generation: memberB.generation,
      }),
    () =>
      repository.getActiveCredential({
        userId: "member-a",
        connectionId: "00000000-0000-4000-8000-000000000000",
        generation: 0,
      }),
    () =>
      repository.getActiveCredential({
        userId: memberB.userId,
        connectionId: memberB.connectionId,
        generation: memberB.generation + 1,
      }),
  ];
  for (const attempt of attempts) {
    await assertGenericRejection(attempt, sensitive);
  }
  const own = await repository.getActiveCredential({
    userId: memberB.userId,
    connectionId: memberB.connectionId,
    generation: memberB.generation,
  });
  assert.equal(own.userId, "member-b");
  assert.equal(own.status, "active");
});

test("OAuth state is owner and session bound, atomically claimed, and verifier is cleared", async () => {
  await insertUser("member-a");
  await insertUser("member-b");
  const connection = await repository.ensureConnection({
    userId: "member-a",
    googleClientId: "gsc-client",
  });
  const pending = await preparePendingFlow(connection, "claim");

  await assertGenericRejection(() =>
    repository.acquireOAuthProcessing({
      userId: "member-b",
      connectionId: connection.connectionId,
      generation: connection.generation,
      googleClientId: connection.googleClientId,
      stateHash: pending.stateHash,
      sessionProofHash: pending.sessionProofHash,
    }),
  );
  await assertGenericRejection(() =>
    repository.acquireOAuthProcessing({
      userId: connection.userId,
      connectionId: connection.connectionId,
      generation: connection.generation,
      googleClientId: connection.googleClientId,
      stateHash: pending.stateHash,
      sessionProofHash: hash("browser_session", "wrong-session"),
    }),
  );
  const claimed = await repository.acquireOAuthProcessing({
    userId: connection.userId,
    connectionId: connection.connectionId,
    generation: connection.generation,
    googleClientId: connection.googleClientId,
    stateHash: pending.stateHash,
    sessionProofHash: pending.sessionProofHash,
  });
  assert.deepEqual(claimed.encryptedPkceVerifier, pending.encryptedPkceVerifier);
  await assertGenericRejection(() =>
    repository.acquireOAuthProcessing({
      userId: connection.userId,
      connectionId: connection.connectionId,
      generation: connection.generation,
      googleClientId: connection.googleClientId,
      stateHash: pending.stateHash,
      sessionProofHash: pending.sessionProofHash,
    }),
  );
  const stored = await pool.query<{
    status: string;
    encryptedPkceVerifier: unknown;
  }>(
    `SELECT status, encrypted_pkce_verifier AS "encryptedPkceVerifier"
       FROM gsc_oauth_flows WHERE flow_id = $1`,
    [claimed.flowId],
  );
  assert.equal(stored.rows[0].status, "processing");
  assert.equal(stored.rows[0].encryptedPkceVerifier, null);
});

test("expired, cancelled, and replaced flows cannot claim or revive a connection", async () => {
  await insertUser("member-a");
  const connection = await repository.ensureConnection({
    userId: "member-a",
    googleClientId: "gsc-client",
  });
  const expired = await preparePendingFlow(connection, "expired");
  await pool.query(
    `UPDATE gsc_oauth_flows
        SET created_at = CURRENT_TIMESTAMP - interval '11 minutes',
            updated_at = CURRENT_TIMESTAMP - interval '11 minutes',
            expires_at = CURRENT_TIMESTAMP - interval '1 minute'
      WHERE flow_id = $1`,
    [expired.intent.flowId],
  );
  await repository.getConnectionState({
    userId: connection.userId,
    connectionId: connection.connectionId,
    generation: connection.generation,
    status: "disconnected",
  });
  const expiredRow = await pool.query<{
    status: string;
    verifier: unknown;
  }>(
    `SELECT status, encrypted_pkce_verifier AS verifier
       FROM gsc_oauth_flows WHERE flow_id = $1`,
    [expired.intent.flowId],
  );
  assert.deepEqual(expiredRow.rows[0], { status: "cancelled", verifier: null });
  await assertGenericRejection(() =>
    repository.acquireOAuthProcessing({
      userId: connection.userId,
      connectionId: connection.connectionId,
      generation: connection.generation,
      googleClientId: connection.googleClientId,
      stateHash: expired.stateHash,
      sessionProofHash: expired.sessionProofHash,
    }),
  );

  const cancelled = await preparePendingFlow(connection, "cancelled");
  await repository.cancelOAuthFlow({
    userId: connection.userId,
    connectionId: connection.connectionId,
    generation: connection.generation,
    flowId: cancelled.intent.flowId,
  });
  await assertGenericRejection(() =>
    repository.acquireOAuthProcessing({
      userId: connection.userId,
      connectionId: connection.connectionId,
      generation: connection.generation,
      googleClientId: connection.googleClientId,
      stateHash: cancelled.stateHash,
      sessionProofHash: cancelled.sessionProofHash,
    }),
  );

  const oldProcessing = await prepareProcessingFlow(connection, "old");
  await repository.beginConnectionIntent({
    userId: connection.userId,
    connectionId: connection.connectionId,
    generation: connection.generation,
    googleClientId: connection.googleClientId,
    ticketHash: hash("ticket", "replacement"),
  });
  await assertGenericRejection(() =>
    repository.completeOAuthBinding({
      userId: connection.userId,
      connectionId: connection.connectionId,
      generation: connection.generation,
      flowId: oldProcessing.claimed.flowId,
      googleClientId: connection.googleClientId,
      googleSubjectHash: subjectHash("gsc-client", "old-subject"),
      credentialEnvelope: credentialEnvelope(
        connection,
        "old-subject",
        "old",
      ),
    }),
  );
});

test("ensureConnection clears this member expired verifier and preserves another member expired verifier", async () => {
  const fixture = await setupExpiredMembersAAndB("cleanup-ensure");
  const ensured = await repository.ensureConnection({
    userId: fixture.connectionA.userId,
    googleClientId: fixture.connectionA.googleClientId,
  });
  assert.equal(ensured.connectionId, fixture.connectionA.connectionId);
  await assertExpiredAIsClearedAndExpiredBIsPreserved(fixture);
});

test("begin rejection cannot roll back expired verifier cleanup or touch another member", async () => {
  const fixture = await setupExpiredMembersAAndB("cleanup-begin");
  await assertGenericRejection(() =>
    repository.beginConnectionIntent({
      userId: fixture.connectionA.userId,
      connectionId: fixture.connectionA.connectionId,
      generation: fixture.connectionA.generation,
      googleClientId: "wrong-client",
      ticketHash: hash("ticket", "cleanup-begin-rejected"),
    }),
  );
  await assertExpiredAIsClearedAndExpiredBIsPreserved(fixture);
});

test("completion rejection cannot roll back expired verifier cleanup or touch another member", async () => {
  const fixture = await setupExpiredMembersAAndB("cleanup-complete");
  await assertGenericRejection(() =>
    repository.completeOAuthBinding({
      userId: fixture.connectionA.userId,
      connectionId: fixture.connectionA.connectionId,
      generation: fixture.connectionA.generation,
      flowId: "00000000-0000-4000-8000-000000000000",
      googleClientId: fixture.connectionA.googleClientId,
      googleSubjectHash: subjectHash("gsc-client", "subject-a"),
      credentialEnvelope: credentialEnvelope(
        fixture.connectionA,
        "subject-a",
        "cleanup-complete",
      ),
    }),
  );
  await assertExpiredAIsClearedAndExpiredBIsPreserved(fixture);
});

test("disconnect rejection cannot roll back expired verifier cleanup or touch another member", async () => {
  const fixture = await setupExpiredMembersAAndB("cleanup-disconnect");
  await assertGenericRejection(() =>
    repository.disconnectConnection({
      userId: fixture.connectionA.userId,
      connectionId: fixture.connectionA.connectionId,
      generation: fixture.connectionA.generation,
    }),
  );
  await assertExpiredAIsClearedAndExpiredBIsPreserved(fixture);
});

test("two Node processes can claim one state only once on different PostgreSQL backends", async () => {
  await insertUser("member-a");
  const connection = await repository.ensureConnection({
    userId: "member-a",
    googleClientId: "gsc-client",
  });
  const pending = await preparePendingFlow(connection, "multi-state");
  const payload = {
    kind: "acquire",
    input: {
      userId: connection.userId,
      connectionId: connection.connectionId,
      generation: connection.generation,
      googleClientId: connection.googleClientId,
      stateHash: pending.stateHash,
      sessionProofHash: pending.sessionProofHash,
    },
  };
  const results = await runWorkersAtDatabaseBarrier(
    "multiprocess-state-claim.json",
    [payload, payload],
  );
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok).length, 1);
  assert.equal(results.find((result) => !result.ok)?.code, "GSC_REPOSITORY_REJECTED");
  assert.notEqual(results[0].nodePid, results[1].nodePid);
  assert.notEqual(results[0].backendPid, results[1].backendPid);
});

test("two Node processes can complete one member flow only once without overwriting the winner", async () => {
  await insertUser("member-a");
  const connection = await repository.ensureConnection({
    userId: "member-a",
    googleClientId: "gsc-client",
  });
  const flow = await prepareProcessingFlow(connection, "same-member-complete");
  const completionInput = {
    userId: connection.userId,
    connectionId: connection.connectionId,
    generation: connection.generation,
    flowId: flow.claimed.flowId,
    googleClientId: connection.googleClientId,
    googleSubjectHash: subjectHash("gsc-client", "subject-a"),
  };
  const results = await runWorkersAtDatabaseBarrier(
    "multiprocess-same-member-completion.json",
    [{
      kind: "complete",
      marker: "completion-one",
      input: {
        ...completionInput,
        credentialEnvelope: credentialEnvelope(
          connection,
          "subject-a",
          "completion-one",
        ),
      },
    }, {
      kind: "complete",
      marker: "completion-two",
      input: {
        ...completionInput,
        credentialEnvelope: credentialEnvelope(
          connection,
          "subject-a",
          "completion-two",
        ),
      },
    }],
  );
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok).length, 1);
  assert.notEqual(results[0].nodePid, results[1].nodePid);
  assert.notEqual(results[0].backendPid, results[1].backendPid);
  const winner = results.find((result) => result.ok);
  assert.ok(winner?.marker);
  const stored = await repository.getActiveCredential({
    userId: connection.userId,
    connectionId: connection.connectionId,
    generation: connection.generation,
  });
  const plaintext = credentialService.decryptCredentialEnvelope(
    {
      userId: stored.userId,
      connectionId: stored.connectionId,
      googleClientId: stored.googleClientId,
      generation: stored.generation,
      formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
    },
    stored.credentialEnvelope,
  );
  assert.equal(plaintext.refreshToken, `synthetic-refresh-${winner.marker}`);
});

test("PostgreSQL unique constraint permits one active owner for a Google subject", async () => {
  await insertUser("member-a");
  await insertUser("member-b");
  const connectionA = await repository.ensureConnection({
    userId: "member-a",
    googleClientId: "gsc-client",
  });
  const connectionB = await repository.ensureConnection({
    userId: "member-b",
    googleClientId: "gsc-client",
  });
  const flowA = await prepareProcessingFlow(connectionA, "subject-a");
  const flowB = await prepareProcessingFlow(connectionB, "subject-b");
  const sharedSubjectHash = subjectHash("gsc-client", "shared-subject");
  const results = await runWorkersAtDatabaseBarrier(
    "multiprocess-subject-binding.json",
    [{
      kind: "complete",
      input: {
        userId: connectionA.userId,
        connectionId: connectionA.connectionId,
        generation: connectionA.generation,
        flowId: flowA.claimed.flowId,
        googleClientId: connectionA.googleClientId,
        googleSubjectHash: sharedSubjectHash,
        credentialEnvelope: credentialEnvelope(
          connectionA,
          "shared-subject",
          "member-a",
        ),
      },
    }, {
      kind: "complete",
      input: {
        userId: connectionB.userId,
        connectionId: connectionB.connectionId,
        generation: connectionB.generation,
        flowId: flowB.claimed.flowId,
        googleClientId: connectionB.googleClientId,
        googleSubjectHash: sharedSubjectHash,
        credentialEnvelope: credentialEnvelope(
          connectionB,
          "shared-subject",
          "member-b",
        ),
      },
    }],
  );
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok).length, 1);
  assert.notEqual(results[0].nodePid, results[1].nodePid);
  assert.notEqual(results[0].backendPid, results[1].backendPid);
  const active = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM gsc_connections WHERE status = 'active'",
  );
  assert.equal(active.rows[0].count, "1");
});

test("reauthorization keeps the original subject bound until explicit disconnect", async () => {
  const { active: connectionA } = await activateConnection(
    "member-a",
    "gsc-client",
    "subject-a",
  );
  await repository.markReauthorizationRequired({
    userId: connectionA.userId,
    connectionId: connectionA.connectionId,
    generation: connectionA.generation,
  });

  await insertUser("member-b");
  const connectionB = await repository.ensureConnection({
    userId: "member-b",
    googleClientId: "gsc-client",
  });
  const flowB = await prepareProcessingFlow(connectionB, "member-b");
  await assertGenericRejection(() =>
    repository.completeOAuthBinding({
      userId: connectionB.userId,
      connectionId: connectionB.connectionId,
      generation: connectionB.generation,
      flowId: flowB.claimed.flowId,
      googleClientId: connectionB.googleClientId,
      googleSubjectHash: subjectHash("gsc-client", "subject-a"),
      credentialEnvelope: credentialEnvelope(
        connectionB,
        "subject-a",
        "member-b",
      ),
    }),
  );

  const reauthFlow = await prepareProcessingFlow(connectionA, "reauth");
  await assertGenericRejection(() =>
    repository.completeOAuthBinding({
      userId: connectionA.userId,
      connectionId: connectionA.connectionId,
      generation: connectionA.generation,
      flowId: reauthFlow.claimed.flowId,
      googleClientId: connectionA.googleClientId,
      googleSubjectHash: subjectHash("gsc-client", "replacement-subject"),
      credentialEnvelope: credentialEnvelope(
        connectionA,
        "replacement-subject",
        "replacement",
      ),
    }),
  );
  const restored = await repository.completeOAuthBinding({
    userId: connectionA.userId,
    connectionId: connectionA.connectionId,
    generation: connectionA.generation,
    flowId: reauthFlow.claimed.flowId,
    googleClientId: connectionA.googleClientId,
    googleSubjectHash: subjectHash("gsc-client", "subject-a"),
    credentialEnvelope: credentialEnvelope(
      connectionA,
      "subject-a",
      "reauthorized",
    ),
  });
  assert.equal(restored.status, "active");
});

test("disconnection during first authorization invalidates the old callback and generation", async () => {
  await insertUser("member-a");
  const connection = await repository.ensureConnection({
    userId: "member-a",
    googleClientId: "gsc-client",
  });
  const flow = await prepareProcessingFlow(connection, "disconnect-pending");
  const disconnected = await repository.disconnectConnection({
    userId: connection.userId,
    connectionId: connection.connectionId,
    generation: connection.generation,
  });
  assert.equal(disconnected.previousGeneration, 0);
  assert.equal(disconnected.generation, 1);
  assert.equal(disconnected.credentialEnvelope, null);
  await assertGenericRejection(() =>
    repository.completeOAuthBinding({
      userId: connection.userId,
      connectionId: connection.connectionId,
      generation: connection.generation,
      flowId: flow.claimed.flowId,
      googleClientId: connection.googleClientId,
      googleSubjectHash: subjectHash("gsc-client", "late-subject"),
      credentialEnvelope: credentialEnvelope(
        connection,
        "late-subject",
        "late",
      ),
    }),
  );
  assert.equal(
    await repository.isResultEligible({
      userId: connection.userId,
      connectionId: connection.connectionId,
      generation: connection.generation,
    }),
    false,
  );
  const row = await pool.query<{
    status: string;
    verifier: unknown;
  }>(
    `SELECT status, encrypted_pkce_verifier AS verifier
       FROM gsc_oauth_flows WHERE flow_id = $1`,
    [flow.claimed.flowId],
  );
  assert.deepEqual(row.rows[0], { status: "cancelled", verifier: null });
});

test("database advisory lock serializes processes and stale refresh cannot write or return", async () => {
  const { active: connectionA } = await activateConnection(
    "member-a",
    "gsc-client",
    "subject-a",
  );
  const { active: connectionB } = await activateConnection(
    "member-b",
    "gsc-client",
    "subject-b",
  );
  const refreshInput = {
    userId: connectionA.userId,
    connectionId: connectionA.connectionId,
    generation: connectionA.generation,
  };
  const results = await Promise.all([
    runWorker({
      kind: "refresh",
      input: refreshInput,
      holdMilliseconds: 250,
      credentialEnvelope: credentialEnvelope(
        connectionA,
        "subject-a",
        "refresh-one",
      ),
    }),
    runWorker({
      kind: "refresh",
      input: refreshInput,
      holdMilliseconds: 250,
      credentialEnvelope: credentialEnvelope(
        connectionA,
        "subject-a",
        "refresh-two",
      ),
    }),
  ]);
  assert.equal(results.every((result) => result.ok), true);
  assert.notEqual(results[0].nodePid, results[1].nodePid);
  assert.notEqual(results[0].backendPid, results[1].backendPid);
  const ordered = [...results].sort(
    (left, right) => left.enteredAt! - right.enteredAt!,
  );
  assert.ok(ordered[1].enteredAt! >= ordered[0].finishedAt!);
  await saveProcessEvidence("multiprocess-refresh-lock.json", results);

  let allowRefreshToFinish!: () => void;
  let signalRefreshEntered!: () => void;
  const refreshEntered = new Promise<void>((resolveEntered) => {
    signalRefreshEntered = resolveEntered;
  });
  const finishRefresh = new Promise<void>((resolveFinish) => {
    allowRefreshToFinish = resolveFinish;
  });
  const staleRefresh = repository.withRefreshLock(
    refreshInput,
    async (session) => {
      signalRefreshEntered();
      await finishRefresh;
      await session.replaceCredentialEnvelope(
        credentialEnvelope(connectionA, "subject-a", "stale"),
      );
      return "stale-result";
    },
  );
  await refreshEntered;
  const disconnected = await repository.disconnectConnection(refreshInput);
  allowRefreshToFinish();
  await assertGenericRejection(() => staleRefresh);
  assert.equal(disconnected.generation, connectionA.generation + 1);
  assert.equal(
    await repository.isResultEligible(refreshInput),
    false,
  );
  assert.equal(
    await repository.isResultEligible({
      userId: connectionB.userId,
      connectionId: connectionB.connectionId,
      generation: connectionB.generation,
    }),
    true,
  );
});

test("different members can refresh concurrently and retain owner-bound envelopes", async () => {
  const { active: connectionA } = await activateConnection(
    "member-a",
    "gsc-client",
    "subject-a",
  );
  const { active: connectionB } = await activateConnection(
    "member-b",
    "gsc-client",
    "subject-b",
  );
  const results = await runWorkersAtDatabaseBarrier(
    "multiprocess-distinct-member-refresh.json",
    [{
      kind: "refresh",
      input: {
        userId: connectionA.userId,
        connectionId: connectionA.connectionId,
        generation: connectionA.generation,
      },
      holdMilliseconds: 250,
      credentialEnvelope: credentialEnvelope(
        connectionA,
        "subject-a",
        "parallel-member-a",
      ),
    }, {
      kind: "refresh",
      input: {
        userId: connectionB.userId,
        connectionId: connectionB.connectionId,
        generation: connectionB.generation,
      },
      holdMilliseconds: 250,
      credentialEnvelope: credentialEnvelope(
        connectionB,
        "subject-b",
        "parallel-member-b",
      ),
    }],
  );
  assert.equal(results.every((result) => result.ok), true);
  assert.notEqual(results[0].nodePid, results[1].nodePid);
  assert.notEqual(results[0].backendPid, results[1].backendPid);
  assert.ok(
    Math.max(...results.map((result) => result.enteredAt!)) <
      Math.min(...results.map((result) => result.finishedAt!)),
  );
  const latestA = await repository.getActiveCredential({
    userId: connectionA.userId,
    connectionId: connectionA.connectionId,
    generation: connectionA.generation,
  });
  const latestB = await repository.getActiveCredential({
    userId: connectionB.userId,
    connectionId: connectionB.connectionId,
    generation: connectionB.generation,
  });
  const bindingA = {
    userId: latestA.userId,
    connectionId: latestA.connectionId,
    googleClientId: latestA.googleClientId,
    generation: latestA.generation,
    formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
  } as const;
  const bindingB = {
    userId: latestB.userId,
    connectionId: latestB.connectionId,
    googleClientId: latestB.googleClientId,
    generation: latestB.generation,
    formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
  } as const;
  assert.equal(
    credentialService.decryptCredentialEnvelope(
      bindingA,
      latestA.credentialEnvelope,
    ).refreshToken,
    "synthetic-refresh-parallel-member-a",
  );
  assert.equal(
    credentialService.decryptCredentialEnvelope(
      bindingB,
      latestB.credentialEnvelope,
    ).refreshToken,
    "synthetic-refresh-parallel-member-b",
  );
  assert.throws(() =>
    credentialService.decryptCredentialEnvelope(
      bindingA,
      latestB.credentialEnvelope,
    ),
  );
  assert.throws(() =>
    credentialService.decryptCredentialEnvelope(
      bindingB,
      latestA.credentialEnvelope,
    ),
  );
  await writeFile(
    resolve(EVIDENCE_DIRECTORY, "distinct-member-refresh-readback.json"),
    `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      workers: results,
      memberAOwnEnvelopeDecrypted: true,
      memberBOwnEnvelopeDecrypted: true,
      memberAadCrossUseRejected: true,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
});

test("three invalid grants use their held PostgreSQL refresh sessions to mark every owner for reauthorization", async () => {
  await runInvalidRefreshPoolScenario({
    evidenceName: "invalid-grant-pool-saturation.json",
    response: { status: 400, body: { error: "invalid_grant" } },
  });
});

test("three reduced-scope refreshes use their held PostgreSQL sessions without leaving an active owner", async () => {
  await runInvalidRefreshPoolScenario({
    evidenceName: "reduced-scope-pool-saturation.json",
    response: {
      status: 200,
      body: {
        access_token: "synthetic-short-lived-access-token",
        scope: "openid email",
      },
    },
  });
});
