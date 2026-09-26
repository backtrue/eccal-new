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

test("GTM accepts a real account path independently of its display name", async () => {
  const service = createGtmReadService({
    oauth: { refreshCredential: async i => ({ accessToken: "request-token", grantedScopes: [GTM_READONLY_SCOPE], connection: i }) },
    repository: { isResultEligible: async () => true },
    transport: { request: async () => ({ status: 200, body: {
      account: [{ accountId: "123", path: "accounts/123", name: "Production GTM" }],
      nextPageToken: null,
    } }) },
    now: () => Date.parse("2026-01-01T00:00:00Z"),
  });
  const result = await service.listAccounts({ userId: "u", connectionId: "c", generation: 0 });
  assert.equal(result.source, "google_tag_manager");
  assert.equal(result.fetchedAt, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(result.queryScope, { operation: "accounts" });
  assert.deepEqual(result.pagination, { nextPageToken: null, complete: true, automatic: false });
  assert.deepEqual(result.data, { account: [{ accountId: "123", path: "accounts/123", name: "Production GTM" }], nextPageToken: null });
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
    transport: { request: async i => ({ status: 200, body: { path: "accounts/a/containers/c/workspaces/w/tags/t", name: "Purchase tag", tagId: "t", type: "html" } }) },
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
      const body = i.url.endsWith("/accounts") ? { account: [{ path: "accounts/a", name: "Production GTM", accountId: "a" }] } :
        i.url.endsWith("/containers") ? { container: [{ path: "accounts/a/containers/c", name: "Website", containerId: "c" }] } :
        i.url.endsWith("/workspaces") ? { workspace: [{ path: "accounts/a/containers/c/workspaces/w", name: "Default Workspace", workspaceId: "w" }] } :
        i.url.endsWith("/status") ? { workspaceChange: [{ changeStatus: "updated", tag: { path: "accounts/a/containers/c/workspaces/w/tags/t", name: "Purchase tag", tagId: "t", type: "html" } }], mergeConflict: [{ entityInWorkspace: { changeStatus: "updated", tag: { path: "accounts/a/containers/c/workspaces/w/tags/t", name: "Purchase tag", tagId: "t", type: "html" } }, entityInBaseVersion: { changeStatus: "updated", tag: { path: "accounts/a/containers/c/versions/v/tags/t", name: "Old purchase tag", tagId: "t", type: "html" } } }] } :
        i.url.match(/\/tags\/t$/) ? { path: "accounts/a/containers/c/workspaces/w/tags/t", name: "Purchase tag", tagId: "t", type: "html" } :
        i.url.includes("/tags") ? { tag: [{ path: "accounts/a/containers/c/workspaces/w/tags/t", name: "Purchase tag", tagId: "t", type: "html" }] } :
        i.url.match(/\/triggers\/t$/) ? { path: "accounts/a/containers/c/workspaces/w/triggers/t", name: "Page view", triggerId: "t", type: "pageview" } :
        i.url.includes("/triggers") ? { trigger: [{ path: "accounts/a/containers/c/workspaces/w/triggers/t", name: "Page view", triggerId: "t", type: "pageview" }] } :
        i.url.match(/\/variables\/v$/) ? { path: "accounts/a/containers/c/workspaces/w/variables/v", name: "Page URL", variableId: "v", type: "text" } :
        i.url.includes("/variables") ? { variable: [{ path: "accounts/a/containers/c/workspaces/w/variables/v", name: "Page URL", variableId: "v", type: "text" }] } :
        { containerVersionHeader: [{ path: "accounts/a/containers/c/versions/v", name: "Release 1", containerVersionId: "v" }] };
      return { status: 200, body };
    } },
  });
  const base = { userId: "u", connectionId: "c", generation: 0 };
  await service.listAccounts(base);
  await service.listContainers({ ...base, accountId: "a" });
  await service.listWorkspaces({ ...base, accountId: "a", containerId: "c" });
  const status = await service.getWorkspaceStatus({ ...base, accountId: "a", containerId: "c", workspaceId: "w" });
  assert.deepEqual(status.pagination, { nextPageToken: null, complete: true, automatic: false });
  assert.equal((status.data as { workspaceChange: Array<{ tag: { name: string } }> }).workspaceChange[0].tag.name, "Purchase tag");
  assert.equal((status.data as { mergeConflict: Array<{ entityInBaseVersion: { tag: { path: string } } }> }).mergeConflict[0].entityInBaseVersion.tag.path, "accounts/a/containers/c/versions/v/tags/t");
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

