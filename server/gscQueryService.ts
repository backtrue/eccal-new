import type {
  GscOAuthService,
  GscOperationDeadline,
  GscUpstreamTransport,
} from "./gscOAuth";
import {
  GSC_OPERATION_TIMEOUT_MS,
  GscOAuthError,
} from "./gscOAuth";
import type { GscRepository } from "./gscRepository";

export const GSC_SITES_ENDPOINT =
  "https://www.googleapis.com/webmasters/v3/sites";
export const GSC_URL_INSPECTION_ENDPOINT =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

export type GscQueryErrorCode =
  | "GSC_QUERY_REJECTED"
  | "GSC_QUERY_INVALID_INPUT"
  | "GSC_QUERY_UPSTREAM_REJECTED"
  | "GSC_QUERY_INVALID_RESPONSE";

const ERROR_MESSAGES: Readonly<Record<GscQueryErrorCode, string>> =
  Object.freeze({
    GSC_QUERY_REJECTED: "GSC query rejected",
    GSC_QUERY_INVALID_INPUT: "Invalid GSC query input",
    GSC_QUERY_UPSTREAM_REJECTED: "Google rejected the GSC query",
    GSC_QUERY_INVALID_RESPONSE: "Google returned an invalid GSC response",
  });

export class GscQueryError extends Error {
  constructor(readonly code: GscQueryErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "GscQueryError";
  }
}

export type GscSitePermission =
  | "siteOwner"
  | "siteFullUser"
  | "siteRestrictedUser";

export type GscSite = Readonly<{
  siteUrl: string;
  permission: GscSitePermission;
}>;

export type GscSearchDimension =
  | "date"
  | "query"
  | "page"
  | "country"
  | "device"
  | "searchAppearance";

export type GscSearchFilterDimension = Exclude<GscSearchDimension, "date">;

export type GscSearchFilterOperator =
  | "contains"
  | "equals"
  | "notContains"
  | "notEquals"
  | "includingRegex"
  | "excludingRegex";

export type GscSearchType =
  | "web"
  | "image"
  | "video"
  | "news"
  | "discover"
  | "googleNews";

export type GscDataState = "final" | "all";

export type GscDateRange = Readonly<{
  startDate: string;
  endDate: string;
}>;

export type GscSearchFilter = Readonly<{
  dimension: GscSearchFilterDimension;
  operator: GscSearchFilterOperator;
  expression: string;
}>;

export type GscSearchRow = Readonly<{
  keys: readonly string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}>;

export type GscQueryBaseInput = Readonly<{
  userId: string;
  connectionId: string;
  generation: number;
  deadline: GscOperationDeadline;
}>;

export type GscSearchAnalyticsInput = GscQueryBaseInput &
  GscDateRange &
  Readonly<{
    siteUrl: string;
    dimensions?: readonly GscSearchDimension[];
    filters?: readonly GscSearchFilter[];
    searchType?: GscSearchType;
    dataState?: GscDataState;
    rowLimit?: number;
    startRow?: number;
  }>;

export type GscComparePeriodsInput = GscQueryBaseInput &
  Readonly<{
    siteUrl: string;
    periodA: GscDateRange;
    periodB: GscDateRange;
    dimensions?: readonly GscSearchDimension[];
    filters?: readonly GscSearchFilter[];
    searchType?: GscSearchType;
    dataState?: GscDataState;
    rowLimit?: number;
    startRow?: number;
  }>;

export type GscQueryServiceDependencies = Readonly<{
  oauth: Pick<GscOAuthService, "refreshCredential">;
  repository: Pick<GscRepository, "isResultEligible">;
  transport: GscUpstreamTransport;
  now?: () => number;
}>;

export type GscQueryService = Readonly<{
  listSites: (input: GscQueryBaseInput) => Promise<Readonly<{
    userId: string;
    connectionId: string;
    generation: number;
    sites: readonly GscSite[];
    checkedAt: string;
  }>>;
  searchAnalytics: (input: GscSearchAnalyticsInput) => Promise<GscSearchResult>;
  comparePeriods: (input: GscComparePeriodsInput) => Promise<GscComparisonResult>;
  inspectUrl: (input: GscInspectUrlInput) => Promise<Readonly<{
    userId: string;
    connectionId: string;
    generation: number;
    site: GscSite;
    inspectionUrl: string;
    inspectionResult: Readonly<Record<string, unknown>>;
    isLiveTest: false;
    submittedForIndexing: false;
    checkedAt: string;
  }>>;
  listSitemaps: (input: GscListSitemapsInput) => Promise<Readonly<{
    userId: string;
    connectionId: string;
    generation: number;
    site: GscSite;
    sitemaps: readonly GscSitemap[];
    checkedAt: string;
  }>>;
}>;

