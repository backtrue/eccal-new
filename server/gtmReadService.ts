import { GTM_READONLY_SCOPE } from "./gtmCredentialService";

export const GTM_API_ENDPOINT = "https://tagmanager.googleapis.com/tagmanager/v2";
export const GTM_MAX_BODY_BYTES = 1_048_576;

export type GtmReadErrorCode =
  | "GTM_INVALID_INPUT" | "GTM_CONNECTION_REJECTED" | "GTM_RESOURCE_NOT_FOUND"
  | "GTM_UPSTREAM_REJECTED" | "GTM_UPSTREAM_TIMEOUT" | "GTM_UPSTREAM_REDIRECT"
  | "GTM_UPSTREAM_RESPONSE_TOO_LARGE" | "GTM_UPSTREAM_INVALID_RESPONSE"
  | "GTM_RESOURCE_IDENTITY_MISMATCH";
export class GtmReadError extends Error {
  constructor(readonly code: GtmReadErrorCode) { super(code); this.name = "GtmReadError"; }
}
export type GtmReadTransport = Readonly<{
  request: (input: { url: string; accessToken: string }) =>
    Promise<Readonly<{ status: number; body: unknown }>>;
}>;
export type GtmReadRepository = Readonly<{
  isResultEligible: (i: { userId: string; connectionId: string; generation: number }) => Promise<boolean>;
}>;
export type GtmReadOAuth = Readonly<{
  refreshCredential: (i: { userId: string; connectionId: string; generation: number }) =>
    Promise<Readonly<{ accessToken: string; grantedScopes: readonly string[]; connection: {
      userId: string; connectionId: string; generation: number;
    } }>>;
}>;
export type GtmReadInput = Readonly<{
  userId: string; connectionId: string; generation: number;
  accountId?: string; containerId?: string; workspaceId?: string;
  objectId?: string; pageToken?: string;
}>;
export type GtmReadResult = Readonly<{
  userId: string; connectionId: string; generation: number; data: unknown;
  source: "google_tag_manager"; fetchedAt: string; queryScope: Readonly<Record<string, string>>;
  pagination: Readonly<{ nextPageToken: string | null; complete: boolean; automatic: false }>;
}>;