test("GTM workspace status rejects a nested resource from another account", async () => {
  const service = createGtmReadService({
    oauth: { refreshCredential: async i => ({ accessToken: "token", grantedScopes: [GTM_READONLY_SCOPE], connection: i }) },
    repository: { isResultEligible: async () => true },
    transport: { request: async () => ({ status: 200, body: {
      workspaceChange: [{ changeStatus: "updated", tag: {
        path: "accounts/other/containers/c/workspaces/w/tags/t", name: "Purchase tag", tagId: "t", type: "html",
      } }],
    } }) },
  });
  await assert.rejects(
    service.getWorkspaceStatus({ userId: "u", connectionId: "c", generation: 0, accountId: "a", containerId: "c", workspaceId: "w" }),
    /GTM_RESOURCE_IDENTITY_MISMATCH/,
  );
});

test("GTM workspace status rejects malformed change and conflict lists", async () => {
  const cases = [
    { workspaceChange: [], mergeConflict: [], nextPageToken: "unexpected" },
    { workspaceChange: [], mergeConflict: [], nextPageToken: null },
    { workspaceChange: "not-an-array" },
    { workspaceChange: ["not-an-entity"] },
    { mergeConflict: ["not-a-conflict"] },
    { mergeConflict: [{ entityInWorkspace: "not-an-entity" }] },
    { mergeConflict: [{}] },
    { workspaceChange: [{}] },
    { workspaceChange: [{ tag: {} }] },
    { workspaceChange: [{ tag: "not-a-tag" }] },
    { workspaceChange: [{ changeStatus: "not-a-google-enum", tag: { path: "accounts/a/containers/c/workspaces/w/tags/t", tagId: "t", type: "html" } }] },
  ];
  for (const body of cases) {
    const service = createGtmReadService({
      oauth: { refreshCredential: async i => ({ accessToken: "token", grantedScopes: [GTM_READONLY_SCOPE], connection: i }) },
      repository: { isResultEligible: async () => true },
      transport: { request: async () => ({ status: 200, body }) },
    });
    await assert.rejects(
      service.getWorkspaceStatus({ userId: "u", connectionId: "c", generation: 0, accountId: "a", containerId: "c", workspaceId: "w" }),
      /GTM_UPSTREAM_INVALID_RESPONSE/,
    );
  }
});

test("GTM workspace status rejects nested terminal ID mismatches", async () => {
  const cases = [
    { path: "accounts/a/containers/c/workspaces/w/tags/path-tag", tagId: "different-tag" },
    { path: "accounts/a/containers/c/workspaces/w/variables/t", tagId: "t" },
    { path: "accounts/a/containers/c/environments/e/tags/t", tagId: "t" },
    { path: "accounts/a/containers/c/versions/v/tags/t", tagId: "t" },
    { path: "accounts/a/containers/c/workspaces/w/folders/f/tags/t", tagId: "t" },
  ];
  for (const resource of cases) {
    const service = createGtmReadService({
      oauth: { refreshCredential: async i => ({ accessToken: "token", grantedScopes: [GTM_READONLY_SCOPE], connection: i }) },
      repository: { isResultEligible: async () => true },
      transport: { request: async () => ({ status: 200, body: {
        workspaceChange: [{ changeStatus: "updated", tag: { ...resource, name: "Purchase tag", type: "html" } }],
      } }) },
    });
    await assert.rejects(
      service.getWorkspaceStatus({ userId: "u", connectionId: "c", generation: 0, accountId: "a", containerId: "c", workspaceId: "w" }),
      /GTM_RESOURCE_IDENTITY_MISMATCH/,
    );
  }
});