export type GscInspectUrlInput = GscQueryBaseInput & Readonly<{
  siteUrl: string;
  inspectionUrl: string;
}>;

export type GscListSitemapsInput = GscQueryBaseInput & Readonly<{
  siteUrl: string;
}>;

export type GscSearchResult = Readonly<{
  userId: string;
  connectionId: string;
  generation: number;
  site: GscSite;
  query: NormalizedSearchQuery;
  rows: readonly GscSearchRow[];
  responseAggregationType?: string;
  freshness: Readonly<{
    dataState: GscDataState;
    status: "final" | "incomplete_from_date" | "not_confirmed";
    firstIncompleteDate?: string;
    timeZone: "America/Los_Angeles";
  }>;
  completeness: Readonly<{
    returnedRowCount: number;
    rowLimit: number;
    startRow: number;
    pageMayBePartial: boolean;
    googleMayOmitRows: true;
    automaticPagination: false;
  }>;
  fetchedAt: string;
}>;

export type GscComparisonRow = Readonly<{
  keys: readonly string[];
  presence: "both" | "period_a_only" | "period_b_only";
  periodA: GscSearchRow | null;
  periodB: GscSearchRow | null;
  changes: Readonly<{
    clicks: GscMetricChange;
    impressions: GscMetricChange;
    ctrPercentagePoints: number | null;
    positionBMinusA: number | null;
  }> | null;
}>;

export type GscMetricChange = Readonly<{
  differenceBMinusA: number | null;
  relativeChangeFromA: number | null;
  relativeChangeReason: "baseline_zero" | "metric_missing" | null;
}>;

export type GscComparisonResult = Readonly<{
  userId: string;
  connectionId: string;
  generation: number;
  site: GscSite;
  query: Omit<NormalizedSearchQuery, "startDate" | "endDate">;
  periodA: GscSearchResult;
  periodB: GscSearchResult;
  rows: readonly GscComparisonRow[];
  comparedAt: string;
  limitations: Readonly<{
    comparesOnePagePerPeriod: true;
    missingRowsAreNotZero: true;
    notAWholeSiteLargestDecline: true;
  }>;
}>;

export type GscSitemap = Readonly<{
  path: string;
  lastSubmitted?: string;
  isPending?: boolean;
  isSitemapsIndex?: boolean;
  type?: string;
  lastDownloaded?: string;
  warnings?: string;
  errors?: string;
  contents?: readonly Readonly<{
    type?: string;
    submitted?: string;
  }>[];
}>;

type NormalizedSearchQuery = Readonly<{
  startDate: string;
  endDate: string;
  dimensions: readonly GscSearchDimension[];
  filters: readonly GscSearchFilter[];
  searchType: GscSearchType;
  dataState: GscDataState;
  rowLimit: number;
  startRow: number;
}>;

type RequestContext = Readonly<{
  userId: string;
  connectionId: string;
  generation: number;
  deadline: GscOperationDeadline;
  accessToken: string;
}>;

function fail(code: GscQueryErrorCode): never {
  throw new GscQueryError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value
    : fail("GSC_QUERY_INVALID_INPUT");
}

function requireGeneration(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail("GSC_QUERY_INVALID_INPUT");
}

function requireDeadline(
  value: unknown,
  nowMs: number,
): GscOperationDeadline {
  if (
    !isRecord(value) ||
    typeof value.startedAtMs !== "number" ||
    typeof value.deadlineAtMs !== "number" ||
    !Number.isFinite(value.startedAtMs) ||
    !Number.isFinite(value.deadlineAtMs) ||
    value.deadlineAtMs - value.startedAtMs !== GSC_OPERATION_TIMEOUT_MS ||
    value.startedAtMs > nowMs ||
    nowMs >= value.deadlineAtMs
  ) {
    throw new GscOAuthError("GSC_OPERATION_TIMEOUT");
  }
  return value as GscOperationDeadline;
}

function isoTime(nowMs: number): string {
  const value = new Date(nowMs);
  return Number.isFinite(value.getTime())
    ? value.toISOString()
    : fail("GSC_QUERY_INVALID_RESPONSE");
}

function requireDate(value: unknown): { value: string; day: number } {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail("GSC_QUERY_INVALID_INPUT");
  }
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    fail("GSC_QUERY_INVALID_INPUT");
  }
  return { value, day: Math.floor(time / 86_400_000) };
}

function requireResponseDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail("GSC_QUERY_INVALID_RESPONSE");
  }
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    fail("GSC_QUERY_INVALID_RESPONSE");
  }
  return value;
}