const fail = (code: GtmReadErrorCode): never => { throw new GtmReadError(code); };
const string = (v: unknown): string => typeof v === "string" && v.length > 0 ? v : fail("GTM_INVALID_INPUT");
const id = (v: unknown): string => {
  const value = string(v);
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 128) fail("GTM_INVALID_INPUT");
  return value;
};
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
function body(value: unknown): Record<string, unknown> {
  if (!record(value)) fail("GTM_UPSTREAM_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
function page(value: Record<string, unknown>) {
  const token = value.nextPageToken;
  if (token != null && (typeof token !== "string" || token.length > 512)) fail("GTM_UPSTREAM_INVALID_RESPONSE");
  return Object.freeze({ nextPageToken: typeof token === "string" ? token : null,
    complete: token == null, automatic: false as const });
}
const COLLECTION_KEYS: Readonly<Record<string, string | null>> = Object.freeze({
  accounts: "account", containers: "container", workspaces: "workspace",
  tags: "tag", "tags-get": null, triggers: "trigger", "triggers-get": null,
  variables: "variable", "variables-get": null, versions: "containerVersionHeader",
  "workspace-status": null,
});
function canonicalSegments(name: unknown, allowBuiltInCollection = false): string[] {
  const raw = typeof name === "string" ? name : fail("GTM_UPSTREAM_INVALID_RESPONSE");
  const parts: string[] = raw.split("/");
  const builtInCollection = allowBuiltInCollection && parts.length % 2 === 1 && parts[parts.length - 1] === "built_in_variables";
  if ((!builtInCollection && parts.length % 2 !== 0) || parts.some((part, index) => index % 2 === 0 ? !part : !/^[A-Za-z0-9_-]+$/.test(part))) fail("GTM_UPSTREAM_INVALID_RESPONSE");
  return parts;
}
function validateResourceName(value: Record<string, unknown>, kind: "account" | "container" | "workspace" | "tag" | "trigger" | "variable" | "version", scope: { accountId?: string; containerId?: string; workspaceId?: string; objectId?: string }): void {
  const required = kind === "account" ? ["accountId", "path"] :
    kind === "container" ? ["containerId", "path"] :
    kind === "workspace" ? ["workspaceId", "path"] :
    kind === "tag" ? ["tagId", "path", "type"] :
    kind === "trigger" ? ["triggerId", "path", "type"] :
    kind === "variable" ? ["variableId", "path", "type"] :
    ["containerVersionId", "path"];
  if (required.some(field => typeof value[field] !== "string" || value[field] === "")) fail("GTM_UPSTREAM_INVALID_RESPONSE");
  if (value.name !== undefined && typeof value.name !== "string") fail("GTM_UPSTREAM_INVALID_RESPONSE");
  const parts = canonicalSegments(value.path);
  const expected = kind === "account" ? ["accounts", scope.accountId] :
    kind === "container" ? ["accounts", scope.accountId, "containers", scope.containerId] :
    kind === "workspace" ? ["accounts", scope.accountId, "containers", scope.containerId, "workspaces", scope.workspaceId] :
    kind === "version" ? ["accounts", scope.accountId, "containers", scope.containerId, "versions", scope.objectId] :
    ["accounts", scope.accountId, "containers", scope.containerId, "workspaces", scope.workspaceId, `${kind}s`, scope.objectId];
  if (parts.length !== expected.length || expected.some((part, index) => part !== undefined && parts[index] !== part)) fail("GTM_RESOURCE_IDENTITY_MISMATCH");
  const terminalField = kind === "tag" ? "tagId" : kind === "trigger" ? "triggerId" : kind === "variable" ? "variableId" : kind === "account" ? "accountId" : kind === "container" ? "containerId" : kind === "workspace" ? "workspaceId" : "containerVersionId";
  if (typeof value[terminalField] !== "string" || value[terminalField] !== parts[parts.length - 1]) fail("GTM_RESOURCE_IDENTITY_MISMATCH");
}
const STATUS_ENTITY_FIELDS = ["tag", "trigger", "variable", "folder", "client", "transformation", "zone", "customTemplate", "builtInVariable", "gtagConfig"] as const;
const STATUS_ENTITY_COLLECTIONS: Readonly<Record<(typeof STATUS_ENTITY_FIELDS)[number], string>> = Object.freeze({
  tag: "tags", trigger: "triggers", variable: "variables", folder: "folders",
  client: "clients", transformation: "transformations", zone: "zones",
  customTemplate: "templates", builtInVariable: "built_in_variables", gtagConfig: "gtag_config",
});
const STATUS_CHANGE_STATES = new Set(["changeStatusUnspecified", "none", "added", "deleted", "updated"]);
const STATUS_ENTITY_ID_FIELDS: Readonly<Record<(typeof STATUS_ENTITY_FIELDS)[number], string | null>> = Object.freeze({
  tag: "tagId", trigger: "triggerId", variable: "variableId", folder: "folderId",
  client: "clientId", transformation: "transformationId", zone: "zoneId",
  customTemplate: "templateId", builtInVariable: null, gtagConfig: "gtagConfigId",
});
function validateStatusEntity(value: unknown, scope: { accountId?: string; containerId?: string; workspaceId?: string }, allowBaseVersion = false): void {
  if (!record(value)) fail("GTM_UPSTREAM_INVALID_RESPONSE");
  const entity = value as Record<string, unknown>;
  if (entity.changeStatus != null && (typeof entity.changeStatus !== "string" || !STATUS_CHANGE_STATES.has(entity.changeStatus))) fail("GTM_UPSTREAM_INVALID_RESPONSE");
  const fields = STATUS_ENTITY_FIELDS.filter(field => entity[field] !== undefined);
  if (fields.length !== 1 || !record(entity[fields[0]])) fail("GTM_UPSTREAM_INVALID_RESPONSE");
  const resource = entity[fields[0]] as Record<string, unknown>;
  const builtIn = fields[0] === "builtInVariable";
  const parts = canonicalSegments(resource.path, builtIn);
  if (parts.length !== (builtIn ? 7 : 8)) fail("GTM_RESOURCE_IDENTITY_MISMATCH");
  const inRequestedWorkspace = parts[4] === "workspaces" && parts[5] === scope.workspaceId;
  const inBaseVersion = parts[4] === "versions";
  if (parts[0] !== "accounts" || parts[1] !== scope.accountId ||
      parts[2] !== "containers" || parts[3] !== scope.containerId ||
      (allowBaseVersion ? !inBaseVersion : !inRequestedWorkspace)) fail("GTM_RESOURCE_IDENTITY_MISMATCH");
  const collection = STATUS_ENTITY_COLLECTIONS[fields[0]];
  if (parts[builtIn ? parts.length - 1 : parts.length - 2] !== collection) fail("GTM_RESOURCE_IDENTITY_MISMATCH");
  const idField = STATUS_ENTITY_ID_FIELDS[fields[0]];
  if (idField !== null) {
    if (typeof resource[idField] !== "string" || resource[idField] === "") fail("GTM_UPSTREAM_INVALID_RESPONSE");
    if (resource[idField] !== parts[parts.length - 1]) fail("GTM_RESOURCE_IDENTITY_MISMATCH");
  }
}
function parseResponse(operation: string, value: unknown, scope: { accountId?: string; containerId?: string; workspaceId?: string; objectId?: string }): Record<string, unknown> {
  const result = body(value);
  const key = COLLECTION_KEYS[operation];
  const baseKind = operation.startsWith("tags") ? "tag" : operation.startsWith("triggers") ? "trigger" : operation.startsWith("variables") ? "variable" : operation === "versions" ? "version" : operation === "accounts" ? "account" : operation === "containers" ? "container" : "workspace";
  if (key) {
    if (result[key] !== undefined && !Array.isArray(result[key])) fail("GTM_UPSTREAM_INVALID_RESPONSE");
    const items = result[key] === undefined ? [] : result[key] as unknown[];
    for (const item of items) {
      if (!record(item)) fail("GTM_UPSTREAM_INVALID_RESPONSE");
      validateResourceName(item as Record<string, unknown>, baseKind as never, scope);
    }
  } else if (operation.endsWith("-get")) {
    validateResourceName(result, baseKind as never, scope);
  } else if (operation === "workspace-status") {
    if (result.workspaceChange !== undefined) {
      if (!Array.isArray(result.workspaceChange)) fail("GTM_UPSTREAM_INVALID_RESPONSE");
      (result.workspaceChange as unknown[]).forEach(entity => validateStatusEntity(entity, scope));
    }
    if (result.workspace !== undefined) {
      if (!record(result.workspace)) fail("GTM_UPSTREAM_INVALID_RESPONSE");
      validateResourceName(result.workspace as Record<string, unknown>, "workspace", scope);
    }
    if (result.mergeConflict !== undefined) {
      if (!Array.isArray(result.mergeConflict)) fail("GTM_UPSTREAM_INVALID_RESPONSE");
      for (const conflict of result.mergeConflict as unknown[]) {
        if (!record(conflict)) fail("GTM_UPSTREAM_INVALID_RESPONSE");
        const item = conflict as Record<string, unknown>;
        if (item.entityInWorkspace === undefined) fail("GTM_UPSTREAM_INVALID_RESPONSE");
        validateStatusEntity(item.entityInWorkspace, scope);
        if (item.entityInBaseVersion !== undefined) validateStatusEntity(item.entityInBaseVersion, scope, true);
      }
    }
  }
  assertIdentity(result, scope);
  return result;
}
const OPERATION_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  accounts: ["userId", "connectionId", "generation", "pageToken"],
  containers: ["userId", "connectionId", "generation", "accountId", "pageToken"],
  workspaces: ["userId", "connectionId", "generation", "accountId", "containerId", "pageToken"],
  "workspace-status": ["userId", "connectionId", "generation", "accountId", "containerId", "workspaceId"],
  tags: ["userId", "connectionId", "generation", "accountId", "containerId", "workspaceId", "pageToken"],
  "tags-get": ["userId", "connectionId", "generation", "accountId", "containerId", "workspaceId", "objectId"],
  triggers: ["userId", "connectionId", "generation", "accountId", "containerId", "workspaceId", "pageToken"],
  "triggers-get": ["userId", "connectionId", "generation", "accountId", "containerId", "workspaceId", "objectId"],
  variables: ["userId", "connectionId", "generation", "accountId", "containerId", "workspaceId", "pageToken"],
  "variables-get": ["userId", "connectionId", "generation", "accountId", "containerId", "workspaceId", "objectId"],
  versions: ["userId", "connectionId", "generation", "accountId", "containerId", "pageToken"],
});
const GET_OPERATIONS = new Set(["tags-get", "triggers-get", "variables-get"]);
const NON_PAGINATED_OPERATIONS = new Set(["tags-get", "triggers-get", "variables-get", "workspace-status"]);
function assertIdentity(value: unknown, scope: Record<string, string>): void {
  if (Array.isArray(value)) { value.forEach(v => assertIdentity(v, scope)); return; }
  if (!record(value)) return;
  if (typeof value.path === "string") {
    const parts = canonicalSegments(value.path, true);
    const prefix = scope.containerId ? ["accounts", scope.accountId, "containers", scope.containerId]
      : scope.accountId ? ["accounts", scope.accountId] : [];
    if (prefix.some((part, index) => parts[index] !== part)) fail("GTM_RESOURCE_IDENTITY_MISMATCH");
    if (scope.workspaceId && parts[4] === "workspaces" && parts[5] !== scope.workspaceId) {
      fail("GTM_RESOURCE_IDENTITY_MISMATCH");
    }
  }
  for (const [key, expected] of Object.entries(scope)) {
    if (value[key] !== undefined && value[key] !== expected) fail("GTM_RESOURCE_IDENTITY_MISMATCH");
  }
  Object.values(value).forEach(child => { if (record(child) || Array.isArray(child)) assertIdentity(child, scope); });
}

