import { Resend, type ErrorResponse, type WebhookEventPayload } from "resend";

type ApiResult<T> = {
  data: T | null;
  error: ErrorResponse | null;
};

type ContactRecord = {
  id: string;
  email: string;
  unsubscribed: boolean;
};

type ResendClientLike = {
  contacts: {
    get: (input: { email: string }) => Promise<ApiResult<ContactRecord>>;
    create: (input: {
      email: string;
      firstName?: string;
      lastName?: string;
      unsubscribed: boolean;
      segments: Array<{ id: string }>;
    }) => Promise<ApiResult<{ id: string }>>;
    update: (input: {
      email: string;
      firstName?: string | null;
      lastName?: string | null;
      unsubscribed: boolean;
    }) => Promise<ApiResult<{ id: string }>>;
    segments: {
      list: (input: { email: string }) => Promise<
        ApiResult<{ data: Array<{ id: string }>; has_more: boolean; object: "list" }>
      >;
      add: (input: { email: string; segmentId: string }) => Promise<ApiResult<{ id: string }>>;
    };
  };
  webhooks: {
    verify: (input: {
      payload: string;
      headers: { id: string; timestamp: string; signature: string };
      webhookSecret: string;
    }) => WebhookEventPayload;
  };
};

export type ResendContactInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  subscribed: boolean;
};

export type ResendContactSyncResult = {
  contactId: string | null;
  providerState: "subscribed" | "unsubscribed" | "not_found";
};

type ResendContactServiceDependencies = {
  getApiKey?: () => string | undefined;
  getSegmentId?: () => string | undefined;
  createClient?: (apiKey: string) => ResendClientLike;
};

export class ResendContactServiceError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string,
    public readonly statusCode: number | null,
  ) {
    super(
      `Resend ${operation} failed (${code}${statusCode ? `, ${statusCode}` : ""})`,
    );
    this.name = "ResendContactServiceError";
  }
}

export class ResendContactService {
  private readonly getApiKey: () => string | undefined;
  private readonly getSegmentId: () => string | undefined;
  private readonly createClient: (apiKey: string) => ResendClientLike;

  constructor(dependencies: ResendContactServiceDependencies = {}) {
    this.getApiKey = dependencies.getApiKey ?? (() => process.env.RESEND_API_KEY);
    this.getSegmentId =
      dependencies.getSegmentId ?? (() => process.env.RESEND_SEGMENT_ID);
    this.createClient =
      dependencies.createClient ??
      ((apiKey) => new Resend(apiKey) as unknown as ResendClientLike);
  }

  async syncContact(input: ResendContactInput): Promise<ResendContactSyncResult> {
    const apiKey = this.getApiKey();
    const segmentId = this.getSegmentId();

    if (!apiKey || !segmentId) {
      throw new ResendContactServiceError("configuration", "missing_configuration", null);
    }

    const email = input.email.trim().toLowerCase();
    const client = this.createClient(apiKey);
    const existing = await client.contacts.get({ email });

    if (existing.error && existing.error.name !== "not_found") {
      throw this.toServiceError("lookup", existing.error);
    }

    if (!existing.error && !existing.data) {
      throw this.emptyResponseError("lookup");
    }

    if (existing.error?.name === "not_found") {
      if (!input.subscribed) {
        return { contactId: null, providerState: "not_found" };
      }

      const created = await client.contacts.create({
        email,
        firstName: input.firstName?.trim() || undefined,
        lastName: input.lastName?.trim() || undefined,
        unsubscribed: false,
        segments: [{ id: segmentId }],
      });

      const createdData = this.requireData("create", created);
      return { contactId: createdData.id, providerState: "subscribed" };
    }

    const updated = await client.contacts.update(
      input.subscribed
        ? {
            email,
            firstName: input.firstName?.trim() || null,
            lastName: input.lastName?.trim() || null,
            unsubscribed: false,
          }
        : {
            email,
            unsubscribed: true,
          },
    );

    const updatedData = this.requireData("update", updated);

    if (input.subscribed) {
      const segments = await client.contacts.segments.list({ email });
      const segmentsData = this.requireData("list_segments", segments);

      const belongsToGeneralSegment = segmentsData.data.some(
        (segment) => segment.id === segmentId,
      );
      if (!belongsToGeneralSegment) {
        const added = await client.contacts.segments.add({ email, segmentId });
        this.requireData("add_segment", added);
      }
    }

    return {
      contactId: updatedData.id,
      providerState: input.subscribed ? "subscribed" : "unsubscribed",
    };
  }

  verifyWebhook(input: {
    payload: string;
    headers: { id: string; timestamp: string; signature: string };
    webhookSecret: string;
  }): WebhookEventPayload {
    const client = this.createClient(this.getApiKey() || "re_webhook_verification");
    return client.webhooks.verify(input);
  }

  private requireData<T>(operation: string, result: ApiResult<T>): T {
    if (result.error) {
      throw this.toServiceError(operation, result.error);
    }
    if (!result.data) {
      throw this.emptyResponseError(operation);
    }
    return result.data;
  }

  private emptyResponseError(operation: string) {
    return new ResendContactServiceError(operation, "empty_response", null);
  }

  private toServiceError(operation: string, error: ErrorResponse) {
    return new ResendContactServiceError(
      operation,
      error.name || "unknown_error",
      error.statusCode,
    );
  }
}

export const resendContactService = new ResendContactService();