const DIMENSIONS = new Set<GscSearchDimension>([
  "date",
  "query",
  "page",
  "country",
  "device",
  "searchAppearance",
]);
const FILTER_DIMENSIONS = new Set<GscSearchFilterDimension>([
  "query",
  "page",
  "country",
  "device",
  "searchAppearance",
]);
const FILTER_OPERATORS = new Set<GscSearchFilterOperator>([
  "contains",
  "equals",
  "notContains",
  "notEquals",
  "includingRegex",
  "excludingRegex",
]);
const SEARCH_TYPES = new Set<GscSearchType>([
  "web",
  "image",
  "video",
  "news",
  "discover",
  "googleNews",
]);

function normalizeSearchQuery(input: {
  startDate: unknown;
  endDate: unknown;
  dimensions?: unknown;
  filters?: unknown;
  searchType?: unknown;
  dataState?: unknown;
  rowLimit?: unknown;
  startRow?: unknown;
}): NormalizedSearchQuery {
  const start = requireDate(input.startDate);
  const end = requireDate(input.endDate);
  if (start.day > end.day) fail("GSC_QUERY_INVALID_INPUT");
  const dimensionsValue = input.dimensions ?? [];
  if (!Array.isArray(dimensionsValue)) fail("GSC_QUERY_INVALID_INPUT");
  const dimensions = dimensionsValue.map((dimension) =>
    typeof dimension === "string" && DIMENSIONS.has(dimension as GscSearchDimension)
      ? dimension as GscSearchDimension
      : fail("GSC_QUERY_INVALID_INPUT")
  );
  if (new Set(dimensions).size !== dimensions.length) {
    fail("GSC_QUERY_INVALID_INPUT");
  }
  const filtersValue = input.filters ?? [];
  if (!Array.isArray(filtersValue)) fail("GSC_QUERY_INVALID_INPUT");
  const filters = filtersValue.map((value) => {
    if (!isRecord(value)) fail("GSC_QUERY_INVALID_INPUT");
    const dimension = value.dimension;
    const operator = value.operator;
    if (
      typeof dimension !== "string" ||
      !FILTER_DIMENSIONS.has(dimension as GscSearchFilterDimension) ||
      typeof operator !== "string" ||
      !FILTER_OPERATORS.has(operator as GscSearchFilterOperator)
    ) {
      fail("GSC_QUERY_INVALID_INPUT");
    }
    return Object.freeze({
      dimension: dimension as GscSearchFilterDimension,
      operator: operator as GscSearchFilterOperator,
      expression: requireString(value.expression),
    });
  });
  const searchType = input.searchType ?? "web";
  const dataState = input.dataState ?? "final";
  const rowLimit = input.rowLimit ?? 100;
  const startRow = input.startRow ?? 0;
  if (
    typeof searchType !== "string" ||
    !SEARCH_TYPES.has(searchType as GscSearchType) ||
    (dataState !== "final" && dataState !== "all") ||
    typeof rowLimit !== "number" ||
    !Number.isSafeInteger(rowLimit) ||
    rowLimit < 1 ||
    rowLimit > 1000 ||
    typeof startRow !== "number" ||
    !Number.isSafeInteger(startRow) ||
    startRow < 0
  ) {
    fail("GSC_QUERY_INVALID_INPUT");
  }
  return Object.freeze({
    startDate: start.value,
    endDate: end.value,
    dimensions: Object.freeze(dimensions),
    filters: Object.freeze(filters),
    searchType: searchType as GscSearchType,
    dataState: dataState as GscDataState,
    rowLimit,
    startRow,
  });
}

function normalizePermission(value: unknown): GscSitePermission | null {
  switch (value) {
    case "siteOwner":
    case "SITE_OWNER":
      return "siteOwner";
    case "siteFullUser":
    case "SITE_FULL_USER":
      return "siteFullUser";
    case "siteRestrictedUser":
    case "SITE_RESTRICTED_USER":
      return "siteRestrictedUser";
    case "siteUnverifiedUser":
    case "SITE_UNVERIFIED_USER":
    case "SITE_PERMISSION_LEVEL_UNSPECIFIED":
      return null;
    default:
      return fail("GSC_QUERY_INVALID_RESPONSE");
  }
}

function parseSites(body: unknown): readonly GscSite[] {
  if (!isRecord(body)) fail("GSC_QUERY_INVALID_RESPONSE");
  const entries = body.siteEntry === undefined ? [] : body.siteEntry;
  if (!Array.isArray(entries)) fail("GSC_QUERY_INVALID_RESPONSE");
  const sites = new Map<string, GscSite>();
  const seenSiteUrls = new Set<string>();
  for (const value of entries) {
    if (
      !isRecord(value) ||
      typeof value.siteUrl !== "string" ||
      value.siteUrl.length === 0
    ) {
      fail("GSC_QUERY_INVALID_RESPONSE");
    }
    if (seenSiteUrls.has(value.siteUrl)) fail("GSC_QUERY_INVALID_RESPONSE");
    seenSiteUrls.add(value.siteUrl);
    const permission = normalizePermission(value.permissionLevel);
    if (permission !== null) {
      sites.set(value.siteUrl, Object.freeze({ siteUrl: value.siteUrl, permission }));
    }
  }
  return Object.freeze(Array.from(sites.values()));
}

