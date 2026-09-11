import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { GscEncryptedEnvelope } from "./gscCredentialService";

export const GSC_OAUTH_REDIRECT_URI =
  "https://eccal.thinkwithblack.com/api/gsc/oauth/callback";

export type GscConnectionStatus =
  | "disconnected"
  | "active"
  | "reauthorization_required";

export type GscConnectionState = Readonly<{
  userId: string;
  connectionId: string;
  googleClientId: string;
  status: GscConnectionStatus;
  generation: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type GscActiveCredentialRecord = GscConnectionState &
  Readonly<{
    status: "active";
    googleSubjectHash: string;
    credentialEnvelope: GscEncryptedEnvelope;
  }>;

export type GscConnectionIntent = Readonly<{
  flowId: string;
  userId: string;
  connectionId: string;
  expectedGeneration: number;
  ticketHash: string;
  expiresAt: Date;
}>;

export type GscClaimedOAuthFlow = Readonly<{
  flowId: string;
  userId: string;
  connectionId: string;
  expectedGeneration: number;
  googleClientId: string;
  redirectUri: typeof GSC_OAUTH_REDIRECT_URI;
  stateHash: string;
  sessionProofHash: string;
  oidcNonceHash: string;
  encryptedPkceVerifier: GscEncryptedEnvelope;
  expiresAt: Date;
}>;

export type GscDisconnectResult = Readonly<{
  userId: string;
  connectionId: string;
  previousGeneration: number;
  generation: number;
  credentialEnvelope: GscEncryptedEnvelope | null;
}>;

export type GscRefreshSession = Readonly<{
  connection: GscActiveCredentialRecord;
  replaceCredentialEnvelope: (
    credentialEnvelope: GscEncryptedEnvelope,
  ) => Promise<GscActiveCredentialRecord>;
  markReauthorizationRequired: () => Promise<GscConnectionState>;
}>;

export type GscRepositoryPool = Pick<Pool, "connect" | "query">;

export type GscRepository = Readonly<{
  ensureConnection: (input: {
    userId: string;
    googleClientId: string;
  }) => Promise<GscConnectionState>;
  getConnectionState: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    status: GscConnectionStatus;
  }) => Promise<GscConnectionState>;
  getActiveCredential: (input: {
    userId: string;
    connectionId: string;
    generation: number;
  }) => Promise<GscActiveCredentialRecord>;
  beginConnectionIntent: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    googleClientId: string;
    ticketHash: string;
  }) => Promise<GscConnectionIntent>;
  startOAuthFromIntent: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    googleClientId: string;
    ticketHash: string;
    stateHash: string;
    sessionProofHash: string;
    oidcNonceHash: string;
    encryptedPkceVerifier: GscEncryptedEnvelope;
  }) => Promise<void>;
  acquireOAuthProcessing: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    googleClientId: string;
    stateHash: string;
    sessionProofHash: string;
  }) => Promise<GscClaimedOAuthFlow>;
  completeOAuthBinding: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    flowId: string;
    googleClientId: string;
    googleSubjectHash: string;
    credentialEnvelope: GscEncryptedEnvelope;
  }) => Promise<GscActiveCredentialRecord>;
  cancelOAuthFlow: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    flowId: string;
  }) => Promise<void>;
  markReauthorizationRequired: (input: {
    userId: string;
    connectionId: string;
    generation: number;
  }) => Promise<GscConnectionState>;
  withRefreshLock: <T>(
    input: {
      userId: string;
      connectionId: string;
      generation: number;
    },
    operation: (session: GscRefreshSession) => Promise<T>,
  ) => Promise<T>;
  disconnectConnection: (input: {
    userId: string;
    connectionId: string;
    generation: number;
  }) => Promise<GscDisconnectResult>;
  isResultEligible: (input: {
    userId: string;
    connectionId: string;
    generation: number;
  }) => Promise<boolean>;
}>;

export class GscRepositoryError extends Error {
  readonly code = "GSC_REPOSITORY_REJECTED" as const;

  constructor() {
    super("GSC repository operation rejected");
    this.name = "GscRepositoryError";
  }
}

type SqlClient = Pick<PoolClient, "query">;

