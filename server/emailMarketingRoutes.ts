import type { Express, Request, Response } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { requireJWTAuth } from "./jwtAuth";
import {
  emailMarketingConsentEvents,
  emailMarketingPreferences,
  users,
} from "@shared/schema";
import {
  ResendContactServiceError,
  resendContactService,
} from "./resendContactService";

export const EMAIL_MARKETING_CONSENT_VERSION = "2026-08-18-v1";

type PreferenceStatus = "pending" | "subscribed" | "unsubscribed";
type PreferenceSource = "first_login_prompt" | "settings" | "resend_webhook";
type ProviderSyncState = "not_required" | "pending" | "synced" | "failed";

type EmailPreferenceView = {
  status: PreferenceStatus;
  source: PreferenceSource | null;
  consentVersion: string | null;
  consentedAt: Date | null;
  unsubscribedAt: Date | null;
  providerSync: ProviderSyncState;
  updatedAt: Date | null;
};

export function shouldApplyResendUnsubscribe(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const candidate = event as { type?: unknown; data?: unknown };
  if (candidate.type !== "contact.updated" || !candidate.data || typeof candidate.data !== "object") {
    return false;
  }
  return (candidate.data as { unsubscribed?: unknown }).unsubscribed === true;
}

function toPreferenceView(
  preference: typeof emailMarketingPreferences.$inferSelect,
): EmailPreferenceView {
  return {
    status: preference.status,
    source: preference.source,
    consentVersion: preference.consentVersion,
    consentedAt: preference.consentedAt,
    unsubscribedAt: preference.unsubscribedAt,
    providerSync: preference.resendSyncStatus,
    updatedAt: preference.updatedAt,
  };
}

async function getOrCreatePreference(userId: string) {
  await db
    .insert(emailMarketingPreferences)
    .values({ userId })
    .onConflictDoNothing({ target: emailMarketingPreferences.userId });

  const [preference] = await db
    .select()
    .from(emailMarketingPreferences)
    .where(eq(emailMarketingPreferences.userId, userId))
    .limit(1);

  return preference;
}

async function savePreferenceDecision(input: {
  userId: string;
  subscribed: boolean;
  source: Exclude<PreferenceSource, "resend_webhook">;
}) {
  const now = new Date();
  const status = input.subscribed ? "subscribed" : "unsubscribed";

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(emailMarketingPreferences)
      .where(eq(emailMarketingPreferences.userId, input.userId))
      .limit(1);

    const consentedAt = input.subscribed ? now : existing?.consentedAt ?? null;
    const unsubscribedAt = input.subscribed ? null : now;

    const [preference] = await tx
      .insert(emailMarketingPreferences)
      .values({
        userId: input.userId,
        status,
        source: input.source,
        consentVersion: EMAIL_MARKETING_CONSENT_VERSION,
        consentedAt,
        unsubscribedAt,
        resendSyncStatus: "pending",
        lastSyncError: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: emailMarketingPreferences.userId,
        set: {
          status,
          source: input.source,
          consentVersion: EMAIL_MARKETING_CONSENT_VERSION,
          consentedAt,
          unsubscribedAt,
          resendSyncStatus: "pending",
          lastSyncError: null,
          updatedAt: now,
        },
      })
      .returning();

    await tx.insert(emailMarketingConsentEvents).values({
      userId: input.userId,
      status,
      source: input.source,
      consentVersion: EMAIL_MARKETING_CONSENT_VERSION,
      occurredAt: now,
    });

    return preference;
  });
}

