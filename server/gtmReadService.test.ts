import assert from "node:assert/strict";
import test from "node:test";
import { createGtmReadService, GTM_API_ENDPOINT } from "./gtmReadService";
import { GTM_READONLY_SCOPE } from "./gtmCredentialService";

test("GTM read service fixes endpoints and checks eligibility around response", async () => {
  const urls: string[] = []; let checks = 0;
  const service = createGtmReadService({
    oauth: { refreshCredential: async i => ({ accessToken: "request-token", grantedScopes: [GTM_READONLY_SCOPE], connection: i }) },
    repository: { isResultEligible: async () => (++checks > 0) },
    transport: { request: async i => { urls.push(i.url); return { status: 200, body: { accounts: [], nextPageToken: "next" } }; } },
    now: () => Date.parse("2026-01-01T00:00:00Z"),
  });
  const result = await service.listAccounts({ userId: "u", connectionId: "c", generation: 0 });
  assert.equal(urls[0], `${GTM_API_ENDPOINT}/accounts`);
  assert.equal(result.pagination.complete, false);
  assert.equal(result.source, "google_tag_manager");
  assert.equal(checks, 3);
});

test("GTM read service rejects extraneous fields and performs post-check on upstream errors", async () => {
  let checks = 0;
  const service = createGtmReadService({
    oauth: { refreshCredential: async i => ({ accessToken: "request-token", grantedScopes: [GTM_READONLY_SCOPE], connection: i }) },
    repository: { isResultEligible: async () => (++checks === 1) },
    transport: { request: async () => { throw Object.assign(new Error("timeout"), { code: "GTM_UPSTREAM_TIMEOUT" }); } },
  });
  await assert.rejects(
    service.listAccounts({ userId: "u", connectionId: "c", generation: 0, accountId: "not-allowed" } as never),
    error => error instanceof Error && error.message === "GTM_INVALID_INPUT",
  );
  await assert.rejects(
    service.listAccounts({ userId: "u", connectionId: "c", generation: 0 }),
    error => error instanceof Error && error.message === "GTM_CONNECTION_REJECTED",
  );
  assert.equal(checks, 3);
});

test("GTM read service gives stale connection precedence over refresh failures", async () => {
  let checks = 0;
  const service = createGtmReadService({
    oauth: { refreshCredential: async () => { throw new Error("refresh failed"); } },
    repository: { isResultEligible: async () => (++checks === 1) ? false : false },
    transport: { request: async () => ({ status: 200, body: {} }) },
  });
  await assert.rejects(
    service.listAccounts({ userId: "u", connectionId: "c", generation: 0 }),
    error => error instanceof Error && error.message === "GTM_CONNECTION_REJECTED",
  );
  assert.equal(checks, 1);
});

test("GTM object reads require objectId and never advertise pagination", async () => {
  const service = createGtmReadService({
    oauth: { refreshCredential: async i => ({ accessToken: "request-token", grantedScopes: [GTM_READONLY_SCOPE], connection: i }) },
    repository: { isResultEligible: async () => true },
    transport: { request: async i => ({ status: 200, body: { name: "accounts/a/containers/c/workspaces/w/tags/t", tagId: "t", type: "html" } }) },
  });
  await assert.rejects(service.getTag({ userId: "u", connectionId: "c", generation: 0, accountId: "a", containerId: "c", workspaceId: "w" }), /GTM_INVALID_INPUT/);
  const result = await service.getTag({ userId: "u", connectionId: "c", generation: 0, accountId: "a", containerId: "c", workspaceId: "w", objectId: "t" });
  assert.equal(result.pagination.complete, true);
  assert.equal(result.pagination.nextPageToken, null);
});