type ConnectionRow = QueryResultRow & {
  userId: string;
  connectionId: string;
  googleClientId: string;
  googleSubjectHash: string | null;
  credentialEnvelope: GscEncryptedEnvelope | null;
  status: GscConnectionStatus;
  generation: number;
  createdAt: Date;
  updatedAt: Date;
};

type IntentRow = QueryResultRow & {
  flowId: string;
  userId: string;
  connectionId: string;
  expectedGeneration: number;
  ticketHash: string;
  expiresAt: Date;
};

type ClaimedFlowRow = QueryResultRow & {
  flowId: string;
  userId: string;
  connectionId: string;
  expectedGeneration: number;
  googleClientId: string;
  redirectUri: string;
  stateHash: string;
  sessionProofHash: string;
  oidcNonceHash: string;
  encryptedPkceVerifier: GscEncryptedEnvelope;
  expiresAt: Date;
};

const OPAQUE_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CONNECTION_COLUMNS = `
  user_id AS "userId",
  connection_id AS "connectionId",
  google_client_id AS "googleClientId",
  google_subject_hash AS "googleSubjectHash",
  credential_envelope AS "credentialEnvelope",
  status,
  generation,
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

function reject(): never {
  throw new GscRepositoryError();
}

function requireString(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : reject();
}

function requireGeneration(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : reject();
}

function requireHash(value: unknown): string {
  const hash = requireString(value);
  return OPAQUE_HASH_PATTERN.test(hash) ? hash : reject();
}

function requireEnvelope(value: unknown): GscEncryptedEnvelope {
  return value !== null && typeof value === "object"
    ? (value as GscEncryptedEnvelope)
    : reject();
}

function requireStatus(value: unknown): GscConnectionStatus {
  return value === "disconnected" ||
    value === "active" ||
    value === "reauthorization_required"
    ? value
    : reject();
}

function toState(row: ConnectionRow): GscConnectionState {
  return Object.freeze({
    userId: row.userId,
    connectionId: row.connectionId,
    googleClientId: row.googleClientId,
    status: row.status,
    generation: row.generation,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toActiveCredential(row: ConnectionRow): GscActiveCredentialRecord {
  if (
    row.status !== "active" ||
    row.googleSubjectHash === null ||
    row.credentialEnvelope === null
  ) {
    reject();
  }
  return Object.freeze({
    ...toState(row),
    status: "active",
    googleSubjectHash: row.googleSubjectHash,
    credentialEnvelope: row.credentialEnvelope,
  });
}

async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    reject();
  }
}

async function transaction<T>(
  pool: GscRepositoryPool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The public error remains generic even if rollback also fails.
    }
    reject();
  } finally {
    client.release();
  }
}

async function clearExpiredVerifierForUser(
  client: SqlClient,
  userId: string,
): Promise<void> {
  await client.query(
    `UPDATE gsc_oauth_flows
        SET status = 'cancelled',
            encrypted_pkce_verifier = NULL,
            consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND expires_at <= CURRENT_TIMESTAMP
        AND status IN ('intent_pending', 'oauth_pending', 'processing')`,
    [userId],
  );
}

async function selectConnection(
  client: SqlClient,
  input: {
    userId: string;
    connectionId: string;
    generation: number;
    status: GscConnectionStatus;
  },
  forUpdate = false,
): Promise<ConnectionRow> {
  const result = await client.query<ConnectionRow>(
    `SELECT ${CONNECTION_COLUMNS}
       FROM gsc_connections
      WHERE user_id = $1
        AND connection_id = $2
        AND generation = $3
        AND status = $4
      ${forUpdate ? "FOR UPDATE" : ""}`,
    [input.userId, input.connectionId, input.generation, input.status],
  );
  return result.rowCount === 1 ? result.rows[0] : reject();
}

export function createGscRepository(pool: GscRepositoryPool): GscRepository {
  async function ensureConnection(input: {
    userId: string;
    googleClientId: string;
  }): Promise<GscConnectionState> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      const googleClientId = requireString(input.googleClientId);
      await clearExpiredVerifierForUser(pool, userId);
      await pool.query(
        `INSERT INTO gsc_connections (user_id, google_client_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, googleClientId],
      );
      const result = await pool.query<ConnectionRow>(
        `SELECT ${CONNECTION_COLUMNS}
           FROM gsc_connections
          WHERE user_id = $1
            AND google_client_id = $2`,
        [userId, googleClientId],
      );
      return result.rowCount === 1 ? toState(result.rows[0]) : reject();
    });
  }

  async function getConnectionState(input: {
    userId: string;
    connectionId: string;
    generation: number;
    status: GscConnectionStatus;
  }): Promise<GscConnectionState> {
    return guarded(async () => {
      const args = {
        userId: requireString(input.userId),
        connectionId: requireString(input.connectionId),
        generation: requireGeneration(input.generation),
        status: requireStatus(input.status),
      };
      await clearExpiredVerifierForUser(pool, args.userId);
      return toState(await selectConnection(pool, args));
    });
  }

  async function getActiveCredential(input: {
    userId: string;
    connectionId: string;
    generation: number;
  }): Promise<GscActiveCredentialRecord> {
    return guarded(async () => {
      const args = {
        userId: requireString(input.userId),
        connectionId: requireString(input.connectionId),
        generation: requireGeneration(input.generation),
        status: "active" as const,
      };
      await clearExpiredVerifierForUser(pool, args.userId);
      return toActiveCredential(await selectConnection(pool, args));
    });
  }

  async function beginConnectionIntent(input: {
    userId: string;
    connectionId: string;
    generation: number;
    googleClientId: string;
    ticketHash: string;
  }): Promise<GscConnectionIntent> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      return transaction(pool, async (client) => {
        const connectionId = requireString(input.connectionId);
        const generation = requireGeneration(input.generation);
        const googleClientId = requireString(input.googleClientId);
        const ticketHash = requireHash(input.ticketHash);
        const connection = await client.query<ConnectionRow>(
          `SELECT ${CONNECTION_COLUMNS}
             FROM gsc_connections
            WHERE user_id = $1
              AND connection_id = $2
              AND generation = $3
              AND google_client_id = $4
              AND status IN ('disconnected', 'reauthorization_required')
            FOR UPDATE`,
          [userId, connectionId, generation, googleClientId],
        );
        if (connection.rowCount !== 1) reject();
        await client.query(
          `UPDATE gsc_oauth_flows
              SET status = 'cancelled',
                  encrypted_pkce_verifier = NULL,
                  consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP),
                  updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
              AND connection_id = $2
              AND expected_generation = $3
              AND status IN ('intent_pending', 'oauth_pending', 'processing')`,
          [userId, connectionId, generation],
        );
        const created = await client.query<IntentRow>(
          `INSERT INTO gsc_oauth_flows (
             connection_id, user_id, expected_generation, google_client_id,
             redirect_uri, status, ticket_hash, expires_at
           ) VALUES (
             $1, $2, $3, $4, $5, 'intent_pending', $6,
             CURRENT_TIMESTAMP + interval '10 minutes'
           )
           RETURNING flow_id AS "flowId", user_id AS "userId",
             connection_id AS "connectionId",
             expected_generation AS "expectedGeneration",
             ticket_hash AS "ticketHash", expires_at AS "expiresAt"`,
          [
            connectionId,
            userId,
            generation,
            googleClientId,
            GSC_OAUTH_REDIRECT_URI,
            ticketHash,
          ],
        );
        return created.rowCount === 1
          ? Object.freeze(created.rows[0])
          : reject();
      });
    });
  }

  async function startOAuthFromIntent(input: {
    userId: string;
    connectionId: string;
    generation: number;
    googleClientId: string;
    ticketHash: string;
    stateHash: string;
    sessionProofHash: string;
    oidcNonceHash: string;
    encryptedPkceVerifier: GscEncryptedEnvelope;
  }): Promise<void> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      const result = await pool.query(
        `UPDATE gsc_oauth_flows AS flow
            SET status = 'oauth_pending',
                state_hash = $6,
                session_proof_hash = $7,
                oidc_nonce_hash = $8,
                encrypted_pkce_verifier = $9,
                updated_at = CURRENT_TIMESTAMP
           FROM gsc_connections AS connection
          WHERE flow.user_id = $1
            AND flow.connection_id = $2
            AND flow.expected_generation = $3
            AND flow.google_client_id = $4
            AND flow.redirect_uri = $5
            AND flow.ticket_hash = $10
            AND flow.status = 'intent_pending'
            AND flow.expires_at > CURRENT_TIMESTAMP
            AND connection.user_id = flow.user_id
            AND connection.connection_id = flow.connection_id
            AND connection.generation = flow.expected_generation
            AND connection.google_client_id = flow.google_client_id
            AND connection.status IN ('disconnected', 'reauthorization_required')`,
        [
          userId,
          requireString(input.connectionId),
          requireGeneration(input.generation),
          requireString(input.googleClientId),
          GSC_OAUTH_REDIRECT_URI,
          requireHash(input.stateHash),
          requireHash(input.sessionProofHash),
          requireHash(input.oidcNonceHash),
          requireEnvelope(input.encryptedPkceVerifier),
          requireHash(input.ticketHash),
        ],
      );
      if (result.rowCount !== 1) reject();
    });
  }

  async function acquireOAuthProcessing(input: {
    userId: string;
    connectionId: string;
    generation: number;
    googleClientId: string;
    stateHash: string;
    sessionProofHash: string;
  }): Promise<GscClaimedOAuthFlow> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      const result = await pool.query<ClaimedFlowRow>(
        `WITH candidate AS (
           SELECT flow.flow_id, flow.encrypted_pkce_verifier
             FROM gsc_oauth_flows AS flow
             JOIN gsc_connections AS connection
               ON connection.connection_id = flow.connection_id
              AND connection.user_id = flow.user_id
            WHERE flow.user_id = $1
              AND flow.connection_id = $2
              AND flow.expected_generation = $3
              AND flow.google_client_id = $4
              AND flow.redirect_uri = $5
              AND flow.state_hash = $6
              AND flow.session_proof_hash = $7
              AND flow.status = 'oauth_pending'
              AND flow.expires_at > CURRENT_TIMESTAMP
              AND connection.generation = flow.expected_generation
              AND connection.google_client_id = flow.google_client_id
              AND connection.status IN ('disconnected', 'reauthorization_required')
            FOR UPDATE OF flow
         ), claimed AS (
           UPDATE gsc_oauth_flows AS flow
              SET status = 'processing',
                  encrypted_pkce_verifier = NULL,
                  consumed_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
             FROM candidate
            WHERE flow.flow_id = candidate.flow_id
           RETURNING flow.flow_id AS "flowId", flow.user_id AS "userId",
             flow.connection_id AS "connectionId",
             flow.expected_generation AS "expectedGeneration",
             flow.google_client_id AS "googleClientId",
             flow.redirect_uri AS "redirectUri", flow.state_hash AS "stateHash",
             flow.session_proof_hash AS "sessionProofHash",
             flow.oidc_nonce_hash AS "oidcNonceHash",
             candidate.encrypted_pkce_verifier AS "encryptedPkceVerifier",
             flow.expires_at AS "expiresAt"
         )
         SELECT * FROM claimed`,
        [
          userId,
          requireString(input.connectionId),
          requireGeneration(input.generation),
          requireString(input.googleClientId),
          GSC_OAUTH_REDIRECT_URI,
          requireHash(input.stateHash),
          requireHash(input.sessionProofHash),
        ],
      );
      if (result.rowCount !== 1) reject();
      const row = result.rows[0];
      if (row.redirectUri !== GSC_OAUTH_REDIRECT_URI) reject();
      return Object.freeze({
        ...row,
        redirectUri: GSC_OAUTH_REDIRECT_URI,
        encryptedPkceVerifier: requireEnvelope(row.encryptedPkceVerifier),
      });
    });
  }

  async function completeOAuthBinding(input: {
    userId: string;
    connectionId: string;
    generation: number;
    flowId: string;
    googleClientId: string;
    googleSubjectHash: string;
    credentialEnvelope: GscEncryptedEnvelope;
  }): Promise<GscActiveCredentialRecord> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      return transaction(pool, async (client) => {
        const connectionId = requireString(input.connectionId);
        const generation = requireGeneration(input.generation);
        const googleClientId = requireString(input.googleClientId);
        const connection = await client.query<ConnectionRow>(
          `SELECT ${CONNECTION_COLUMNS}
             FROM gsc_connections
            WHERE user_id = $1
              AND connection_id = $2
              AND generation = $3
              AND google_client_id = $4
              AND status IN ('disconnected', 'reauthorization_required')
            FOR UPDATE`,
          [userId, connectionId, generation, googleClientId],
        );
        if (connection.rowCount !== 1) reject();
        const flow = await client.query(
          `SELECT flow_id
             FROM gsc_oauth_flows
            WHERE flow_id = $1
              AND user_id = $2
              AND connection_id = $3
              AND expected_generation = $4
              AND google_client_id = $5
              AND redirect_uri = $6
              AND status = 'processing'
              AND expires_at > CURRENT_TIMESTAMP
            FOR UPDATE`,
          [
            requireString(input.flowId),
            userId,
            connectionId,
            generation,
            googleClientId,
            GSC_OAUTH_REDIRECT_URI,
          ],
        );
        if (flow.rowCount !== 1) reject();
        const updated = await client.query<ConnectionRow>(
          `UPDATE gsc_connections
              SET google_subject_hash = $5,
                  credential_envelope = $6,
                  status = 'active',
                  updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
              AND connection_id = $2
              AND generation = $3
              AND google_client_id = $4
              AND (
                status = 'disconnected'
                OR (
                  status = 'reauthorization_required'
                  AND google_subject_hash = $5
                )
              )
          RETURNING ${CONNECTION_COLUMNS}`,
          [
            userId,
            connectionId,
            generation,
            googleClientId,
            requireHash(input.googleSubjectHash),
            requireEnvelope(input.credentialEnvelope),
          ],
        );
        if (updated.rowCount !== 1) reject();
        const completed = await client.query(
          `UPDATE gsc_oauth_flows
              SET status = 'completed', updated_at = CURRENT_TIMESTAMP
            WHERE flow_id = $1
              AND user_id = $2
              AND connection_id = $3
              AND expected_generation = $4
              AND status = 'processing'`,
          [input.flowId, userId, connectionId, generation],
        );
        if (completed.rowCount !== 1) reject();
        return toActiveCredential(updated.rows[0]);
      });
    });
  }

  async function cancelOAuthFlow(input: {
    userId: string;
    connectionId: string;
    generation: number;
    flowId: string;
  }): Promise<void> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      const result = await pool.query(
        `UPDATE gsc_oauth_flows
            SET status = 'cancelled',
                encrypted_pkce_verifier = NULL,
                consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
          WHERE flow_id = $1
            AND user_id = $2
            AND connection_id = $3
            AND expected_generation = $4
            AND status IN ('intent_pending', 'oauth_pending', 'processing')
            AND expires_at > CURRENT_TIMESTAMP`,
        [
          requireString(input.flowId),
          userId,
          requireString(input.connectionId),
          requireGeneration(input.generation),
        ],
      );
      if (result.rowCount !== 1) reject();
    });
  }

  async function markReauthorizationRequired(input: {
    userId: string;
    connectionId: string;
    generation: number;
  }): Promise<GscConnectionState> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      const result = await pool.query<ConnectionRow>(
        `UPDATE gsc_connections
            SET status = 'reauthorization_required', updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $1
            AND connection_id = $2
            AND generation = $3
            AND status = 'active'
        RETURNING ${CONNECTION_COLUMNS}`,
        [
          userId,
          requireString(input.connectionId),
          requireGeneration(input.generation),
        ],
      );
      return result.rowCount === 1 ? toState(result.rows[0]) : reject();
    });
  }

  async function withRefreshLock<T>(
    input: {
      userId: string;
      connectionId: string;
      generation: number;
    },
    operation: (session: GscRefreshSession) => Promise<T>,
  ): Promise<T> {
    return guarded(async () => {
      if (typeof operation !== "function") reject();
      const userId = requireString(input.userId);
      const connectionId = requireString(input.connectionId);
      const generation = requireGeneration(input.generation);
      const refreshLockKey = JSON.stringify([userId, connectionId]);
      const client = await pool.connect();
      let locked = false;
      try {
        await client.query("SELECT set_config('lock_timeout', '5000ms', false)");
        await client.query(
          "SELECT pg_advisory_lock(hashtextextended($1, 0))",
          [refreshLockKey],
        );
        locked = true;
        await clearExpiredVerifierForUser(client, userId);
        let connection = toActiveCredential(
          await selectConnection(client, {
            userId,
            connectionId,
            generation,
            status: "active",
          }),
        );
        const session: GscRefreshSession = Object.freeze({
          connection,
          replaceCredentialEnvelope: async (credentialEnvelope) => {
            const updated = await client.query<ConnectionRow>(
              `UPDATE gsc_connections
                  SET credential_envelope = $4, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $1
                  AND connection_id = $2
                  AND generation = $3
                  AND status = 'active'
              RETURNING ${CONNECTION_COLUMNS}`,
              [
                userId,
                connectionId,
                generation,
                requireEnvelope(credentialEnvelope),
              ],
            );
            connection = updated.rowCount === 1
              ? toActiveCredential(updated.rows[0])
              : reject();
            return connection;
          },
          markReauthorizationRequired: async () => {
            const updated = await client.query<ConnectionRow>(
              `UPDATE gsc_connections
                  SET status = 'reauthorization_required',
                      updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $1
                  AND connection_id = $2
                  AND generation = $3
                  AND status = 'active'
              RETURNING ${CONNECTION_COLUMNS}`,
              [userId, connectionId, generation],
            );
            return updated.rowCount === 1
              ? toState(updated.rows[0])
              : reject();
          },
        });
        const result = await operation(session);
        await selectConnection(client, {
          userId,
          connectionId,
          generation,
          status: "active",
        });
        return result;
      } finally {
        if (locked) {
          try {
            await client.query(
              "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
              [refreshLockKey],
            );
          } catch {
            client.release(true);
            reject();
          }
        }
        client.release();
      }
    });
  }

  async function disconnectConnection(input: {
    userId: string;
    connectionId: string;
    generation: number;
  }): Promise<GscDisconnectResult> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      return transaction(pool, async (client) => {
        const connectionId = requireString(input.connectionId);
        const generation = requireGeneration(input.generation);
        const current = await client.query<ConnectionRow>(
          `SELECT ${CONNECTION_COLUMNS}
             FROM gsc_connections
            WHERE user_id = $1
              AND connection_id = $2
              AND generation = $3
            FOR UPDATE`,
          [userId, connectionId, generation],
        );
        if (current.rowCount !== 1) reject();
        if (current.rows[0].status === "disconnected") {
          const pendingFlow = await client.query(
            `SELECT 1
               FROM gsc_oauth_flows
              WHERE user_id = $1
                AND connection_id = $2
                AND expected_generation = $3
                AND status IN ('intent_pending', 'oauth_pending', 'processing')
              LIMIT 1`,
            [userId, connectionId, generation],
          );
          if (pendingFlow.rowCount !== 1) reject();
        } else if (
          current.rows[0].status !== "active" &&
          current.rows[0].status !== "reauthorization_required"
        ) {
          reject();
        }
        const updated = await client.query<ConnectionRow>(
          `UPDATE gsc_connections
              SET status = 'disconnected',
                  generation = generation + 1,
                  google_subject_hash = NULL,
                  credential_envelope = NULL,
                  updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
              AND connection_id = $2
              AND generation = $3
          RETURNING ${CONNECTION_COLUMNS}`,
          [userId, connectionId, generation],
        );
        if (updated.rowCount !== 1) reject();
        await client.query(
          `UPDATE gsc_oauth_flows
              SET status = 'cancelled',
                  encrypted_pkce_verifier = NULL,
                  consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP),
                  updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
              AND connection_id = $2
              AND expected_generation = $3
              AND status IN ('intent_pending', 'oauth_pending', 'processing')`,
          [userId, connectionId, generation],
        );
        return Object.freeze({
          userId,
          connectionId,
          previousGeneration: generation,
          generation: updated.rows[0].generation,
          credentialEnvelope: current.rows[0].credentialEnvelope,
        });
      });
    });
  }

  async function isResultEligible(input: {
    userId: string;
    connectionId: string;
    generation: number;
  }): Promise<boolean> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      const result = await pool.query(
        `SELECT 1
           FROM gsc_connections
          WHERE user_id = $1
            AND connection_id = $2
            AND generation = $3
            AND status = 'active'`,
        [
          userId,
          requireString(input.connectionId),
          requireGeneration(input.generation),
        ],
      );
      return result.rowCount === 1;
    });
  }

  return Object.freeze({
    ensureConnection,
    getConnectionState,
    getActiveCredential,
    beginConnectionIntent,
    startOAuthFromIntent,
    acquireOAuthProcessing,
    completeOAuthBinding,
    cancelOAuthFlow,
    markReauthorizationRequired,
    withRefreshLock,
    disconnectConnection,
    isResultEligible,
  });
}