function optionalNumber(
  row: Record<string, unknown>,
  key: "clicks" | "impressions" | "ctr" | "position",
): number | undefined {
  const value = row[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("GSC_QUERY_INVALID_RESPONSE");
  }
  if (key === "ctr" && value > 1) fail("GSC_QUERY_INVALID_RESPONSE");
  return value;
}

function parseSearchRows(
  body: Record<string, unknown>,
  dimensions: readonly GscSearchDimension[],
): readonly GscSearchRow[] {
  const values = body.rows === undefined ? [] : body.rows;
  if (!Array.isArray(values)) fail("GSC_QUERY_INVALID_RESPONSE");
  return Object.freeze(values.map((value) => {
    if (!isRecord(value)) fail("GSC_QUERY_INVALID_RESPONSE");
    const rawKeys = value.keys ?? (dimensions.length === 0 ? [] : undefined);
    if (
      !Array.isArray(rawKeys) ||
      rawKeys.length !== dimensions.length ||
      !rawKeys.every((key) => typeof key === "string")
    ) {
      fail("GSC_QUERY_INVALID_RESPONSE");
    }
    const row: {
      keys: readonly string[];
      clicks?: number;
      impressions?: number;
      ctr?: number;
      position?: number;
    } = { keys: Object.freeze([...rawKeys] as string[]) };
    for (const key of ["clicks", "impressions", "ctr", "position"] as const) {
      const metric = optionalNumber(value, key);
      if (metric !== undefined) row[key] = metric;
    }
    return Object.freeze(row);
  }));
}

function firstIncompleteDate(
  body: Record<string, unknown>,
): string | undefined {
  if (body.metadata === undefined) return undefined;
  if (!isRecord(body.metadata)) fail("GSC_QUERY_INVALID_RESPONSE");
  const camel = body.metadata.firstIncompleteDate;
  const snake = body.metadata.first_incomplete_date;
  if (camel !== undefined && snake !== undefined && camel !== snake) {
    fail("GSC_QUERY_INVALID_RESPONSE");
  }
  const value = camel ?? snake;
  if (value === undefined) return undefined;
  return requireResponseDate(value);
}

function requireInt64String(value: unknown): string {
  if (typeof value !== "string" || !/^-?(0|[1-9]\d*)$/.test(value) || value === "-0") {
    return fail("GSC_QUERY_INVALID_RESPONSE");
  }
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const limit = negative ? "9223372036854775808" : "9223372036854775807";
  if (digits.length > limit.length || (digits.length === limit.length && digits > limit)) {
    return fail("GSC_QUERY_INVALID_RESPONSE");
  }
  return value;
}

function requireGoogleDateTime(value: unknown): string {
  if (typeof value !== "string") {
    return fail("GSC_QUERY_INVALID_RESPONSE");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (match === null) return fail("GSC_QUERY_INVALID_RESPONSE");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return fail("GSC_QUERY_INVALID_RESPONSE");
  }
  return value;
}

function parseSitemaps(body: unknown): readonly GscSitemap[] {
  if (!isRecord(body)) fail("GSC_QUERY_INVALID_RESPONSE");
  const values = body.sitemap === undefined ? [] : body.sitemap;
  if (!Array.isArray(values)) fail("GSC_QUERY_INVALID_RESPONSE");
  return Object.freeze(values.map((value) => {
    if (!isRecord(value) || typeof value.path !== "string") {
      fail("GSC_QUERY_INVALID_RESPONSE");
    }
    const sitemap: {
      path: string;
      lastSubmitted?: string;
      isPending?: boolean;
      isSitemapsIndex?: boolean;
      type?: string;
      lastDownloaded?: string;
      warnings?: string;
      errors?: string;
      contents?: readonly Readonly<{ type?: string; submitted?: string }>[];
    } = { path: value.path };
    if (value.type !== undefined) {
      if (typeof value.type !== "string") fail("GSC_QUERY_INVALID_RESPONSE");
      sitemap.type = value.type;
    }
    for (const key of ["lastSubmitted", "lastDownloaded"] as const) {
      if (value[key] !== undefined) sitemap[key] = requireGoogleDateTime(value[key]);
    }
    for (const key of ["isPending", "isSitemapsIndex"] as const) {
      if (value[key] !== undefined) {
        if (typeof value[key] !== "boolean") fail("GSC_QUERY_INVALID_RESPONSE");
        sitemap[key] = value[key];
      }
    }
    for (const key of ["warnings", "errors"] as const) {
      if (value[key] !== undefined) sitemap[key] = requireInt64String(value[key]);
    }
    if (value.contents !== undefined) {
      if (!Array.isArray(value.contents)) fail("GSC_QUERY_INVALID_RESPONSE");
      sitemap.contents = Object.freeze(value.contents.map((entry) => {
        if (!isRecord(entry)) fail("GSC_QUERY_INVALID_RESPONSE");
        const content: { type?: string; submitted?: string } = {};
        if (entry.type !== undefined) {
          if (typeof entry.type !== "string") fail("GSC_QUERY_INVALID_RESPONSE");
          content.type = entry.type;
        }
        if (entry.submitted !== undefined) {
          content.submitted = requireInt64String(entry.submitted);
        }
        return Object.freeze(content);
      }));
    }
    return Object.freeze(sitemap);
  }));
}

