import { pool } from "./db";

let schemaReady: Promise<void> | null = null;

export function ensureEmailMarketingSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createEmailMarketingSchema();
  }

  return schemaReady;
}

async function createEmailMarketingSchema(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_marketing_preferences (
        user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        status varchar(20) NOT NULL DEFAULT 'pending',
        consent_version varchar(40),
        consented_at timestamp,
        unsubscribed_at timestamp,
        source varchar(30),
        resend_contact_id varchar,
        resend_sync_status varchar(20) NOT NULL DEFAULT 'not_required',
        last_sync_error text,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now(),
        CONSTRAINT email_marketing_preferences_status_check
          CHECK (status IN ('pending', 'subscribed', 'unsubscribed')),
        CONSTRAINT email_marketing_preferences_source_check
          CHECK (source IS NULL OR source IN ('first_login_prompt', 'settings', 'resend_webhook')),
        CONSTRAINT email_marketing_preferences_sync_status_check
          CHECK (resend_sync_status IN ('not_required', 'pending', 'synced', 'failed'))
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_marketing_consent_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status varchar(20) NOT NULL,
        source varchar(30) NOT NULL,
        consent_version varchar(40) NOT NULL,
        external_event_id varchar,
        occurred_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT email_marketing_consent_events_status_check
          CHECK (status IN ('subscribed', 'unsubscribed')),
        CONSTRAINT email_marketing_consent_events_source_check
          CHECK (source IN ('first_login_prompt', 'settings', 'resend_webhook'))
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS email_marketing_consent_events_user_id_idx
      ON email_marketing_consent_events(user_id)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS email_marketing_consent_events_external_event_id_idx
      ON email_marketing_consent_events(external_event_id)
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
