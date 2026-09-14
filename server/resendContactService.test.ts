import assert from "node:assert/strict";
import test from "node:test";
import {
  ResendContactService,
  ResendContactServiceError,
} from "./resendContactService";

const notFound = {
  data: null,
  error: {
    name: "not_found",
    message: "Contact was not found",
    statusCode: 404,
  },
};

function createClient(overrides: Record<string, unknown> = {}) {
  const calls = {
    get: [] as unknown[],
    create: [] as unknown[],
    update: [] as unknown[],
    listSegments: [] as unknown[],
    addSegment: [] as unknown[],
  };

  const client = {
    contacts: {
      get: async (input: unknown) => {
        calls.get.push(input);
        return notFound;
      },
      create: async (input: unknown) => {
        calls.create.push(input);
        return { data: { id: "contact-created" }, error: null };
      },
      update: async (input: unknown) => {
        calls.update.push(input);
        return { data: { id: "contact-updated" }, error: null };
      },
      segments: {
        list: async (input: unknown) => {
          calls.listSegments.push(input);
          return {
            data: { object: "list", data: [], has_more: false },
            error: null,
          };
        },
        add: async (input: unknown) => {
          calls.addSegment.push(input);
          return { data: { id: "segment-added" }, error: null };
        },
      },
    },
    webhooks: {
      verify: (input: unknown) => input,
    },
  };

  Object.assign(client.contacts, overrides);
  return { client, calls };
}

test("requires an API key and segment before syncing", async () => {
  const service = new ResendContactService({
    getApiKey: () => undefined,
    getSegmentId: () => undefined,
  });

  await assert.rejects(
    () =>
      service.syncContact({
        email: "student@example.com",
        subscribed: true,
      }),
    /missing_configuration/,
  );
});

test("creates a normalized subscribed contact in the configured segment", async () => {
  const { client, calls } = createClient();
  const service = new ResendContactService({
    getApiKey: () => "re_test",
    getSegmentId: () => "general-segment",
    createClient: () => client as never,
  });

  const result = await service.syncContact({
    email: "  Student@Example.COM ",
    firstName: " Student ",
    lastName: " One ",
    subscribed: true,
  });

  assert.deepEqual(calls.get, [{ email: "student@example.com" }]);
  assert.deepEqual(calls.create, [
    {
      email: "student@example.com",
      firstName: "Student",
      lastName: "One",
      unsubscribed: false,
      segments: [{ id: "general-segment" }],
    },
  ]);
  assert.deepEqual(result, {
    contactId: "contact-created",
    providerState: "subscribed",
  });
});

test("does not create a Resend contact when a non-subscriber is absent", async () => {
  const { client, calls } = createClient();
  const service = new ResendContactService({
    getApiKey: () => "re_test",
    getSegmentId: () => "general-segment",
    createClient: () => client as never,
  });

  const result = await service.syncContact({
    email: "student@example.com",
    subscribed: false,
  });

  assert.equal(calls.create.length, 0);
  assert.equal(calls.update.length, 0);
  assert.deepEqual(result, { contactId: null, providerState: "not_found" });
});

test("updates an existing contact and adds a missing segment", async () => {
  const { client, calls } = createClient({
    get: async (input: unknown) => {
      calls.get.push(input);
      return {
        data: {
          id: "existing-contact",
          email: "student@example.com",
          unsubscribed: true,
        },
        error: null,
      };
    },
  });
  const service = new ResendContactService({
    getApiKey: () => "re_test",
    getSegmentId: () => "general-segment",
    createClient: () => client as never,
  });

  await service.syncContact({
    email: "student@example.com",
    firstName: "Student",
    subscribed: true,
  });

  assert.deepEqual(calls.update, [
    {
      email: "student@example.com",
      firstName: "Student",
      lastName: null,
      unsubscribed: false,
    },
  ]);
  assert.deepEqual(calls.addSegment, [
    { email: "student@example.com", segmentId: "general-segment" },
  ]);
});

test("marks an existing contact unsubscribed without removing it", async () => {
  const { client, calls } = createClient({
    get: async () => ({
      data: {
        id: "existing-contact",
        email: "student@example.com",
        unsubscribed: false,
      },
      error: null,
    }),
  });
  const service = new ResendContactService({
    getApiKey: () => "re_test",
    getSegmentId: () => "general-segment",
    createClient: () => client as never,
  });

  const result = await service.syncContact({
    email: "student@example.com",
    subscribed: false,
  });

  assert.deepEqual(calls.update, [
    {
      email: "student@example.com",
      unsubscribed: true,
    },
  ]);
  assert.equal("firstName" in (calls.update[0] as object), false);
  assert.equal("lastName" in (calls.update[0] as object), false);
  assert.equal(calls.addSegment.length, 0);
  assert.deepEqual(result, {
    contactId: "contact-updated",
    providerState: "unsubscribed",
  });
});

test("provider errors are sanitized and do not expose an email", async () => {
  const { client } = createClient({
    get: async () => ({
      data: null,
      error: {
        name: "invalid_api_key",
        message: "student@example.com used a secret token",
        statusCode: 401,
      },
    }),
  });
  const service = new ResendContactService({
    getApiKey: () => "re_test",
    getSegmentId: () => "general-segment",
    createClient: () => client as never,
  });

  await assert.rejects(
    () =>
      service.syncContact({
        email: "student@example.com",
        subscribed: true,
      }),
    (error: Error) => {
      assert.match(error.message, /invalid_api_key/);
      assert.doesNotMatch(error.message, /student@example\.com|secret token/);
      return true;
    },
  );
});

const subscribedInput = {
  email: "student@example.com",
  subscribed: true,
};

function assertEmptyResponse(operation: string) {
  return (error: unknown) => {
    assert.ok(error instanceof ResendContactServiceError);
    assert.equal(error.operation, operation);
    assert.equal(error.code, "empty_response");
    return true;
  };
}

test("rejects a null create response", async () => {
  const { client } = createClient({
    create: async () => ({ data: null, error: null }),
  });
  const service = new ResendContactService({
    getApiKey: () => "re_test",
    getSegmentId: () => "general-segment",
    createClient: () => client as never,
  });

  await assert.rejects(
    () => service.syncContact(subscribedInput),
    assertEmptyResponse("create"),
  );
});

test("rejects a null update response", async () => {
  const { client } = createClient({
    get: async () => ({
      data: {
        id: "contact-existing",
        email: "student@example.com",
        unsubscribed: false,
      },
      error: null,
    }),
    update: async () => ({ data: null, error: null }),
  });
  const service = new ResendContactService({
    getApiKey: () => "re_test",
    getSegmentId: () => "general-segment",
    createClient: () => client as never,
  });

  await assert.rejects(
    () => service.syncContact(subscribedInput),
    assertEmptyResponse("update"),
  );
});

test("rejects a null segment-list response", async () => {
  const { client } = createClient({
    get: async () => ({
      data: {
        id: "contact-existing",
        email: "student@example.com",
        unsubscribed: false,
      },
      error: null,
    }),
    segments: {
      list: async () => ({ data: null, error: null }),
      add: async () => ({ data: { id: "segment-added" }, error: null }),
    },
  });
  const service = new ResendContactService({
    getApiKey: () => "re_test",
    getSegmentId: () => "general-segment",
    createClient: () => client as never,
  });

  await assert.rejects(
    () => service.syncContact(subscribedInput),
    assertEmptyResponse("list_segments"),
  );
});
