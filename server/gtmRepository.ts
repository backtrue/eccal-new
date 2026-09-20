import type { Pool, PoolClient, QueryResultRow } from "pg";
import { randomUUID } from "node:crypto";
import type { GtmEncryptedEnvelope } from "./gtmCredentialService";

export const GTM_OAUTH_REDIRECT_URI =
  "https://eccal.thinkwithblack.com/api/gtm/oauth/callback";

export type GtmConnectionStatus =
  | "disconnected"
  | "active"
  | "reauthorization_required";

export type GtmConnectionState = Readonly<{
  userId: string;
  connectionId: string;
  googleClientId: string;
  status: GtmConnectionStatus;
  generation: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type GtmActiveCredentialRecord = GtmConnectionState &
  Readonly<{
    status: "active";
    googleSubjectHash: string;
    credentialEnvelope: GtmEncryptedEnvelope;
  }>;

export type GtmConnectionIntent = Readonly<{
  flowId: string;
  userId: string;
  connectionId: string;
  expectedGeneration: number;
  ticketHash: string;
  expiresAt: Date;
}>;

export type GtmClaimedOAuthFlow = Readonly<{
  flowId: string;
  userId: string;
  connectionId: string;
  expectedGeneration: number;
  googleClientId: string;
  redirectUri: typeof GTM_OAUTH_REDIRECT_URI;
  stateHash: string;
  sessionProofHash: string;
  oidcNonceHash: string;
  encryptedPkceVerifier: GtmEncryptedEnvelope;
  expiresAt: Date;
}>;

export type GtmDisconnectResult = Readonly<{
  userId: string;
  connectionId: string;
  previousGeneration: number;
  generation: number;
  credentialEnvelope: GtmEncryptedEnvelope | null;
}>;

export type GtmRefreshSession = Readonly<{
  connection: GtmActiveCredentialRecord;
  replaceCredentialEnvelope: (
    credentialEnvelope: GtmEncryptedEnvelope,
  ) => Promise<GtmActiveCredentialRecord>;
  markReauthorizationRequired: () => Promise<GtmConnectionState>;
}>;

export type GtmRepositoryPool = Pick<Pool, "connect" | "query">;

export type GtmRepository = Readonly<{
  ensureConnection: (input: {
    userId: string;
    googleClientId: string;
  }) => Promise<GtmConnectionState>;
  getConnectionState: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    status: GtmConnectionStatus;
  }) => Promise<GtmConnectionState>;
  getActiveCredential: (input: {
    userId: string;
    connectionId: string;
    generation: number;
  }) => Promise<GtmActiveCredentialRecord>;
  beginConnectionIntent: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    googleClientId: string;
    ticketHash: string;
  }) => Promise<GtmConnectionIntent>;
  startOAuthFromIntent: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    googleClientId: string;
    ticketHash: string;
    stateHash: string;
    sessionProofHash: string;
    oidcNonceHash: string;
    encryptedPkceVerifier: GtmEncryptedEnvelope;
  }) => Promise<void>;
  acquireOAuthProcessing: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    googleClientId: string;
    stateHash: string;
    sessionProofHash: string;
  }) => Promise<GtmClaimedOAuthFlow>;
  completeOAuthBinding: (input: {
    userId: string;
    connectionId: string;
    generation: number;
    flowId: string;
    googleClientId: string;
    googleSubjectHash: string;
    credentialEnvelope: GtmEncryptedEnvelope;
  }) => Promise<GtmActiveCredentialRecord>;
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
  }) => Promise<GtmConnectionState>;
  withRefreshLock: <T>(
    input: {
      userId: string;
      connectionId: string;
      generation: number;
    },
    operation: (session: GtmRefreshSession) => Promise<T>,
  ) => Promise<T>;
  disconnectConnection: (input: {
    userId: string;
    connectionId: string;
    generation: number;
  }) => Promise<GtmDisconnectResult>;
  isResultEligible: (input: {
    userId: string;
    connectionId: string;
    generation: number;
  }) => Promise<boolean>;
}>;

export class GtmRepositoryError extends Error {
  readonly code = "GTM_REPOSITORY_REJECTED" as const;

