import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  emailMarketingConsentEvents,
  emailMarketingPreferences,
} from "../shared/schema";

test("email marketing preference schema defaults to pending and keeps audit history", () => {
  const preference = getTableConfig(emailMarketingPreferences);
  const events = getTableConfig(emailMarketingConsentEvents);

  assert.equal(preference.name, "email_marketing_preferences");
  assert.deepEqual(
    preference.columns.map((column) => column.name),
    [
      "user_id",
      "status",
      "consent_version",
      "consented_at",
      "unsubscribed_at",
      "source",
      "resend_contact_id",
      "resend_sync_status",
      "last_sync_error",
      "created_at",
      "updated_at",
    ],
  );
  assert.equal(preference.columns[1]?.default, "pending");
  assert.equal(preference.columns[7]?.default, "not_required");
  assert.deepEqual(
    preference.checks.map((constraint) => constraint.name),
    [
      "email_marketing_preferences_status_check",
      "email_marketing_preferences_source_check",
      "email_marketing_preferences_sync_status_check",
    ],
  );

  assert.equal(events.name, "email_marketing_consent_events");
  assert.deepEqual(
    events.indexes.map((index) => index.config.name),
    [
      "email_marketing_consent_events_user_id_idx",
      "email_marketing_consent_events_external_event_id_idx",
    ],
  );
  assert.deepEqual(
    events.checks.map((constraint) => constraint.name),
    [
      "email_marketing_consent_events_status_check",
      "email_marketing_consent_events_source_check",
    ],
  );
});

test("legacy public Brevo exports and sync routes are absent", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const app = await readFile(
    new URL("../client/src/App.tsx", import.meta.url),
    "utf8",
  );

  for (const forbidden of [
    "/api/users/all",
    "/api/sync-brevo",
    "/api/brevo-export",
    "/api/public/export-users-csv",
    "/api/public/brevo-sync-script",
    "/api/public/brevo-webhook-data",
  ]) {
    assert.equal(routes.includes(forbidden), false, `${forbidden} must be removed`);
  }

  assert.equal(app.includes("/brevo-sync"), false);
  assert.equal(app.includes("BrevoSync"), false);
});

test("email preference routes require authentication and webhook keeps the raw body", async () => {
  const routes = await readFile(
    new URL("./emailMarketingRoutes.ts", import.meta.url),
    "utf8",
  );
  const index = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  assert.match(
    routes,
    /app\.get\("\/api\/email-preferences", requireJWTAuth/,
  );
  assert.match(
    routes,
    /app\.put\("\/api\/email-preferences", requireJWTAuth/,
  );
  assert.match(index, /originalUrl === '\/api\/webhooks\/resend'/);
  assert.match(index, /rawBody = buffer\.toString\('utf8'\)/);
});

test("Resend webhook can only move a contact to unsubscribed", async () => {
  process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
  const { shouldApplyResendUnsubscribe } = await import("./emailMarketingRoutes");

  assert.equal(
    shouldApplyResendUnsubscribe({
      type: "contact.updated",
      data: { unsubscribed: true },
    }),
    true,
  );
  assert.equal(
    shouldApplyResendUnsubscribe({
      type: "contact.updated",
      data: { unsubscribed: false },
    }),
    false,
  );
  assert.equal(
    shouldApplyResendUnsubscribe({
      type: "contact.created",
      data: { unsubscribed: true },
    }),
    false,
  );
});