export function createGtmReadService(input: {
  oauth: GtmReadOAuth; repository: GtmReadRepository; transport: GtmReadTransport; now?: () => number;
}) {
  const now = input.now ?? Date.now;
  async function read(operation: string, i: GtmReadInput): Promise<GtmReadResult> {
    const allowed = OPERATION_FIELDS[operation];
    if (!allowed || !record(i) || Object.keys(i).some(key => !allowed.includes(key) && !(GET_OPERATIONS.has(operation) && key === "objectId"))) fail("GTM_INVALID_INPUT");
    if (GET_OPERATIONS.has(operation) && (typeof i.objectId !== "string" || i.objectId.length === 0)) fail("GTM_INVALID_INPUT");
    if (!GET_OPERATIONS.has(operation) && i.objectId !== undefined) fail("GTM_INVALID_INPUT");
    const userId = string(i.userId), connectionId = string(i.connectionId);
    if (!Number.isSafeInteger(i.generation) || i.generation < 0) fail("GTM_INVALID_INPUT");
    const accountId = i.accountId === undefined ? undefined : id(i.accountId);
    const containerId = i.containerId === undefined ? undefined : id(i.containerId);
    const workspaceId = i.workspaceId === undefined ? undefined : id(i.workspaceId);
    const baseOperation = operation.replace(/-get$/, "");
    if (baseOperation !== "accounts" && accountId === undefined) fail("GTM_INVALID_INPUT");
    if (["workspaces", "workspace-status", "tags", "triggers", "variables", "versions"].includes(baseOperation) &&
      containerId === undefined) fail("GTM_INVALID_INPUT");
    if (["workspace-status", "tags", "triggers", "variables"].includes(baseOperation) &&
      workspaceId === undefined) fail("GTM_INVALID_INPUT");
    try {
    const credential = await input.oauth.refreshCredential({ userId, connectionId, generation: i.generation });
    if (credential.connection.userId !== userId || credential.connection.connectionId !== connectionId ||
      credential.connection.generation !== i.generation ||
      !credential.grantedScopes.includes(GTM_READONLY_SCOPE)) fail("GTM_CONNECTION_REJECTED");
    if (!await input.repository.isResultEligible({ userId, connectionId, generation: i.generation })) fail("GTM_CONNECTION_REJECTED");
    const paths: Record<string, string> = {
      accounts: "/accounts",
      containers: `/accounts/${accountId}/containers`,
      workspaces: `/accounts/${accountId}/containers/${containerId}/workspaces`,
      "workspace-status": `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/status`,
      tags: `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/tags`,
      triggers: `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/triggers`,
      variables: `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/variables`,
      versions: `/accounts/${accountId}/containers/${containerId}/version_headers`,
    };
    let path = paths[operation] ?? paths[baseOperation]; if (path === undefined) fail("GTM_INVALID_INPUT");
    if (i.objectId !== undefined) path += `/${id(i.objectId)}`;
    const url = new URL(`${GTM_API_ENDPOINT}${path}`);
    if (i.pageToken !== undefined) url.searchParams.set("pageToken", string(i.pageToken));
    let response: Readonly<{ status: number; body: unknown }>;
    try {
      response = await input.transport.request({ url: url.toString(), accessToken: credential.accessToken });
    } catch (error) {
      if (!await input.repository.isResultEligible({ userId, connectionId, generation: i.generation })) fail("GTM_CONNECTION_REJECTED");
      throw error;
    }
    if (!await input.repository.isResultEligible({ userId, connectionId, generation: i.generation })) fail("GTM_CONNECTION_REJECTED");
    try {
      if (response.status === 404) fail("GTM_RESOURCE_NOT_FOUND");
      if (response.status < 200 || response.status >= 300) fail("GTM_UPSTREAM_REJECTED");
      const result = parseResponse(operation, response.body, { ...(accountId ? { accountId } : {}), ...(containerId ? { containerId } : {}), ...(workspaceId ? { workspaceId } : {}), ...(i.objectId ? { objectId: id(i.objectId) } : {}) });
      const output = Object.freeze({ userId, connectionId, generation: i.generation, data: result,
      source: "google_tag_manager" as const, fetchedAt: new Date(now()).toISOString(),
       queryScope: Object.freeze({ operation: baseOperation, ...(accountId ? { accountId } : {}),
        ...(containerId ? { containerId } : {}), ...(workspaceId ? { workspaceId } : {}),
       ...(i.objectId ? { objectId: id(i.objectId) } : {}) }),
       pagination: NON_PAGINATED_OPERATIONS.has(operation)
         ? (result.nextPageToken !== undefined ? fail("GTM_UPSTREAM_INVALID_RESPONSE") : { nextPageToken: null, complete: true, automatic: false as const })
         : page(result) });
      if (!await input.repository.isResultEligible({ userId, connectionId, generation: i.generation })) fail("GTM_CONNECTION_REJECTED");
      return output;
    } catch (error) {
      if (!await input.repository.isResultEligible({ userId, connectionId, generation: i.generation })) fail("GTM_CONNECTION_REJECTED");
      throw error;
    }
    } catch (error) {
      if (!await input.repository.isResultEligible({ userId, connectionId, generation: i.generation })) fail("GTM_CONNECTION_REJECTED");
      throw error;
    }
  }
  return Object.freeze({
    listAccounts: (i: GtmReadInput) => read("accounts", i),
    listContainers: (i: GtmReadInput) => read("containers", i),
    listWorkspaces: (i: GtmReadInput) => read("workspaces", i),
    getWorkspaceStatus: (i: GtmReadInput) => read("workspace-status", i),
    listTags: (i: GtmReadInput) => read("tags", i),
    getTag: (i: GtmReadInput) => read("tags-get", i),
    listTriggers: (i: GtmReadInput) => read("triggers", i),
    getTrigger: (i: GtmReadInput) => read("triggers-get", i),
    listVariables: (i: GtmReadInput) => read("variables", i),
    getVariable: (i: GtmReadInput) => read("variables-get", i),
    listContainerVersionHeaders: (i: GtmReadInput) => read("versions", i),
  });
}