  constructor() {
    super("GTM repository operation rejected");
    this.name = "GtmRepositoryError";
  }
}

type SqlClient = Pick<PoolClient, "query">;

type ConnectionRow = QueryResultRow & {
  userId: string;
  connectionId: string;
  googleClientId: string;
  googleSubjectHash: string | null;
  credentialEnvelope: GtmEncryptedEnvelope | null;
  status: GtmConnectionStatus;
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
  encryptedPkceVerifier: GtmEncryptedEnvelope;
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
  throw new GtmRepositoryError();
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

function requireEnvelope(value: unknown): GtmEncryptedEnvelope {
  return value !== null && typeof value === "object"
    ? (value as GtmEncryptedEnvelope)
    : reject();
}

function requireStatus(value: unknown): GtmConnectionStatus {
  return value === "disconnected" ||
    value === "active" ||
    value === "reauthorization_required"
    ? value
    : reject();
}

function toState(row: ConnectionRow): GtmConnectionState {
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

function toActiveCredential(row: ConnectionRow): GtmActiveCredentialRecord {
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
  pool: GtmRepositoryPool,
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
    `UPDATE gtm_oauth_flows
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
    status: GtmConnectionStatus;
  },
  forUpdate = false,
): Promise<ConnectionRow> {
  const result = await client.query<ConnectionRow>(
    `SELECT ${CONNECTION_COLUMNS}
       FROM gtm_connections
      WHERE user_id = $1
        AND connection_id = $2
        AND generation = $3
        AND status = $4
      ${forUpdate ? "FOR UPDATE" : ""}`,
    [input.userId, input.connectionId, input.generation, input.status],
  );
  return result.rowCount === 1 ? result.rows[0] : reject();
}

export function createGtmPostgresRepository(pool: GtmRepositoryPool): GtmRepository {
  async function ensureConnection(input: {
    userId: string;
    googleClientId: string;
  }): Promise<GtmConnectionState> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      const googleClientId = requireString(input.googleClientId);
      await clearExpiredVerifierForUser(pool, userId);
      await pool.query(
        `INSERT INTO gtm_connections (user_id, google_client_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, googleClientId],
      );
      const result = await pool.query<ConnectionRow>(
        `SELECT ${CONNECTION_COLUMNS}
           FROM gtm_connections
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
    status: GtmConnectionStatus;
  }): Promise<GtmConnectionState> {
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
  }): Promise<GtmActiveCredentialRecord> {
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
  }): Promise<GtmConnectionIntent> {
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
             FROM gtm_connections
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
          `UPDATE gtm_oauth_flows
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
          `INSERT INTO gtm_oauth_flows (
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
            GTM_OAUTH_REDIRECT_URI,
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
    encryptedPkceVerifier: GtmEncryptedEnvelope;
  }): Promise<void> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      const result = await pool.query(
        `UPDATE gtm_oauth_flows AS flow
            SET status = 'oauth_pending',
                state_hash = $6,
                session_proof_hash = $7,
                oidc_nonce_hash = $8,
                encrypted_pkce_verifier = $9,
                updated_at = CURRENT_TIMESTAMP
           FROM gtm_connections AS connection
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
          GTM_OAUTH_REDIRECT_URI,
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
  }): Promise<GtmClaimedOAuthFlow> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      const result = await pool.query<ClaimedFlowRow>(
        `WITH candidate AS (
           SELECT flow.flow_id, flow.encrypted_pkce_verifier
             FROM gtm_oauth_flows AS flow
             JOIN gtm_connections AS connection
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
           UPDATE gtm_oauth_flows AS flow
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
          GTM_OAUTH_REDIRECT_URI,
          requireHash(input.stateHash),
          requireHash(input.sessionProofHash),
        ],
      );
      if (result.rowCount !== 1) reject();
      const row = result.rows[0];
      if (row.redirectUri !== GTM_OAUTH_REDIRECT_URI) reject();
      return Object.freeze({
        ...row,
        redirectUri: GTM_OAUTH_REDIRECT_URI,
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
    credentialEnvelope: GtmEncryptedEnvelope;
  }): Promise<GtmActiveCredentialRecord> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      return transaction(pool, async (client) => {
        const connectionId = requireString(input.connectionId);
        const generation = requireGeneration(input.generation);
        const googleClientId = requireString(input.googleClientId);
        const connection = await client.query<ConnectionRow>(
          `SELECT ${CONNECTION_COLUMNS}
             FROM gtm_connections
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
             FROM gtm_oauth_flows
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
            GTM_OAUTH_REDIRECT_URI,
          ],
        );
        if (flow.rowCount !== 1) reject();
        const updated = await client.query<ConnectionRow>(
          `UPDATE gtm_connections
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
          `UPDATE gtm_oauth_flows
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
        `UPDATE gtm_oauth_flows
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
  }): Promise<GtmConnectionState> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      const result = await pool.query<ConnectionRow>(
        `UPDATE gtm_connections
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
    operation: (session: GtmRefreshSession) => Promise<T>,
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
        const session: GtmRefreshSession = Object.freeze({
          connection,
          replaceCredentialEnvelope: async (credentialEnvelope) => {
            const updated = await client.query<ConnectionRow>(
              `UPDATE gtm_connections
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
              `UPDATE gtm_connections
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
  }): Promise<GtmDisconnectResult> {
    return guarded(async () => {
      const userId = requireString(input.userId);
      await clearExpiredVerifierForUser(pool, userId);
      return transaction(pool, async (client) => {
        const connectionId = requireString(input.connectionId);
        const generation = requireGeneration(input.generation);
        const current = await client.query<ConnectionRow>(
          `SELECT ${CONNECTION_COLUMNS}
             FROM gtm_connections
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
               FROM gtm_oauth_flows
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
          `UPDATE gtm_connections
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
          `UPDATE gtm_oauth_flows
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
           FROM gtm_connections
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

/**
 * An explicitly injectable in-memory repository for offline tests and local
 * contract harnesses. Production wiring always supplies the PostgreSQL pool.
 */
export function createGtmRepository(pool?: GtmRepositoryPool): GtmRepository {
  if (pool) return createGtmPostgresRepository(pool);
  type Stored = GtmConnectionState & {
    googleSubjectHash?: string;
    credentialEnvelope?: GtmEncryptedEnvelope;
  };
  const connections = new Map<string, Stored>();
  const flows = new Map<string, GtmClaimedOAuthFlow & { ticketHash: string }>();
  const requireConnection = (i: { userId: string; connectionId: string; generation: number }) => {
    const value = connections.get(`${i.userId}:${i.connectionId}`);
    if (!value || value.generation !== i.generation) throw new GtmRepositoryError();
    return value;
  };
  const state = (v: Stored): GtmConnectionState => Object.freeze({ ...v });
  return {
    async ensureConnection({ userId, googleClientId }) {
      let value = Array.from(connections.values()).find(v => v.userId === userId && v.googleClientId === googleClientId);
      if (!value) {
        const now = new Date();
        value = { userId, googleClientId, connectionId: randomUUID(), status: "disconnected", generation: 0, createdAt: now, updatedAt: now };
        connections.set(`${userId}:${value.connectionId}`, value);
      }
      return state(value);
    },
    async getConnectionState(i) {
      const value = requireConnection(i);
      if (value.status !== i.status) throw new GtmRepositoryError();
      return state(value);
    },
    async getActiveCredential(i) {
      const value = requireConnection(i);
      if (value.status !== "active" || !value.googleSubjectHash || !value.credentialEnvelope) throw new GtmRepositoryError();
      return Object.freeze({ ...value, status: "active" as const, googleSubjectHash: value.googleSubjectHash, credentialEnvelope: value.credentialEnvelope });
    },
    async beginConnectionIntent(i) {
      const value = requireConnection(i);
      if (value.googleClientId !== i.googleClientId || !["disconnected", "reauthorization_required"].includes(value.status)) throw new GtmRepositoryError();
      const flowId = randomUUID();
      const flow = { flowId, userId: i.userId, connectionId: i.connectionId, expectedGeneration: i.generation, googleClientId: i.googleClientId, redirectUri: GTM_OAUTH_REDIRECT_URI as typeof GTM_OAUTH_REDIRECT_URI, stateHash: "", sessionProofHash: "", oidcNonceHash: "", encryptedPkceVerifier: null as never, expiresAt: new Date(Date.now() + 600000), ticketHash: i.ticketHash };
      flows.set(flowId, flow);
      return Object.freeze({ flowId, userId: i.userId, connectionId: i.connectionId, expectedGeneration: i.generation, ticketHash: i.ticketHash, expiresAt: flow.expiresAt });
    },
    async startOAuthFromIntent(i) {
      const flow = Array.from(flows.values()).find(v => v.userId === i.userId && v.connectionId === i.connectionId && v.expectedGeneration === i.generation && v.ticketHash === i.ticketHash);
      if (!flow) throw new GtmRepositoryError();
      Object.assign(flow, { stateHash: i.stateHash, sessionProofHash: i.sessionProofHash, oidcNonceHash: i.oidcNonceHash, encryptedPkceVerifier: i.encryptedPkceVerifier });
    },
    async acquireOAuthProcessing(i) {
      const flow = Array.from(flows.values()).find(v => v.userId === i.userId && v.connectionId === i.connectionId && v.expectedGeneration === i.generation && v.stateHash === i.stateHash && v.sessionProofHash === i.sessionProofHash && v.encryptedPkceVerifier);
      if (!flow) throw new GtmRepositoryError();
      flows.delete(flow.flowId);
      return Object.freeze(flow);
    },
    async completeOAuthBinding(i) {
      const value = requireConnection(i);
      if (value.googleClientId !== i.googleClientId || !["disconnected", "reauthorization_required"].includes(value.status)) throw new GtmRepositoryError();
      const next = { ...value, status: "active" as const, googleSubjectHash: i.googleSubjectHash, credentialEnvelope: i.credentialEnvelope, updatedAt: new Date() };
      connections.set(`${i.userId}:${i.connectionId}`, next);
      return Object.freeze({ ...next, status: "active" as const, googleSubjectHash: i.googleSubjectHash, credentialEnvelope: i.credentialEnvelope });
    },
    async cancelOAuthFlow(i) { for (const [id, flow] of Array.from(flows.entries())) if (flow.userId === i.userId && flow.connectionId === i.connectionId && flow.expectedGeneration === i.generation && flow.flowId === i.flowId) flows.delete(id); },
    async markReauthorizationRequired(i) {
      const value = requireConnection(i);
      if (value.status !== "active") throw new GtmRepositoryError();
      const next = { ...value, status: "reauthorization_required" as const, updatedAt: new Date() };
      connections.set(`${i.userId}:${i.connectionId}`, next); return state(next);
    },
    async withRefreshLock(i, operation) {
      const value = await this.getActiveCredential(i);
      let current = value;
      return operation(Object.freeze({
        connection: current,
        replaceCredentialEnvelope: async envelope => {
          const value = requireConnection(i);
          const next = { ...value, credentialEnvelope: envelope, updatedAt: new Date() };
          connections.set(`${i.userId}:${i.connectionId}`, next);
          current = Object.freeze({ ...next, status: "active" as const, googleSubjectHash: next.googleSubjectHash!, credentialEnvelope: envelope });
          return current;
        },
        markReauthorizationRequired: () => this.markReauthorizationRequired(i),
      }));
    },
    async disconnectConnection(i) {
      const value = requireConnection(i);
      const next = { ...value, status: "disconnected" as const, generation: value.generation + 1, googleSubjectHash: undefined, credentialEnvelope: undefined, updatedAt: new Date() };
      connections.set(`${i.userId}:${i.connectionId}`, next);
      return Object.freeze({ userId: i.userId, connectionId: i.connectionId, previousGeneration: i.generation, generation: next.generation, credentialEnvelope: value.credentialEnvelope ?? null });
    },
    async isResultEligible(i) {
      const value = connections.get(`${i.userId}:${i.connectionId}`);
      return value?.status === "active" && value.generation === i.generation;
    },
  };
}
