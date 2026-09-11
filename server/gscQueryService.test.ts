import assert from "node:assert/strict";
import test from "node:test";
import {
  GSC_OPERATION_TIMEOUT_MS,
  GSC_READONLY_SCOPE,
  GscOAuthError,
  createGscOAuthService,
  createGscOperationDeadline,
  createGscUpstreamTransport,
  type GscOAuthService,
  type GscOperationDeadline,
  type GscUpstreamTransport,
} from "./gscOAuth";
import {
  GSC_CREDENTIAL_FORMAT_VERSION,
  createGscCredentialService,
} from "./gscCredentialService";
import type {
  GscActiveCredentialRecord,
  GscRepository,
} from "./gscRepository";
import {
  GSC_SITES_ENDPOINT,
  GSC_URL_INSPECTION_ENDPOINT,
  GscQueryError,
  createGscQueryService,
  type GscComparePeriodsInput,
  type GscQueryErrorCode,
  type GscQueryService,
  type GscSearchAnalyticsInput,
} from "./gscQueryService";

const NOW_MS = 1_800_000_000_000;
const USER_ID = "member-a";
const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
const GENERATION = 3;
const ACCESS_TOKEN = "request-local-token-a";
const SITE_URL = "https://example.test/blog/";
const DOMAIN_SITE = "sc-domain:example.test";

type RecordedRequest = Parameters<GscUpstreamTransport["request"]>[0];

function operationDeadline(nowMs = NOW_MS): GscOperationDeadline {
  return createGscOperationDeadline(nowMs);
}

function activeConnection(
  userId = USER_ID,
  connectionId = CONNECTION_ID,
  generation = GENERATION,
): GscActiveCredentialRecord {
  return Object.freeze({
    userId,
    connectionId,
    googleClientId: "synthetic-query-client.apps.example.test",
    googleSubjectHash: "synthetic-subject-hash",
    credentialEnvelope: Object.freeze({
      version: 1 as const,
      algorithm: "aes-256-gcm" as const,
      nonce: "AA",
      ciphertext: "AA",
      authTag: "AA",
    }),
    status: "active" as const,
    generation,
    createdAt: new Date(NOW_MS - 1_000),
    updatedAt: new Date(NOW_MS - 1_000),
  });
}

function assertQueryError(expectedCode: GscQueryErrorCode) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof GscQueryError);
    assert.equal(error.code, expectedCode);
    return true;
  };
}

function harness(input: Readonly<{
  target?: (request: RecordedRequest, index: number) => Promise<Readonly<{
    status: number;
    body: unknown;
  }>>;
  sites?: unknown;
  eligible?: readonly boolean[];
  refreshed?: Readonly<{
    userId?: string;
    connectionId?: string;
    generation?: number;
    status?: GscActiveCredentialRecord["status"];
    accessToken?: string;
  }>;
  now?: () => number;
}> = {}) {
  const requests: RecordedRequest[] = [];
  const refreshInputs: Array<Parameters<GscOAuthService["refreshCredential"]>[0]> = [];
  const eligibilityInputs: Array<{
    userId: string;
    connectionId: string;
    generation: number;
  }> = [];
  const eligible = [...(input.eligible ?? [])];
  let targetIndex = 0;
  const oauth: Pick<GscOAuthService, "refreshCredential"> = {
    refreshCredential: async (refreshInput) => {
      refreshInputs.push(refreshInput);
      const connection = activeConnection(
        input.refreshed?.userId ?? refreshInput.userId,
        input.refreshed?.connectionId ?? refreshInput.connectionId,
        input.refreshed?.generation ?? refreshInput.generation,
      );
      return Object.freeze({
        connection: Object.freeze({
          ...connection,
          status: input.refreshed?.status ?? "active",
        }) as GscActiveCredentialRecord,
        accessToken: input.refreshed?.accessToken ?? ACCESS_TOKEN,
        grantedScopes: Object.freeze([
          "openid",
          "email",
          "https://www.googleapis.com/auth/webmasters.readonly",
        ]),
      });
    },
  };
  const transport: GscUpstreamTransport = Object.freeze({
    request: async (request) => {
      requests.push(request);
      if (request.url === GSC_SITES_ENDPOINT) {
        return Object.freeze({
          status: 200,
          body: input.sites ?? {
            siteEntry: [{ siteUrl: SITE_URL, permissionLevel: "siteOwner" }],
          },
        });
      }
      if (!input.target) {
        throw new Error(`Unexpected target request: ${request.url}`);
      }
      return input.target(request, targetIndex++);
    },
  });
  const service = createGscQueryService({
    oauth,
    repository: {
      isResultEligible: async (eligibilityInput) => {
        eligibilityInputs.push(eligibilityInput);
        return eligible.length === 0 ? true : eligible.shift()!;
      },
    },
    transport,
    now: input.now ?? (() => NOW_MS),
  });
  return { service, requests, refreshInputs, eligibilityInputs };
}

function baseInput(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
    deadline: operationDeadline(),
    ...overrides,
  };
}

function searchInput(
  overrides: Readonly<Record<string, unknown>> = {},
): GscSearchAnalyticsInput {
  return {
    ...baseInput(),
    siteUrl: SITE_URL,
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    ...overrides,
  } as GscSearchAnalyticsInput;
}

