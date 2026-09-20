-- GTM Read v1 persistence. Reviewed offline; do not apply automatically.
-- This migration is intentionally limited to GTM tables and has no Google/API side effects.
CREATE TABLE IF NOT EXISTS gtm_connections (
  connection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_client_id text NOT NULL,
  google_subject_hash text,
  credential_envelope jsonb,
  status varchar(32) NOT NULL DEFAULT 'disconnected',
  generation integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT gtm_connections_generation_check CHECK (generation >= 0),
  CONSTRAINT gtm_connections_status_check CHECK (status IN ('disconnected','active','reauthorization_required')),
  CONSTRAINT gtm_connections_active_material_check CHECK ((status = 'active' AND google_subject_hash IS NOT NULL AND credential_envelope IS NOT NULL) OR status <> 'active'),
  CONSTRAINT gtm_connections_disconnected_material_check CHECK (status <> 'disconnected' OR (google_subject_hash IS NULL AND credential_envelope IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS gtm_connections_user_id_idx ON gtm_connections(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS gtm_connections_connection_user_idx ON gtm_connections(connection_id,user_id);
CREATE UNIQUE INDEX IF NOT EXISTS gtm_connections_active_google_subject_idx ON gtm_connections(google_client_id,google_subject_hash) WHERE google_subject_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS gtm_oauth_flows (
  flow_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expected_generation integer NOT NULL,
  google_client_id text NOT NULL,
  redirect_uri text NOT NULL,
  status varchar(24) NOT NULL,
  ticket_hash text NOT NULL,
  state_hash text,
  session_proof_hash text,
  oidc_nonce_hash text,
  encrypted_pkce_verifier jsonb,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT gtm_oauth_flows_connection_owner_fk FOREIGN KEY (connection_id,user_id) REFERENCES gtm_connections(connection_id,user_id) ON DELETE CASCADE,
  CONSTRAINT gtm_oauth_flows_generation_check CHECK (expected_generation >= 0),
  CONSTRAINT gtm_oauth_flows_status_check CHECK (status IN ('intent_pending','oauth_pending','processing','completed','cancelled')),
  CONSTRAINT gtm_oauth_flows_ticket_hash_check CHECK (ticket_hash ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT gtm_oauth_flows_state_hash_check CHECK (state_hash IS NULL OR state_hash ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT gtm_oauth_flows_session_hash_check CHECK (session_proof_hash IS NULL OR session_proof_hash ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT gtm_oauth_flows_nonce_hash_check CHECK (oidc_nonce_hash IS NULL OR oidc_nonce_hash ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT gtm_oauth_flows_expiry_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
  CONSTRAINT gtm_oauth_flows_material_check CHECK (
    (status = 'intent_pending' AND state_hash IS NULL AND session_proof_hash IS NULL AND oidc_nonce_hash IS NULL AND encrypted_pkce_verifier IS NULL AND consumed_at IS NULL)
    OR (status = 'oauth_pending' AND state_hash IS NOT NULL AND session_proof_hash IS NOT NULL AND oidc_nonce_hash IS NOT NULL AND encrypted_pkce_verifier IS NOT NULL AND consumed_at IS NULL)
    OR (status IN ('processing','completed') AND state_hash IS NOT NULL AND session_proof_hash IS NOT NULL AND oidc_nonce_hash IS NOT NULL AND encrypted_pkce_verifier IS NULL AND consumed_at IS NOT NULL)
    OR (status = 'cancelled' AND encrypted_pkce_verifier IS NULL AND consumed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS gtm_oauth_flows_ticket_hash_idx ON gtm_oauth_flows(ticket_hash);
CREATE UNIQUE INDEX IF NOT EXISTS gtm_oauth_flows_state_hash_idx ON gtm_oauth_flows(state_hash);
CREATE INDEX IF NOT EXISTS gtm_oauth_flows_owner_status_idx ON gtm_oauth_flows(user_id,connection_id,expected_generation,status);