function validateOptionalStrings(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      fail("GSC_QUERY_INVALID_RESPONSE");
    }
  }
}

function validateOptionalStringArrays(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    if (value[key] === undefined) continue;
    if (
      !Array.isArray(value[key]) ||
      !value[key].every((entry) => typeof entry === "string")
    ) {
      fail("GSC_QUERY_INVALID_RESPONSE");
    }
  }
}

function validateOptionalRecordArray(
  value: Record<string, unknown>,
  key: string,
): readonly Record<string, unknown>[] | undefined {
  if (value[key] === undefined) return undefined;
  if (
    !Array.isArray(value[key]) ||
    !value[key].every((entry) => isRecord(entry))
  ) {
    fail("GSC_QUERY_INVALID_RESPONSE");
  }
  return value[key] as readonly Record<string, unknown>[];
}

function validateInspectionResult(value: Record<string, unknown>): void {
  validateOptionalStrings(value, ["inspectionResultLink"]);
  for (const key of [
    "indexStatusResult",
    "ampResult",
    "richResultsResult",
    "mobileUsabilityResult",
  ] as const) {
    if (value[key] !== undefined && !isRecord(value[key])) {
      fail("GSC_QUERY_INVALID_RESPONSE");
    }
  }

  const indexStatus = value.indexStatusResult;
  if (isRecord(indexStatus)) {
    validateOptionalStrings(indexStatus, [
      "robotsTxtState",
      "coverageState",
      "verdict",
      "googleCanonical",
      "indexingState",
      "userCanonical",
      "pageFetchState",
      "crawledAs",
    ]);
    validateOptionalStringArrays(indexStatus, ["referringUrls", "sitemap"]);
    if (indexStatus.lastCrawlTime !== undefined) {
      requireGoogleDateTime(indexStatus.lastCrawlTime);
    }
  }

  const amp = value.ampResult;
  if (isRecord(amp)) {
    validateOptionalStrings(amp, [
      "verdict",
      "pageFetchState",
      "ampIndexStatusVerdict",
      "indexingState",
      "robotsTxtState",
      "ampUrl",
    ]);
    if (amp.lastCrawlTime !== undefined) requireGoogleDateTime(amp.lastCrawlTime);
    const issues = validateOptionalRecordArray(amp, "issues");
    if (issues !== undefined) {
      issues.forEach((issue) => validateOptionalStrings(issue, ["severity", "issueMessage"]));
    }
  }

  const rich = value.richResultsResult;
  if (isRecord(rich)) {
    validateOptionalStrings(rich, ["verdict"]);
    const detectedItems = validateOptionalRecordArray(rich, "detectedItems");
    if (detectedItems !== undefined) {
      detectedItems.forEach((detectedItem) => {
        validateOptionalStrings(detectedItem, ["richResultType"]);
        const items = validateOptionalRecordArray(detectedItem, "items");
        if (items !== undefined) {
          items.forEach((item) => {
            validateOptionalStrings(item, ["name"]);
            const issues = validateOptionalRecordArray(item, "issues");
            if (issues !== undefined) {
              issues.forEach((issue) => {
                validateOptionalStrings(issue, ["severity", "issueMessage"]);
              });
            }
          });
        }
      });
    }
  }

  const mobile = value.mobileUsabilityResult;
  if (isRecord(mobile)) {
    validateOptionalStrings(mobile, ["verdict"]);
    const issues = validateOptionalRecordArray(mobile, "issues");
    if (issues !== undefined) {
      issues.forEach((issue) => {
        validateOptionalStrings(issue, ["issueType", "severity", "message"]);
      });
    }
  }
}