function compareInput(
  overrides: Readonly<Record<string, unknown>> = {},
): GscComparePeriodsInput {
  return {
    ...baseInput(),
    siteUrl: SITE_URL,
    periodA: { startDate: "2026-08-01", endDate: "2026-08-07" },
    periodB: { startDate: "2026-08-08", endDate: "2026-08-14" },
    dimensions: ["query"],
    ...overrides,
  } as GscComparePeriodsInput;
}

function requestBody(request: RecordedRequest): Record<string, unknown> {
  assert.equal(typeof request.body, "string");
  return JSON.parse(request.body) as Record<string, unknown>;
}

test("listSites refreshes the exact owner and returns only current verified permissions", async () => {
  const fixture = harness({
    sites: {
      siteEntry: [
        { siteUrl: SITE_URL, permissionLevel: "siteOwner" },
        { siteUrl: DOMAIN_SITE, permissionLevel: "SITE_FULL_USER" },
        { siteUrl: "https://restricted.example.test/", permissionLevel: "SITE_RESTRICTED_USER" },
        { siteUrl: "https://unverified.example.test/", permissionLevel: "siteUnverifiedUser" },
        { siteUrl: "https://unspecified.example.test/", permissionLevel: "SITE_PERMISSION_LEVEL_UNSPECIFIED" },
      ],
    },
  });
  const input = baseInput();

  const result = await fixture.service.listSites(input);

  assert.deepEqual(result.sites, [
    { siteUrl: SITE_URL, permission: "siteOwner" },
    { siteUrl: DOMAIN_SITE, permission: "siteFullUser" },
    { siteUrl: "https://restricted.example.test/", permission: "siteRestrictedUser" },
  ]);
  assert.deepEqual(fixture.refreshInputs, [{
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
    deadline: input.deadline,
  }]);
  assert.deepEqual(fixture.eligibilityInputs, [{
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    generation: GENERATION,
  }]);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].url, GSC_SITES_ENDPOINT);
  assert.equal(fixture.requests[0].headers?.authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(JSON.stringify(result).includes(ACCESS_TOKEN), false);
});

test("malformed and unknown site permissions fail instead of returning a partial list", async () => {
  for (const permissionLevel of [123, "futurePermission", null]) {
    const fixture = harness({
      sites: {
        siteEntry: [
          { siteUrl: SITE_URL, permissionLevel: "siteOwner" },
          { siteUrl: "https://bad.example.test/", permissionLevel },
        ],
      },
    });
    await assert.rejects(
      fixture.service.listSites(baseInput()),
      assertQueryError("GSC_QUERY_INVALID_RESPONSE"),
    );
  }
  const nullList = harness({ sites: { siteEntry: null } });
  await assert.rejects(
    nullList.service.listSites(baseInput()),
    assertQueryError("GSC_QUERY_INVALID_RESPONSE"),
  );
  const duplicate = harness({
    sites: { siteEntry: [
      { siteUrl: SITE_URL, permissionLevel: "SITE_OWNER" },
      { siteUrl: SITE_URL, permissionLevel: "SITE_RESTRICTED_USER" },
    ] },
  });
  await assert.rejects(
    duplicate.service.listSites(baseInput()),
    assertQueryError("GSC_QUERY_INVALID_RESPONSE"),
  );
});

test("a refresh result with another owner identity is rejected before Google", async () => {
  const fixture = harness({ refreshed: { userId: "member-b" } });
  await assert.rejects(
    fixture.service.listSites(baseInput()),
    assertQueryError("GSC_QUERY_REJECTED"),
  );
  assert.equal(fixture.requests.length, 0);
});

test("an owner rejection from OAuth reaches no Google endpoint", async () => {
  let requestCount = 0;
  const service = createGscQueryService({
    oauth: {
      refreshCredential: async () => {
        throw new GscOAuthError("GSC_OAUTH_REJECTED");
      },
    },
    repository: { isResultEligible: async () => true },
    transport: {
      request: async () => {
        requestCount += 1;
        return { status: 200, body: {} };
      },
    },
    now: () => NOW_MS,
  });
  await assert.rejects(
    service.listSites(baseInput()),
    (error: unknown) => error instanceof GscOAuthError && error.code === "GSC_OAUTH_REJECTED",
  );
  assert.equal(requestCount, 0);
});

