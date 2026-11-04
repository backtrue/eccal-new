CREATE TABLE IF NOT EXISTS voice_quotas (
  user_id varchar PRIMARY KEY REFERENCES users(id),
  granted_seconds integer NOT NULL DEFAULT 300 CHECK (granted_seconds = 300),
  billed_seconds integer NOT NULL DEFAULT 0 CHECK (billed_seconds BETWEEN 0 AND 300)
);

CREATE TABLE IF NOT EXISTS voice_reservations (
  id uuid PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES voice_quotas(user_id),
  operation_id varchar(100) NOT NULL,
  reserved_seconds integer NOT NULL CHECK (reserved_seconds BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  settled_at timestamptz,
  billed_seconds integer,
  remaining_seconds integer,
  events_digest varchar(64),
  CONSTRAINT voice_reservations_operation_key UNIQUE (user_id, operation_id),
  CONSTRAINT voice_reservations_deadline_check CHECK (deadline = created_at + reserved_seconds * interval '1 second'),
  CONSTRAINT voice_reservations_settlement_check CHECK (
    (settled_at IS NULL AND billed_seconds IS NULL AND remaining_seconds IS NULL AND events_digest IS NULL)
    OR
    (settled_at IS NOT NULL AND billed_seconds IS NOT NULL AND billed_seconds BETWEEN 0 AND reserved_seconds
      AND remaining_seconds IS NOT NULL AND remaining_seconds BETWEEN 0 AND 300
      AND events_digest IS NOT NULL AND events_digest ~ '^[a-f0-9]{64}$')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_one_active_reservation_idx ON voice_reservations(user_id) WHERE settled_at IS NULL;