function requireInspectionCoverage(siteUrl: string, inspectionUrl: string): void {
  let inspected: URL;
  try {
    inspected = new URL(inspectionUrl);
  } catch {
    fail("GSC_QUERY_INVALID_INPUT");
  }
  if (
    !["http:", "https:"].includes(inspected.protocol) ||
    inspected.username !== "" ||
    inspected.password !== ""
  ) {
    fail("GSC_QUERY_INVALID_INPUT");
  }
  if (siteUrl.startsWith("sc-domain:")) {
    const rawDomain = siteUrl.slice("sc-domain:".length);
    if (rawDomain.length === 0 || /[/?#@]/.test(rawDomain)) {
      fail("GSC_QUERY_INVALID_INPUT");
    }
    let domain: string;
    try {
      const parsed = new URL(`https://${rawDomain}/`);
      if (
        parsed.hostname.length === 0 ||
        parsed.port !== "" ||
        parsed.host !== rawDomain
      ) {
        fail("GSC_QUERY_INVALID_INPUT");
      }
      domain = parsed.hostname;
    } catch {
      fail("GSC_QUERY_INVALID_INPUT");
    }
    if (
      inspected.hostname !== domain &&
      !inspected.hostname.endsWith(`.${domain}`)
    ) {
      fail("GSC_QUERY_REJECTED");
    }
    return;
  }
  let property: URL;
  try {
    property = new URL(siteUrl);
  } catch {
    fail("GSC_QUERY_INVALID_INPUT");
  }
  if (
    !["http:", "https:"].includes(property.protocol) ||
    property.username !== "" ||
    property.password !== "" ||
    property.search !== "" ||
    property.hash !== "" ||
    inspected.protocol !== property.protocol ||
    inspected.hostname !== property.hostname ||
    inspected.port !== property.port
  ) {
    fail("GSC_QUERY_REJECTED");
  }
  const prefix = property.pathname;
  const covered = inspected.pathname === prefix ||
    (prefix.endsWith("/")
      ? inspected.pathname.startsWith(prefix)
      : inspected.pathname.startsWith(`${prefix}/`));
  if (!covered) fail("GSC_QUERY_REJECTED");
}

function metricChange(a: number | undefined, b: number | undefined): GscMetricChange {
  if (a === undefined || b === undefined) {
    return Object.freeze({
      differenceBMinusA: null,
      relativeChangeFromA: null,
      relativeChangeReason: "metric_missing" as const,
    });
  }
  const difference = b - a;
  return Object.freeze({
    differenceBMinusA: difference,
    relativeChangeFromA: a === 0 ? null : difference / a,
    relativeChangeReason: a === 0 ? "baseline_zero" as const : null,
  });
}

function compareRows(
  periodA: readonly GscSearchRow[],
  periodB: readonly GscSearchRow[],
): readonly GscComparisonRow[] {
  const a = new Map<string, GscSearchRow>();
  const b = new Map<string, GscSearchRow>();
  for (const [map, rows] of [[a, periodA], [b, periodB]] as const) {
    for (const row of rows) {
      const key = JSON.stringify(row.keys);
      if (map.has(key)) fail("GSC_QUERY_INVALID_RESPONSE");
      map.set(key, row);
    }
  }
  const keys = Array.from(new Set([
    ...Array.from(a.keys()),
    ...Array.from(b.keys()),
  ])).sort();
  return Object.freeze(keys.map((key) => {
    const rowA = a.get(key) ?? null;
    const rowB = b.get(key) ?? null;
    const presence = rowA !== null && rowB !== null
      ? "both" as const
      : rowA !== null
      ? "period_a_only" as const
      : "period_b_only" as const;
    return Object.freeze({
      keys: Object.freeze([...(rowA ?? rowB)!.keys]),
      presence,
      periodA: rowA,
      periodB: rowB,
      changes: rowA !== null && rowB !== null
        ? Object.freeze({
          clicks: metricChange(rowA.clicks, rowB.clicks),
          impressions: metricChange(rowA.impressions, rowB.impressions),
          ctrPercentagePoints: rowA.ctr === undefined || rowB.ctr === undefined
            ? null
            : (rowB.ctr - rowA.ctr) * 100,
          positionBMinusA:
            rowA.position === undefined || rowB.position === undefined
              ? null
              : rowB.position - rowA.position,
        })
        : null,
    });
  }));
}

export function createGscQueryService(
  dependencies: GscQueryServiceDependencies,
): GscQueryService {
  const oauth = dependencies.oauth;
  const repository = dependencies.repository;
  const transport = dependencies.transport;
  const now = dependencies.now ?? Date.now;
  if (
    !oauth ||
    typeof oauth.refreshCredential !== "function" ||
    !repository ||
    typeof repository.isResultEligible !== "function" ||
    !transport ||
    typeof transport.request !== "function"
  ) {
    fail("GSC_QUERY_INVALID_INPUT");
  }

  function base(input: GscQueryBaseInput): Omit<RequestContext, "accessToken"> {
    return Object.freeze({
      userId: requireString(input.userId),
      connectionId: requireString(input.connectionId),
      generation: requireGeneration(input.generation),
      deadline: requireDeadline(input.deadline, now()),
    });
  }

  async function authorize(input: GscQueryBaseInput): Promise<RequestContext> {
    const context = base(input);
    const refreshed = await oauth.refreshCredential(context);
    requireDeadline(context.deadline, now());
    if (
      refreshed.connection.userId !== context.userId ||
      refreshed.connection.connectionId !== context.connectionId ||
      refreshed.connection.generation !== context.generation ||
      refreshed.connection.status !== "active" ||
      typeof refreshed.accessToken !== "string" ||
      refreshed.accessToken.length === 0
    ) {
      fail("GSC_QUERY_REJECTED");
    }
    return Object.freeze({ ...context, accessToken: refreshed.accessToken });
  }

  async function requestJson(
    context: RequestContext,
    request: Readonly<{
      url: string;
      method: "GET" | "POST";
      body?: string;
    }>,
  ): Promise<Record<string, unknown>> {
    requireDeadline(context.deadline, now());
    const response = await transport.request({
      url: request.url,
      method: request.method,
      headers: Object.freeze({
        authorization: `Bearer ${context.accessToken}`,
        ...(request.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      }),
      ...(request.body === undefined ? {} : { body: request.body }),
      responseType: "json",
      deadline: context.deadline,
    });
    requireDeadline(context.deadline, now());
    if (response.status < 200 || response.status >= 300) {
      fail("GSC_QUERY_UPSTREAM_REJECTED");
    }
    return isRecord(response.body)
      ? response.body
      : fail("GSC_QUERY_INVALID_RESPONSE");
  }

  async function currentSites(context: RequestContext): Promise<readonly GscSite[]> {
    return parseSites(await requestJson(context, {
      url: GSC_SITES_ENDPOINT,
      method: "GET",
    }));
  }

  async function eligible(context: RequestContext): Promise<void> {
    requireDeadline(context.deadline, now());
    const allowed = await repository.isResultEligible({
      userId: context.userId,
      connectionId: context.connectionId,
      generation: context.generation,
    });
    requireDeadline(context.deadline, now());
    if (!allowed) fail("GSC_QUERY_REJECTED");
  }

  function resultTime(context: RequestContext): string {
    const current = now();
    requireDeadline(context.deadline, current);
    return isoTime(current);
  }

  async function siteBeforeTarget(
    context: RequestContext,
    siteUrl: string,
  ): Promise<GscSite> {
    const exact = (await currentSites(context)).find((site) =>
      site.siteUrl === siteUrl
    );
    if (!exact) fail("GSC_QUERY_REJECTED");
    await eligible(context);
    return exact;
  }

  async function querySearch(
    context: RequestContext,
    site: GscSite,
    query: NormalizedSearchQuery,
  ): Promise<GscSearchResult> {
    const body: Record<string, unknown> = {
      startDate: query.startDate,
      endDate: query.endDate,
      dimensions: query.dimensions,
      type: query.searchType,
      dataState: query.dataState,
      rowLimit: query.rowLimit,
      startRow: query.startRow,
    };
    if (query.filters.length > 0) {
      body.dimensionFilterGroups = [{
        groupType: "and",
        filters: query.filters,
      }];
    }
    const response = await requestJson(context, {
      url: `${GSC_SITES_ENDPOINT}/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`,
      method: "POST",
      body: JSON.stringify(body),
    });
    const rows = parseSearchRows(response, query.dimensions);
    const incompleteDate = firstIncompleteDate(response);
    if (
      incompleteDate !== undefined &&
      (query.dataState !== "all" || !query.dimensions.includes("date"))
    ) {
      fail("GSC_QUERY_INVALID_RESPONSE");
    }
    const aggregation = response.responseAggregationType;
    if (aggregation !== undefined && typeof aggregation !== "string") {
      fail("GSC_QUERY_INVALID_RESPONSE");
    }
    await eligible(context);
    const freshness = query.dataState === "final"
      ? Object.freeze({
        dataState: query.dataState,
        status: "final" as const,
        timeZone: "America/Los_Angeles" as const,
      })
      : incompleteDate === undefined
      ? Object.freeze({
        dataState: query.dataState,
        status: "not_confirmed" as const,
        timeZone: "America/Los_Angeles" as const,
      })
      : Object.freeze({
        dataState: query.dataState,
        status: "incomplete_from_date" as const,
        firstIncompleteDate: incompleteDate,
        timeZone: "America/Los_Angeles" as const,
      });
    return Object.freeze({
      userId: context.userId,
      connectionId: context.connectionId,
      generation: context.generation,
      site,
      query,
      rows,
      ...(aggregation === undefined ? {} : { responseAggregationType: aggregation }),
      freshness,
      completeness: Object.freeze({
        returnedRowCount: rows.length,
        rowLimit: query.rowLimit,
        startRow: query.startRow,
        pageMayBePartial: query.startRow > 0 || rows.length === query.rowLimit,
        googleMayOmitRows: true as const,
        automaticPagination: false as const,
      }),
      fetchedAt: resultTime(context),
    });
  }

  async function listSites(input: GscQueryBaseInput) {
    const context = await authorize(input);
    const sites = await currentSites(context);
    await eligible(context);
    return Object.freeze({
      userId: context.userId,
      connectionId: context.connectionId,
      generation: context.generation,
      sites,
      checkedAt: resultTime(context),
    });
  }

  async function searchAnalytics(input: GscSearchAnalyticsInput) {
    const siteUrl = requireString(input.siteUrl);
    const query = normalizeSearchQuery(input);
    const context = await authorize(input);
    const site = await siteBeforeTarget(context, siteUrl);
    return querySearch(context, site, query);
  }

  async function comparePeriods(input: GscComparePeriodsInput) {
    const siteUrl = requireString(input.siteUrl);
    if (!isRecord(input.periodA) || !isRecord(input.periodB)) {
      fail("GSC_QUERY_INVALID_INPUT");
    }
    const common = {
      dimensions: input.dimensions,
      filters: input.filters,
      searchType: input.searchType,
      dataState: input.dataState,
      rowLimit: input.rowLimit,
      startRow: input.startRow,
    };
    const periodA = normalizeSearchQuery({
      ...common,
      startDate: input.periodA.startDate,
      endDate: input.periodA.endDate,
    });
    const periodB = normalizeSearchQuery({
      ...common,
      startDate: input.periodB.startDate,
      endDate: input.periodB.endDate,
    });
    const aStart = requireDate(periodA.startDate).day;
    const aEnd = requireDate(periodA.endDate).day;
    const bStart = requireDate(periodB.startDate).day;
    const bEnd = requireDate(periodB.endDate).day;
    if (
      aEnd - aStart !== bEnd - bStart ||
      !(aEnd < bStart || bEnd < aStart)
    ) {
      fail("GSC_QUERY_INVALID_INPUT");
    }
    const context = await authorize(input);
    const firstSite = await siteBeforeTarget(context, siteUrl);
    const first = await querySearch(context, firstSite, periodA);
    const secondSite = await siteBeforeTarget(context, siteUrl);
    const second = await querySearch(context, secondSite, periodB);
    const { startDate: _firstStart, endDate: _firstEnd, ...commonQuery } = periodA;
    return Object.freeze({
      userId: context.userId,
      connectionId: context.connectionId,
      generation: context.generation,
      site: secondSite,
      query: Object.freeze(commonQuery),
      periodA: first,
      periodB: second,
      rows: compareRows(first.rows, second.rows),
      comparedAt: resultTime(context),
      limitations: Object.freeze({
        comparesOnePagePerPeriod: true as const,
        missingRowsAreNotZero: true as const,
        notAWholeSiteLargestDecline: true as const,
      }),
    });
  }

  async function inspectUrl(input: GscInspectUrlInput) {
    const siteUrl = requireString(input.siteUrl);
    const inspectionUrl = requireString(input.inspectionUrl);
    requireInspectionCoverage(siteUrl, inspectionUrl);
    const context = await authorize(input);
    const site = await siteBeforeTarget(context, siteUrl);
    const response = await requestJson(context, {
      url: GSC_URL_INSPECTION_ENDPOINT,
      method: "POST",
      body: JSON.stringify({ inspectionUrl, siteUrl }),
    });
    if (!isRecord(response.inspectionResult)) {
      fail("GSC_QUERY_INVALID_RESPONSE");
    }
    validateInspectionResult(response.inspectionResult);
    await eligible(context);
    return Object.freeze({
      userId: context.userId,
      connectionId: context.connectionId,
      generation: context.generation,
      site,
      inspectionUrl,
      inspectionResult: Object.freeze({ ...response.inspectionResult }),
      isLiveTest: false as const,
      submittedForIndexing: false as const,
      checkedAt: resultTime(context),
    });
  }

  async function listSitemaps(input: GscListSitemapsInput) {
    const siteUrl = requireString(input.siteUrl);
    const context = await authorize(input);
    const site = await siteBeforeTarget(context, siteUrl);
    const response = await requestJson(context, {
      url: `${GSC_SITES_ENDPOINT}/${encodeURIComponent(site.siteUrl)}/sitemaps`,
      method: "GET",
    });
    const sitemaps = parseSitemaps(response);
    await eligible(context);
    return Object.freeze({
      userId: context.userId,
      connectionId: context.connectionId,
      generation: context.generation,
      site,
      sitemaps,
      checkedAt: resultTime(context),
    });
  }

  return Object.freeze({
    listSites,
    searchAnalytics,
    comparePeriods,
    inspectUrl,
    listSitemaps,
  });
}