test("searchAnalytics sends the documented query and preserves rows, freshness, and page limits", async () => {
  const fixture = harness({
    target: async () => ({
      status: 200,
      body: {
        rows: [{ keys: ["2026-08-06", "alpha", "USA"], clicks: 2, impressions: 10, ctr: 0.2 }],
        responseAggregationType: "byProperty",
        metadata: { firstIncompleteDate: "2026-08-06" },
      },
    }),
  });
  const input = searchInput({
    dimensions: ["date", "query", "country"],
    filters: [{ dimension: "query", operator: "contains", expression: "alpha" }],
    searchType: "googleNews",
    dataState: "all",
    rowLimit: 200,
    startRow: 20,
  });

  const result = await fixture.service.searchAnalytics(input);

  assert.equal(fixture.requests.length, 2);
  assert.equal(
    fixture.requests[1].url,
    `${GSC_SITES_ENDPOINT}/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
  );
  assert.deepEqual(requestBody(fixture.requests[1]), {
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    dimensions: ["date", "query", "country"],
    type: "googleNews",
    dataState: "all",
    rowLimit: 200,
    startRow: 20,
    dimensionFilterGroups: [{
      groupType: "and",
      filters: [{ dimension: "query", operator: "contains", expression: "alpha" }],
    }],
  });
  assert.deepEqual(result.rows, [
    { keys: ["2026-08-06", "alpha", "USA"], clicks: 2, impressions: 10, ctr: 0.2 },
  ]);
  assert.deepEqual(result.freshness, {
    dataState: "all",
    status: "incomplete_from_date",
    firstIncompleteDate: "2026-08-06",
    timeZone: "America/Los_Angeles",
  });
  assert.deepEqual(result.completeness, {
    returnedRowCount: 1,
    rowLimit: 200,
    startRow: 20,
    pageMayBePartial: true,
    googleMayOmitRows: true,
    automaticPagination: false,
  });
  assert.equal(result.responseAggregationType, "byProperty");
  assert.equal(result.rows[0].position, undefined);
});

test("searchAnalytics applies bounded defaults and does not claim all-state data is final without metadata", async () => {
  const fixture = harness({
    target: async () => ({ status: 200, body: {} }),
  });
  const result = await fixture.service.searchAnalytics(searchInput({
    dataState: "all",
    dimensions: ["date"],
  }));
  assert.deepEqual(requestBody(fixture.requests[1]), {
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    dimensions: ["date"],
    type: "web",
    dataState: "all",
    rowLimit: 100,
    startRow: 0,
  });
  assert.deepEqual(result.rows, []);
  assert.equal(result.freshness.status, "not_confirmed");
  assert.equal(result.completeness.googleMayOmitRows, true);
  assert.equal(result.completeness.automaticPagination, false);
});

test("searchAnalytics accepts the documented snake-case freshness field", async () => {
  const fixture = harness({
    target: async () => ({
      status: 200,
      body: { metadata: { first_incomplete_date: "2026-08-05" } },
    }),
  });
  const result = await fixture.service.searchAnalytics(searchInput({
    dataState: "all",
    dimensions: ["date"],
  }));
  assert.equal(result.freshness.status, "incomplete_from_date");
  assert.equal(result.freshness.firstIncompleteDate, "2026-08-05");

  const malformed = harness({
    target: async () => ({
      status: 200,
      body: { metadata: { firstIncompleteDate: "2026-02-30" } },
    }),
  });
  await assert.rejects(
    malformed.service.searchAnalytics(searchInput({
      dataState: "all",
      dimensions: ["date"],
    })),
    assertQueryError("GSC_QUERY_INVALID_RESPONSE"),
  );

  const inconsistent = harness({
    target: async () => ({
      status: 200,
      body: { metadata: { firstIncompleteDate: "2026-08-05" } },
    }),
  });
  await assert.rejects(
    inconsistent.service.searchAnalytics(searchInput({ dataState: "all" })),
    assertQueryError("GSC_QUERY_INVALID_RESPONSE"),
  );
});

test("unsupported query shapes reject before refresh or Google", async () => {
  const cases: Array<Record<string, unknown>> = [
    { startDate: "2026-02-30" },
    { startDate: "2026-08-08", endDate: "2026-08-07" },
    { dimensions: ["query", "query"] },
    { dimensions: ["hour"] },
    { filters: [{ dimension: "date", operator: "equals", expression: "2026-08-01" }] },
    { filters: [{ dimension: "query", operator: "startsWith", expression: "a" }] },
    { filters: [{ dimension: "query", operator: "equals", expression: "" }] },
    { searchType: "shopping" },
    { dataState: "hourly_all" },
    { rowLimit: 0 },
    { rowLimit: 1001 },
    { startRow: -1 },
  ];
  for (const value of cases) {
    const fixture = harness();
    await assert.rejects(
      fixture.service.searchAnalytics(searchInput(value)),
      assertQueryError("GSC_QUERY_INVALID_INPUT"),
    );
    assert.equal(fixture.refreshInputs.length, 0);
    assert.equal(fixture.requests.length, 0);
  }
});

test("an absent or unverified exact property stops before the target request", async () => {
  for (const sites of [
    { siteEntry: [{ siteUrl: "https://other.example.test/", permissionLevel: "siteOwner" }] },
    { siteEntry: [{ siteUrl: SITE_URL, permissionLevel: "SITE_UNVERIFIED_USER" }] },
  ]) {
    const fixture = harness({ sites });
    await assert.rejects(
      fixture.service.searchAnalytics(searchInput()),
      assertQueryError("GSC_QUERY_REJECTED"),
    );
    assert.equal(fixture.requests.length, 1);
  }
});

test("eligibility is checked before and after each target request", async () => {
  const before = harness({ eligible: [false] });
  await assert.rejects(
    before.service.searchAnalytics(searchInput()),
    assertQueryError("GSC_QUERY_REJECTED"),
  );
  assert.equal(before.requests.length, 1);

  const after = harness({
    eligible: [true, false],
    target: async () => ({ status: 200, body: { rows: [] } }),
  });
  await assert.rejects(
    after.service.searchAnalytics(searchInput()),
    assertQueryError("GSC_QUERY_REJECTED"),
  );
  assert.equal(after.requests.length, 2);
});

test("parallel members keep their refresh credentials, HTTP authorization, and results request-local", async () => {
  const seen: Array<{ userId: string; authorization: string | undefined }> = [];
  const service = createGscQueryService({
    oauth: {
      refreshCredential: async (input) => ({
        connection: activeConnection(input.userId, input.connectionId, input.generation),
        accessToken: `token-${input.userId}`,
        grantedScopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
      }),
    },
    repository: { isResultEligible: async () => true },
    transport: {
      request: async (request) => {
        const authorization = request.headers?.authorization;
        if (request.url === GSC_SITES_ENDPOINT) {
          const userId = authorization?.slice("Bearer token-".length) ?? "";
          return {
            status: 200,
            body: { siteEntry: [{ siteUrl: SITE_URL, permissionLevel: "SITE_OWNER" }], userId },
          };
        }
        const userId = authorization?.slice("Bearer token-".length) ?? "";
        seen.push({ userId, authorization });
        return { status: 200, body: { rows: [{ keys: [userId], clicks: 1 }] } };
      },
    },
    now: () => NOW_MS,
  });
  const [a, b] = await Promise.all([
    service.searchAnalytics(searchInput({ dimensions: ["query"] })),
    service.searchAnalytics(searchInput({
      userId: "member-b",
      connectionId: "22222222-2222-4222-8222-222222222222",
      dimensions: ["query"],
    })),
  ]);
  assert.deepEqual(a.rows[0].keys, ["member-a"]);
  assert.deepEqual(b.rows[0].keys, ["member-b"]);
  assert.deepEqual(seen, [
    { userId: "member-a", authorization: "Bearer token-member-a" },
    { userId: "member-b", authorization: "Bearer token-member-b" },
  ]);
});

test("comparePeriods uses the same conditions and page for both periods", async () => {
  const fixture = harness({
    target: async () => ({ status: 200, body: { rows: [] } }),
  });
  await fixture.service.comparePeriods(compareInput({
    rowLimit: 100,
    startRow: 20,
    periodA: { startDate: "2026-08-01", endDate: "2026-08-07", rowLimit: 1 },
    periodB: { startDate: "2026-08-08", endDate: "2026-08-14", rowLimit: 2 },
  }));
  assert.equal(requestBody(fixture.requests[1]).rowLimit, 100);
  assert.equal(requestBody(fixture.requests[1]).startRow, 20);
  assert.equal(requestBody(fixture.requests[3]).rowLimit, 100);
  assert.equal(requestBody(fixture.requests[3]).startRow, 20);
});

test("comparePeriods pairs actual rows by keys and preserves missing and zero-baseline evidence", async () => {
  const fixture = harness({
    target: async (_request, index) => index === 0
      ? {
        status: 200,
        body: { rows: [
          { keys: ["both"], clicks: 0, impressions: 10, ctr: 0.2, position: 3 },
          { keys: ["a-only"], clicks: 5 },
        ] },
      }
      : {
        status: 200,
        body: { rows: [
          { keys: ["b-only"], clicks: 7 },
          { keys: ["both"], clicks: 4, impressions: 15, ctr: 0.3, position: 5 },
        ] },
      },
  });
  const result = await fixture.service.comparePeriods(compareInput());
  assert.deepEqual(result.rows.map((row) => row.keys[0]), ["a-only", "b-only", "both"]);
  assert.equal(result.rows[0].presence, "period_a_only");
  assert.equal(result.rows[0].periodB, null);
  assert.equal(result.rows[0].changes, null);
  assert.equal(result.rows[1].presence, "period_b_only");
  const both = result.rows[2];
  assert.equal(both.changes?.clicks.differenceBMinusA, 4);
  assert.equal(both.changes?.clicks.relativeChangeFromA, null);
  assert.equal(both.changes?.clicks.relativeChangeReason, "baseline_zero");
  assert.equal(both.changes?.impressions.differenceBMinusA, 5);
  assert.equal(both.changes?.impressions.relativeChangeFromA, 0.5);
  assert.ok(Math.abs((both.changes?.ctrPercentagePoints ?? 0) - 10) < 1e-12);
  assert.equal(both.changes?.positionBMinusA, 2);
  assert.deepEqual(result.periodA.query, {
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    dimensions: ["query"],
    filters: [],
    searchType: "web",
    dataState: "final",
    rowLimit: 100,
    startRow: 0,
  });
  assert.equal(result.limitations.comparesOnePagePerPeriod, true);
  assert.equal(result.limitations.missingRowsAreNotZero, true);
  assert.equal(result.limitations.notAWholeSiteLargestDecline, true);
});

test("comparePeriods rejects unequal or overlapping periods before refresh", async () => {
  const periods = [
    {
      periodA: { startDate: "2026-08-01", endDate: "2026-08-07" },
      periodB: { startDate: "2026-08-08", endDate: "2026-08-15" },
    },
    {
      periodA: { startDate: "2026-08-01", endDate: "2026-08-07" },
      periodB: { startDate: "2026-08-07", endDate: "2026-08-13" },
    },
  ];
  for (const value of periods) {
    const fixture = harness();
    await assert.rejects(
      fixture.service.comparePeriods(compareInput(value)),
      assertQueryError("GSC_QUERY_INVALID_INPUT"),
    );
    assert.equal(fixture.refreshInputs.length, 0);
  }
});

test("a failed comparison period returns no partial comparison and is not retried", async () => {
  let targets = 0;
  const fixture = harness({
    target: async () => {
      targets += 1;
      return targets === 1
        ? { status: 200, body: { rows: [] } }
        : { status: 503, body: { error: "unavailable" } };
    },
  });
  await assert.rejects(
    fixture.service.comparePeriods(compareInput()),
    assertQueryError("GSC_QUERY_UPSTREAM_REJECTED"),
  );
  assert.equal(targets, 2);
});

test("inspectUrl uses the fixed index endpoint and marks the result as neither live nor submitted", async () => {
  const fixture = harness({
    target: async () => ({
      status: 200,
      body: {
        inspectionResult: {
          inspectionResultLink: "https://search.google.com/search-console/inspect/example",
          indexStatusResult: {
            verdict: "PASS",
            coverageState: "Indexed",
            lastCrawlTime: "2014-10-02T15:01:23.045123456Z",
          },
          ampResult: {
            verdict: "PASS",
            lastCrawlTime: "2026-08-01T01:02:03.456Z",
            issues: [{ severity: "WARNING", issueMessage: "Synthetic AMP warning" }],
          },
          richResultsResult: {
            verdict: "PASS",
            detectedItems: [{
              richResultType: "Article",
              items: [{
                name: "Synthetic article",
                issues: [{ severity: "WARNING", issueMessage: "Synthetic rich issue" }],
              }],
            }],
          },
          mobileUsabilityResult: {
            verdict: "PASS",
            issues: [{
              issueType: "CONFIGURE_VIEWPORT",
              severity: "WARNING",
              message: "Synthetic mobile issue",
            }],
          },
        },
      },
    }),
  });
  const result = await fixture.service.inspectUrl({
    ...baseInput(),
    siteUrl: SITE_URL,
    inspectionUrl: "https://example.test/blog/article",
  });
  assert.equal(fixture.requests[1].url, GSC_URL_INSPECTION_ENDPOINT);
  assert.deepEqual(requestBody(fixture.requests[1]), {
    inspectionUrl: "https://example.test/blog/article",
    siteUrl: SITE_URL,
  });
  assert.equal(result.isLiveTest, false);
  assert.equal(result.submittedForIndexing, false);
  assert.deepEqual(result.inspectionResult.indexStatusResult, {
    verdict: "PASS",
    coverageState: "Indexed",
    lastCrawlTime: "2014-10-02T15:01:23.045123456Z",
  });
});

test("inspectUrl rejects malformed documented result sections instead of returning partial success", async () => {
  for (const inspectionResult of [
    { indexStatusResult: 123 },
    { inspectionResultLink: 123 },
    { ampResult: [] },
    { richResultsResult: "bad" },
    { mobileUsabilityResult: false },
    { indexStatusResult: { verdict: 123 } },
    { indexStatusResult: { googleCanonical: false } },
    { indexStatusResult: { sitemap: [123] } },
    { indexStatusResult: { lastCrawlTime: "not-a-google-datetime" } },
    { indexStatusResult: { lastCrawlTime: "2026-02-30T00:00:00Z" } },
    { indexStatusResult: { lastCrawlTime: "0000-01-01T00:00:00Z" } },
    { indexStatusResult: { lastCrawlTime: "10000-01-01T00:00:00Z" } },
    { ampResult: { lastCrawlTime: "2026-08-01" } },
    { ampResult: { issues: [{ severity: 123 }] } },
    { ampResult: { issues: [{ issueMessage: false }] } },
    { richResultsResult: { detectedItems: [{ richResultType: 123 }] } },
    { richResultsResult: { detectedItems: [{ items: 123 }] } },
    { richResultsResult: { detectedItems: [{ items: [{ name: false }] }] } },
    { richResultsResult: { detectedItems: [{
      items: [{ issues: [{ issueMessage: false }] }],
    }] } },
    { richResultsResult: { detectedItems: [{
      items: [{ issues: [{ severity: 123 }] }],
    }] } },
    { mobileUsabilityResult: { issues: [{ issueType: 123 }] } },
    { mobileUsabilityResult: { issues: [{ severity: false }] } },
    { mobileUsabilityResult: { issues: [{ message: [] }] } },
  ]) {
    const fixture = harness({
      target: async () => ({ status: 200, body: { inspectionResult } }),
    });
    await assert.rejects(
      fixture.service.inspectUrl({
        ...baseInput(),
        siteUrl: SITE_URL,
        inspectionUrl: "https://example.test/blog/article",
      }),
      assertQueryError("GSC_QUERY_INVALID_RESPONSE"),
    );
  }
});

test("inspectUrl accepts and preserves the documented Timestamp year and precision bounds", async () => {
  for (const lastCrawlTime of [
    "0001-01-01T00:00:00Z",
    "9999-12-31T23:59:59.999999999Z",
  ]) {
    const fixture = harness({
      target: async () => ({
        status: 200,
        body: { inspectionResult: { indexStatusResult: { lastCrawlTime } } },
      }),
    });
    const result = await fixture.service.inspectUrl({
      ...baseInput(),
      siteUrl: SITE_URL,
      inspectionUrl: "https://example.test/blog/article",
    });
    assert.equal(result.inspectionResult.indexStatusResult?.lastCrawlTime, lastCrawlTime);
  }
});

test("URL-prefix coverage compares parsed scheme, host, port, and path boundaries", async () => {
  const invalid = [
    "https://example.test/blogger",
    "https://example.test.evil.test/blog/article",
    "https://sub.example.test/blog/article",
    "http://example.test/blog/article",
    "https://example.test:444/blog/article",
    "ftp://example.test/blog/article",
  ];
  for (const inspectionUrl of invalid) {
    const fixture = harness();
    await assert.rejects(
      fixture.service.inspectUrl({ ...baseInput(), siteUrl: SITE_URL, inspectionUrl }),
      (error: unknown) => error instanceof GscQueryError,
    );
    assert.equal(fixture.refreshInputs.length, 0);
    assert.equal(fixture.requests.length, 0);
  }
});

test("Domain property coverage accepts the domain and subdomains but rejects suffix lookalikes", async () => {
  for (const inspectionUrl of [
    "https://example.test/article",
    "https://sub.example.test/article",
  ]) {
    const fixture = harness({
      sites: { siteEntry: [{ siteUrl: DOMAIN_SITE, permissionLevel: "SITE_OWNER" }] },
      target: async () => ({
        status: 200,
        body: { inspectionResult: { indexStatusResult: {} } },
      }),
    });
    const result = await fixture.service.inspectUrl({
      ...baseInput(),
      siteUrl: DOMAIN_SITE,
      inspectionUrl,
    });
    assert.equal(result.inspectionUrl, inspectionUrl);
  }
  const rejected = harness();
  await assert.rejects(
    rejected.service.inspectUrl({
      ...baseInput(),
      siteUrl: DOMAIN_SITE,
      inspectionUrl: "https://example.test.evil.test/article",
    }),
    assertQueryError("GSC_QUERY_REJECTED"),
  );
  assert.equal(rejected.requests.length, 0);
});

test("listSitemaps preserves int64 strings, omits deprecated indexed, and never downloads sitemap URLs", async () => {
  const sitemapUrl = "https://example.test/sitemap.xml";
  const fixture = harness({
    target: async () => ({
      status: 200,
      body: {
        sitemap: [{
          path: sitemapUrl,
          lastSubmitted: "2026-08-01T00:00:00Z",
          isPending: false,
          isSitemapsIndex: true,
          type: "SITEMAP",
          warnings: "9007199254740993",
          errors: "2",
          lastDownloaded: "2026-08-01T01:02:03.456Z",
          contents: [{ type: "WEB", submitted: "9007199254740995", indexed: "5" }],
          indexed: "999",
        }],
      },
    }),
  });
  const result = await fixture.service.listSitemaps({
    ...baseInput(),
    siteUrl: SITE_URL,
  });
  assert.deepEqual(result.sitemaps, [{
    path: sitemapUrl,
    lastSubmitted: "2026-08-01T00:00:00Z",
    isPending: false,
    isSitemapsIndex: true,
    type: "SITEMAP",
    warnings: "9007199254740993",
    errors: "2",
    lastDownloaded: "2026-08-01T01:02:03.456Z",
    contents: [{ type: "WEB", submitted: "9007199254740995" }],
  }]);
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.requests.some((request) => request.url === sitemapUrl), false);
  assert.equal(JSON.stringify(result).includes("indexed"), false);
});

test("malformed sitemap int64 values and row metrics fail without partial success", async () => {
  const malformedBodies = [
    { sitemap: null },
    { sitemap: [{ path: "https://example.test/sitemap.xml", errors: 2 }] },
    { sitemap: [{ path: "https://example.test/sitemap.xml", warnings: 2 }] },
    { sitemap: [{ path: "https://example.test/sitemap.xml", warnings: 9007199254740992 }] },
    { sitemap: [{ path: "https://example.test/sitemap.xml", errors: "01" }] },
    { sitemap: [{ path: "https://example.test/sitemap.xml", errors: "9223372036854775808" }] },
    { sitemap: [{ path: "https://example.test/sitemap.xml", errors: "-9223372036854775809" }] },
    { sitemap: [{ path: "https://example.test/sitemap.xml", lastSubmitted: "not-a-google-datetime" }] },
    { sitemap: [{ path: "https://example.test/sitemap.xml", lastDownloaded: "2026-02-30T00:00:00Z" }] },
    { sitemap: [{ path: "https://example.test/sitemap.xml", lastDownloaded: "2026-08-01" }] },
    { sitemap: [{ path: "https://example.test/sitemap.xml", lastDownloaded: "2026-08-01T01:02:03+08:00" }] },
  ];
  for (const body of malformedBodies) {
    const fixture = harness({ target: async () => ({ status: 200, body }) });
    await assert.rejects(
      fixture.service.listSitemaps({ ...baseInput(), siteUrl: SITE_URL }),
      assertQueryError("GSC_QUERY_INVALID_RESPONSE"),
    );
  }

  for (const row of [
    { keys: [], ctr: 12 },
    { keys: [], clicks: Number.NaN },
    { keys: ["extra"] },
  ]) {
    const fixture = harness({
      target: async () => ({ status: 200, body: { rows: [row] } }),
    });
    await assert.rejects(
      fixture.service.searchAnalytics(searchInput()),
      assertQueryError("GSC_QUERY_INVALID_RESPONSE"),
    );
  }

  const nullRows = harness({
    target: async () => ({ status: 200, body: { rows: null } }),
  });
  await assert.rejects(
    nullRows.service.searchAnalytics(searchInput()),
    assertQueryError("GSC_QUERY_INVALID_RESPONSE"),
  );
});

test("query operations pass one exact tool deadline through refresh, properties, target, and eligibility", async () => {
  const fixture = harness({
    target: async () => ({ status: 200, body: { rows: [] } }),
  });
  const input = searchInput();
  await fixture.service.searchAnalytics(input);
  assert.equal(fixture.refreshInputs[0].deadline, input.deadline);
  assert.equal(fixture.requests[0].deadline, input.deadline);
  assert.equal(fixture.requests[1].deadline, input.deadline);
  assert.equal(fixture.eligibilityInputs.length, 2);
});

test("missing, malformed, or expired tool deadlines reject before refresh", async () => {
  const invalid: unknown[] = [
    undefined,
    { startedAtMs: NOW_MS, deadlineAtMs: NOW_MS + 1 },
    { startedAtMs: NOW_MS - GSC_OPERATION_TIMEOUT_MS, deadlineAtMs: NOW_MS },
  ];
  for (const deadline of invalid) {
    const fixture = harness();
    await assert.rejects(
      fixture.service.listSites({ ...baseInput(), deadline } as never),
      (error: unknown) => error instanceof GscOAuthError && error.code === "GSC_OPERATION_TIMEOUT",
    );
    assert.equal(fixture.refreshInputs.length, 0);
  }
});

test("a comparison cannot return success after the shared deadline expires", async () => {
  let clock = NOW_MS;
  let targetCount = 0;
  const fixture = harness({
    now: () => clock,
    target: async () => {
      targetCount += 1;
      if (targetCount === 2) clock = NOW_MS + GSC_OPERATION_TIMEOUT_MS;
      return { status: 200, body: { rows: [] } };
    },
  });
  await assert.rejects(
    fixture.service.comparePeriods(compareInput()),
    (error: unknown) => error instanceof GscOAuthError && error.code === "GSC_OPERATION_TIMEOUT",
  );
  assert.equal(targetCount, 2);
  assert.ok(fixture.requests.every((request) => request.deadline === fixture.refreshInputs[0].deadline));
});

test("a result cannot cross the tool deadline after its final eligibility read", async () => {
  let nowCalls = 0;
  const fixture = harness({
    now: () => {
      nowCalls += 1;
      return nowCalls >= 7 ? NOW_MS + GSC_OPERATION_TIMEOUT_MS : NOW_MS;
    },
  });
  await assert.rejects(
    fixture.service.listSites(baseInput()),
    (error: unknown) => error instanceof GscOAuthError && error.code === "GSC_OPERATION_TIMEOUT",
  );
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.eligibilityInputs.length, 1);
});

test("Google HTTP rejection and invalid aggregation format fail without retry", async () => {
  for (const body of [{ responseAggregationType: 42 }, { metadata: [] }]) {
    let targets = 0;
    const fixture = harness({
      target: async () => {
        targets += 1;
        return { status: 200, body };
      },
    });
    await assert.rejects(
      fixture.service.searchAnalytics(searchInput()),
      assertQueryError("GSC_QUERY_INVALID_RESPONSE"),
    );
    assert.equal(targets, 1);
  }
  const rejected = harness({
    target: async () => ({ status: 403, body: { error: { status: "PERMISSION_DENIED" } } }),
  });
  await assert.rejects(
    rejected.service.searchAnalytics(searchInput()),
    assertQueryError("GSC_QUERY_UPSTREAM_REJECTED"),
  );
  assert.equal(rejected.requests.length, 2);
});

test("query service uses the accepted transport's 1 MiB body limit and manual redirect policy", async () => {
  let fetches = 0;
  const oversized = createGscUpstreamTransport({
    fetch: async (_url, init) => {
      fetches += 1;
      assert.equal(init?.redirect, "manual");
      return new Response("x".repeat(1024 * 1024 + 1), { status: 200 });
    },
    now: () => NOW_MS,
  });
  const service = createGscQueryService({
    oauth: {
      refreshCredential: async (input) => ({
        connection: activeConnection(input.userId, input.connectionId, input.generation),
        accessToken: ACCESS_TOKEN,
        grantedScopes: [GSC_READONLY_SCOPE],
      }),
    },
    repository: { isResultEligible: async () => true },
    transport: oversized,
    now: () => NOW_MS,
  });
  await assert.rejects(
    service.listSites(baseInput()),
    (error: unknown) => error instanceof GscOAuthError && error.code === "GSC_UPSTREAM_RESPONSE_TOO_LARGE",
  );
  assert.equal(fetches, 1);

  const redirected = createGscUpstreamTransport({
    fetch: async (_url, init) => {
      assert.equal(init?.redirect, "manual");
      return new Response(null, { status: 302, headers: { location: "https://evil.example.test/" } });
    },
    now: () => NOW_MS,
  });
  const redirectService = createGscQueryService({
    oauth: {
      refreshCredential: async (input) => ({
        connection: activeConnection(input.userId, input.connectionId, input.generation),
        accessToken: ACCESS_TOKEN,
        grantedScopes: [GSC_READONLY_SCOPE],
      }),
    },
    repository: { isResultEligible: async () => true },
    transport: redirected,
    now: () => NOW_MS,
  });
  await assert.rejects(
    redirectService.listSites(baseInput()),
    (error: unknown) => error instanceof GscOAuthError && error.code === "GSC_UPSTREAM_REDIRECT",
  );

  const badJson = createGscUpstreamTransport({
    fetch: async () => new Response("{", { status: 200 }),
    now: () => NOW_MS,
  });
  const badJsonService = createGscQueryService({
    oauth: {
      refreshCredential: async (input) => ({
        connection: activeConnection(input.userId, input.connectionId, input.generation),
        accessToken: ACCESS_TOKEN,
        grantedScopes: [GSC_READONLY_SCOPE],
      }),
    },
    repository: { isResultEligible: async () => true },
    transport: badJson,
    now: () => NOW_MS,
  });
  await assert.rejects(
    badJsonService.listSites(baseInput()),
    (error: unknown) => error instanceof GscOAuthError && error.code === "GSC_UPSTREAM_INVALID_RESPONSE",
  );
});

test("a stalled response body is bounded by the accepted transport timeout", async () => {
  let fireTimer: (() => void) | undefined;
  const bounded = createGscUpstreamTransport({
    fetch: async () => new Response(new ReadableStream<Uint8Array>({ start() {} })),
    now: () => NOW_MS,
    setTimer: (callback) => {
      fireTimer = callback;
      return "synthetic-timer";
    },
    clearTimer: () => undefined,
  });
  const service = createGscQueryService({
    oauth: {
      refreshCredential: async (input) => ({
        connection: activeConnection(input.userId, input.connectionId, input.generation),
        accessToken: ACCESS_TOKEN,
        grantedScopes: [GSC_READONLY_SCOPE],
      }),
    },
    repository: { isResultEligible: async () => true },
    transport: bounded,
    now: () => NOW_MS,
  });
  const pending = service.listSites(baseInput());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(fireTimer);
  fireTimer();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof GscOAuthError && error.code === "GSC_UPSTREAM_TIMEOUT",
  );
});

test("actual accepted OAuth refresh and authenticated crypto feed only the current request token to sites", async () => {
  const credentialService = createGscCredentialService({
    credentialKey: Buffer.alloc(32, 11),
    randomBytes: (length) => Buffer.alloc(length, 12),
  });
  const googleClientId = "synthetic-query-client.apps.example.test";
  const encrypted = credentialService.encryptCredentialEnvelope(
    {
      userId: USER_ID,
      connectionId: CONNECTION_ID,
      googleClientId,
      generation: GENERATION,
      formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
    },
    {
      refreshToken: "synthetic-refresh-token",
      googleSubject: "synthetic-google-subject",
      displayEmail: "member-a@example.test",
      grantedScopes: ["openid", "email", GSC_READONLY_SCOPE],
    },
  );
  const connection = Object.freeze({
    ...activeConnection(),
    googleClientId,
    credentialEnvelope: encrypted,
  });
  const repository = {
    withRefreshLock: async <T>(
      input: { userId: string; connectionId: string; generation: number },
      operation: (session: {
        connection: GscActiveCredentialRecord;
        replaceCredentialEnvelope: (value: typeof encrypted) => Promise<GscActiveCredentialRecord>;
        markReauthorizationRequired: () => Promise<never>;
      }) => Promise<T>,
    ): Promise<T> => {
      assert.deepEqual(input, {
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        generation: GENERATION,
      });
      return operation({
        connection,
        replaceCredentialEnvelope: async (credentialEnvelope) => Object.freeze({
          ...connection,
          credentialEnvelope,
        }),
        markReauthorizationRequired: async () => {
          throw new Error("unexpected reauthorization");
        },
      });
    },
    isResultEligible: async () => true,
  } as unknown as GscRepository;
  const seen: RecordedRequest[] = [];
  const combinedTransport: GscUpstreamTransport = {
    request: async (request) => {
      seen.push(request);
      if (request.url.includes("/token")) {
        return {
          status: 200,
          body: { access_token: "actual-refresh-result", scope: `openid email ${GSC_READONLY_SCOPE}` },
        };
      }
      return {
        status: 200,
        body: { siteEntry: [{ siteUrl: SITE_URL, permissionLevel: "SITE_OWNER" }] },
      };
    },
  };
  const oauth = createGscOAuthService({
    googleClientId,
    googleClientSecret: "synthetic-client-secret",
    repository,
    credentialService,
    transport: combinedTransport,
    now: () => NOW_MS,
  });
  const service = createGscQueryService({
    oauth,
    repository,
    transport: combinedTransport,
    now: () => NOW_MS,
  });
  const result = await service.listSites(baseInput());
  assert.equal(seen.length, 2);
  assert.equal(seen[1].headers?.authorization, "Bearer actual-refresh-result");
  assert.equal(JSON.stringify(result).includes("actual-refresh-result"), false);
  assert.equal(JSON.stringify(result).includes("synthetic-refresh-token"), false);
});

test("repeated reads refresh and fetch properties again instead of using shared cache", async () => {
  const fixture = harness();
  await fixture.service.listSites(baseInput());
  await fixture.service.listSites(baseInput());
  assert.equal(fixture.refreshInputs.length, 2);
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.eligibilityInputs.length, 2);
});