test("GTM v2 URLs and collection keys are exact for every read operation", async () => {
  const urls: string[] = [];
  const service = createGtmReadService({
    oauth: { refreshCredential: async i => ({ accessToken: "token", grantedScopes: [GTM_READONLY_SCOPE], connection: i }) },
    repository: { isResultEligible: async () => true },
    transport: { request: async i => {
      urls.push(i.url);
      const body = i.url.endsWith("/accounts") ? { account: [{ name: "accounts/a", accountId: "a" }] } :
        i.url.endsWith("/containers") ? { container: [{ name: "accounts/a/containers/c", containerId: "c" }] } :
        i.url.endsWith("/workspaces") ? { workspace: [{ name: "accounts/a/containers/c/workspaces/w", workspaceId: "w" }] } :
        i.url.endsWith("/status") ? { workspace: { name: "accounts/a/containers/c/workspaces/w", workspaceId: "w" } } :
        i.url.match(/\/tags\/t$/) ? { name: "accounts/a/containers/c/workspaces/w/tags/t", tagId: "t", type: "html" } :
        i.url.includes("/tags") ? { tag: [{ name: "accounts/a/containers/c/workspaces/w/tags/t", tagId: "t", type: "html" }] } :
        i.url.match(/\/triggers\/t$/) ? { name: "accounts/a/containers/c/workspaces/w/triggers/t", triggerId: "t", type: "click" } :
        i.url.includes("/triggers") ? { trigger: [{ name: "accounts/a/containers/c/workspaces/w/triggers/t", triggerId: "t", type: "click" }] } :
        i.url.match(/\/variables\/v$/) ? { name: "accounts/a/containers/c/workspaces/w/variables/v", variableId: "v", type: "text" } :
        i.url.includes("/variables") ? { variable: [{ name: "accounts/a/containers/c/workspaces/w/variables/v", variableId: "v", type: "text" }] } :
        { containerVersionHeader: [{ name: "accounts/a/containers/c/versions/v", containerVersionId: "v" }] };
      return { status: 200, body };
    } },
  });
  const base = { userId: "u", connectionId: "c", generation: 0 };
  await service.listAccounts(base);
  await service.listContainers({ ...base, accountId: "a" });
  await service.listWorkspaces({ ...base, accountId: "a", containerId: "c" });
  await service.getWorkspaceStatus({ ...base, accountId: "a", containerId: "c", workspaceId: "w" });
  await service.listTags({ ...base, accountId: "a", containerId: "c", workspaceId: "w" });
  await service.getTag({ ...base, accountId: "a", containerId: "c", workspaceId: "w", objectId: "t" });
  await service.listTriggers({ ...base, accountId: "a", containerId: "c", workspaceId: "w" });
  await service.getTrigger({ ...base, accountId: "a", containerId: "c", workspaceId: "w", objectId: "t" });
  await service.listVariables({ ...base, accountId: "a", containerId: "c", workspaceId: "w" });
  await service.getVariable({ ...base, accountId: "a", containerId: "c", workspaceId: "w", objectId: "v" });
  await service.listContainerVersionHeaders({ ...base, accountId: "a", containerId: "c" });
  assert.deepEqual(urls.map(url => new URL(url).pathname), [
    `${new URL(GTM_API_ENDPOINT).pathname}/accounts`, `${new URL(GTM_API_ENDPOINT).pathname}/accounts/a/containers`,
    `${new URL(GTM_API_ENDPOINT).pathname}/accounts/a/containers/c/workspaces`,
    `${new URL(GTM_API_ENDPOINT).pathname}/accounts/a/containers/c/workspaces/w/status`,
    `${new URL(GTM_API_ENDPOINT).pathname}/accounts/a/containers/c/workspaces/w/tags`,
    `${new URL(GTM_API_ENDPOINT).pathname}/accounts/a/containers/c/workspaces/w/tags/t`,
    `${new URL(GTM_API_ENDPOINT).pathname}/accounts/a/containers/c/workspaces/w/triggers`,
    `${new URL(GTM_API_ENDPOINT).pathname}/accounts/a/containers/c/workspaces/w/triggers/t`,
    `${new URL(GTM_API_ENDPOINT).pathname}/accounts/a/containers/c/workspaces/w/variables`,
    `${new URL(GTM_API_ENDPOINT).pathname}/accounts/a/containers/c/workspaces/w/variables/v`,
    `${new URL(GTM_API_ENDPOINT).pathname}/accounts/a/containers/c/version_headers`,
  ]);
});

test("GTM list resources reject terminal ID mismatches for every family", async () => {
  const cases = [
    ["listAccounts", {}, { account: [{ name: "accounts/name-a", accountId: "a" }] }],
    ["listContainers", { accountId: "a" }, { container: [{ name: "accounts/a/containers/name-c", containerId: "c" }] }],
    ["listWorkspaces", { accountId: "a", containerId: "c" }, { workspace: [{ name: "accounts/a/containers/c/workspaces/name-w", workspaceId: "w" }] }],
    ["listTags", { accountId: "a", containerId: "c", workspaceId: "w" }, { tag: [{ name: "accounts/a/containers/c/workspaces/w/tags/name-t", tagId: "t", type: "html" }] }],
    ["listTriggers", { accountId: "a", containerId: "c", workspaceId: "w" }, { trigger: [{ name: "accounts/a/containers/c/workspaces/w/triggers/name-t", triggerId: "t", type: "click" }] }],
    ["listVariables", { accountId: "a", containerId: "c", workspaceId: "w" }, { variable: [{ name: "accounts/a/containers/c/workspaces/w/variables/name-v", variableId: "v", type: "text" }] }],
    ["listContainerVersionHeaders", { accountId: "a", containerId: "c" }, { containerVersionHeader: [{ name: "accounts/a/containers/c/versions/name-v", containerVersionId: "v" }] }],
  ] as const;
  for (const [method, scope, body] of cases) {
    const service = createGtmReadService({
      oauth: { refreshCredential: async i => ({ accessToken: "token", grantedScopes: [GTM_READONLY_SCOPE], connection: i }) },
      repository: { isResultEligible: async () => true },
      transport: { request: async () => ({ status: 200, body }) },
    });
    await assert.rejects(
      (service as Record<string, (i: GtmReadInput) => Promise<unknown>>)[method]({ userId: "u", connectionId: "c", generation: 0, ...scope }),
      /GTM_RESOURCE_IDENTITY_MISMATCH/,
      method,
    );
  }
});