async function syncPreferenceForUser(userId: string): Promise<ProviderSyncState> {
  const [record] = await db
    .select({
      preference: emailMarketingPreferences,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(emailMarketingPreferences)
    .innerJoin(users, eq(emailMarketingPreferences.userId, users.id))
    .where(eq(emailMarketingPreferences.userId, userId))
    .limit(1);

  if (!record || record.preference.status === "pending") {
    return "not_required";
  }

  if (!record.email) {
    await db
      .update(emailMarketingPreferences)
      .set({
        resendSyncStatus: "failed",
        lastSyncError: "missing_email",
        updatedAt: new Date(),
      })
      .where(eq(emailMarketingPreferences.userId, userId));
    return "failed";
  }

  try {
    const result = await resendContactService.syncContact({
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      subscribed: record.preference.status === "subscribed",
    });

    const [latestPreference] = await db
      .select({ status: emailMarketingPreferences.status })
      .from(emailMarketingPreferences)
      .where(eq(emailMarketingPreferences.userId, userId))
      .limit(1);

    if (
      latestPreference &&
      latestPreference.status !== record.preference.status
    ) {
      await db
        .update(emailMarketingPreferences)
        .set({
          resendSyncStatus: "pending",
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(emailMarketingPreferences.userId, userId));
      return "pending";
    }

    await db
      .update(emailMarketingPreferences)
      .set({
        resendContactId: result.contactId ?? record.preference.resendContactId,
        resendSyncStatus: "synced",
        lastSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(emailMarketingPreferences.userId, userId));
    return "synced";
  } catch (error) {
    const safeError =
      error instanceof ResendContactServiceError
        ? error.message.slice(0, 255)
        : "resend_sync_failed";
    await db
      .update(emailMarketingPreferences)
      .set({
        resendSyncStatus: "failed",
        lastSyncError: safeError,
        updatedAt: new Date(),
      })
      .where(eq(emailMarketingPreferences.userId, userId));
    console.error("[RESEND_CONTACT_SYNC] Contact sync failed", {
      userId,
      error: safeError,
    });
    return "failed";
  }
}

let retryWorkerRunning = false;

async function retryPendingResendSyncs() {
  if (retryWorkerRunning) return;
  retryWorkerRunning = true;

  try {
    const pending = await db
      .select({ userId: emailMarketingPreferences.userId })
      .from(emailMarketingPreferences)
      .where(
        inArray(emailMarketingPreferences.resendSyncStatus, ["pending", "failed"]),
      )
      .limit(25);

    for (let index = 0; index < pending.length; index += 1) {
      const userId = pending[index].userId;
      await syncPreferenceForUser(userId);
      if (index < pending.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
  } catch (error) {
    console.error("[RESEND_CONTACT_SYNC] Retry batch failed", {
      error: error instanceof Error ? error.message.slice(0, 255) : "unknown_error",
    });
  } finally {
    retryWorkerRunning = false;
  }
}

function authenticatedUserId(req: Request): string | null {
  const id = (req as Request & { user?: { id?: unknown } }).user?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function handleResendWebhook(req: Request, res: Response) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const rawBody = (req as Request & { rawBody?: string }).rawBody;
  const id = req.header("svix-id");
  const timestamp = req.header("svix-timestamp");
  const signature = req.header("svix-signature");

  if (!webhookSecret) {
    return res.status(503).json({ error: "Webhook is not configured" });
  }
  if (!rawBody || !id || !timestamp || !signature) {
    return res.status(400).json({ error: "Invalid webhook request" });
  }

  let event;
  try {
    event = resendContactService.verifyWebhook({
      payload: rawBody,
      headers: { id, timestamp, signature },
      webhookSecret,
    });
  } catch {
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  if (event.type !== "contact.updated" || !shouldApplyResendUnsubscribe(event)) {
    return res.json({ received: true, applied: false });
  }

  const normalizedEmail = event.data.email.trim().toLowerCase();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`)
    .limit(1);

  if (!user) {
    return res.json({ received: true, applied: false });
  }

  const applied = await db.transaction(async (tx) => {
    const insertedEvents = await tx
      .insert(emailMarketingConsentEvents)
      .values({
        userId: user.id,
        status: "unsubscribed",
        source: "resend_webhook",
        consentVersion: EMAIL_MARKETING_CONSENT_VERSION,
        externalEventId: id,
        occurredAt: new Date(event.created_at),
      })
      .onConflictDoNothing({
        target: emailMarketingConsentEvents.externalEventId,
      })
      .returning({ id: emailMarketingConsentEvents.id });

    if (insertedEvents.length === 0) return false;

    const now = new Date();
    await tx
      .insert(emailMarketingPreferences)
      .values({
        userId: user.id,
        status: "unsubscribed",
        source: "resend_webhook",
        consentVersion: EMAIL_MARKETING_CONSENT_VERSION,
        unsubscribedAt: now,
        resendContactId: event.data.id,
        resendSyncStatus: "synced",
        lastSyncError: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: emailMarketingPreferences.userId,
        set: {
          status: "unsubscribed",
          source: "resend_webhook",
          consentVersion: EMAIL_MARKETING_CONSENT_VERSION,
          unsubscribedAt: now,
          resendContactId: event.data.id,
          resendSyncStatus: "synced",
          lastSyncError: null,
          updatedAt: now,
        },
      });

    return true;
  });

  return res.json({ received: true, applied });
}

export function setupEmailMarketingRoutes(app: Express) {
  app.get("/api/email-preferences", requireJWTAuth, async (req, res) => {
    const userId = authenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    try {
      const preference = await getOrCreatePreference(userId);
      if (!preference) {
        return res.status(500).json({ error: "Preference is unavailable" });
      }
      return res.json({ success: true, preference: toPreferenceView(preference) });
    } catch (error) {
      console.error("[EMAIL_PREFERENCES] Read failed", {
        userId,
        error: error instanceof Error ? error.message.slice(0, 255) : "unknown_error",
      });
      return res.status(500).json({ error: "Failed to load email preference" });
    }
  });

  app.put("/api/email-preferences", requireJWTAuth, async (req, res) => {
    const userId = authenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const { subscribed, source } = req.body ?? {};
    if (
      typeof subscribed !== "boolean" ||
      (source !== "first_login_prompt" && source !== "settings")
    ) {
      return res.status(400).json({ error: "Invalid email preference" });
    }

    try {
      await savePreferenceDecision({ userId, subscribed, source });
      const providerSync = await syncPreferenceForUser(userId);
      const preference = await getOrCreatePreference(userId);
      return res.json({
        success: true,
        preference: preference ? toPreferenceView(preference) : null,
        providerSync,
      });
    } catch (error) {
      console.error("[EMAIL_PREFERENCES] Update failed", {
        userId,
        error: error instanceof Error ? error.message.slice(0, 255) : "unknown_error",
      });
      return res.status(500).json({ error: "Failed to save email preference" });
    }
  });

  app.post("/api/webhooks/resend", handleResendWebhook);

  const retryTimer = setInterval(() => {
    void retryPendingResendSyncs();
  }, 5 * 60 * 1000);
  retryTimer.unref();
}
