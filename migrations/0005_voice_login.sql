CREATE TABLE IF NOT EXISTS voice_login_codes (
  code_hash varchar(64) PRIMARY KEY CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  state_hash varchar(64) NOT NULL CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  user_id varchar NOT NULL REFERENCES users(id),
  audience text NOT NULL,
  expires_at timestamptz NOT NULL,
  session_expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at <= session_expires_at)
);
CREATE TABLE IF NOT EXISTS voice_sessions (
  token_hash varchar(64) PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id varchar NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_login_codes_expiry_idx ON voice_login_codes(expires_at);
CREATE INDEX IF NOT EXISTS voice_sessions_expiry_idx ON voice_sessions(expires_at);