test("GTM workspace status accepts base-version entities only at the exact version path", async () => {
  const base = { userId: "u", connectionId: "c", generation: 0, accountId: "a", containerId: "c", workspaceId: "w" };
  for (const path of [
    "accounts/a/containers/c/versions/v/folders/f/tags/t",
    "accounts/a/containers/c/workspaces/w/tags/t",
  ]) {
    const service = createGtmReadService({
      oauth: { refreshCredential: async i => ({ accessToken: "token", grantedScopes: [GTM_READONLY_SCOPE], connection: i }) },
      repository: { isResultEligible: async () => true },
      transport: { request: async () => ({ status: 200, body: {
        mergeConflict: [{
          entityInWorkspace: { tag: { path: "accounts/a/containers/c/workspaces/w/tags/t", tagId: "t", type: "html" } },
          entityInBaseVersion: { tag: { path, tagId: "t", type: "html" } },
        }],
      } }) },
    });
    await assert.rejects(service.getWorkspaceStatus(base), /GTM_RESOURCE_IDENTITY_MISMATCH/);
  }
});

test("GTM workspace status checks every entity collection and accepts built-in variables", async () => {
  const base = { userId: "u", connectionId: "c", generation: 0, accountId: "a", containerId: "c", workspaceId: "w" };
  const serviceFor = (body: unknown) => createGtmReadService({
    oauth: { refreshCredential: async i => ({ accessToken: "token", grantedScopes: [GTM_READONLY_SCOPE], connection: i }) },
    repository: { isResultEligible: async () => true },
    transport: { request: async () => ({ status: 200, body }) },
  });
  await assert.rejects(
    serviceFor({ workspaceChange: [{ folder: { path: "accounts/a/containers/c/workspaces/w/tags/f", folderId: "f" } }] }).getWorkspaceStatus(base),
    /GTM_RESOURCE_IDENTITY_MISMATCH/,
  );
  const result = await serviceFor({ workspaceChange: [{ changeStatus: "added", builtInVariable: {
    path: "accounts/a/containers/c/workspaces/w/built_in_variables", type: "pageUrl",
  } }] }).getWorkspaceStatus(base);
  assert.equal((result.data as { workspaceChange: Array<{ builtInVariable: { type: string } }> }).workspaceChange[0].builtInVariable.type, "pageUrl");
});

test("GTM list resources reject terminal ID mismatches for every family", async () => {
  const cases = [
    ["listAccounts", {}, { account: [{ path: "accounts/name-a", name: "Production GTM", accountId: "a" }] }],
    ["listContainers", { accountId: "a" }, { container: [{ path: "accounts/a/containers/name-c", name: "Website", containerId: "c" }] }],
    ["listWorkspaces", { accountId: "a", containerId: "c" }, { workspace: [{ path: "accounts/a/containers/c/workspaces/name-w", name: "Default Workspace", workspaceId: "w" }] }],
    ["listTags", { accountId: "a", containerId: "c", workspaceId: "w" }, { tag: [{ path: "accounts/a/containers/c/workspaces/w/tags/name-t", name: "Purchase tag", tagId: "t", type: "html" }] }],
    ["listTriggers", { accountId: "a", containerId: "c", workspaceId: "w" }, { trigger: [{ path: "accounts/a/containers/c/workspaces/w/triggers/name-t", name: "Page view", triggerId: "t", type: "pageview" }] }],
    ["listVariables", { accountId: "a", containerId: "c", workspaceId: "w" }, { variable: [{ path: "accounts/a/containers/c/workspaces/w/variables/name-v", name: "Page URL", variableId: "v", type: "text" }] }],
    ["listContainerVersionHeaders", { accountId: "a", containerId: "c" }, { containerVersionHeader: [{ path: "accounts/a/containers/c/versions/name-v", name: "Release 1", containerVersionId: "v" }] }],
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
