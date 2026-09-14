export type AnalyticsSummary = {
  averageOrderValue: number;
  conversionRate: number;
};

type AnalyticsQueryResult = {
  data: unknown;
};

type JsonResponseLike = {
  json(): Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

export function projectAnalyticsData(value: unknown): AnalyticsSummary | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.averageOrderValue !== "number" ||
    typeof value.conversionRate !== "number"
  ) {
    throw new Error("Invalid analytics data response");
  }

  return {
    averageOrderValue: Math.round(value.averageOrderValue),
    conversionRate: Math.round(value.conversionRate * 100) / 100,
  };
}

export async function readAnalyticsQueryResult(
  refetch: () => Promise<AnalyticsQueryResult>,
): Promise<AnalyticsSummary | null> {
  const result = await refetch();
  return projectAnalyticsData(result.data);
}

export type NpsRating = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  npsScore: number;
  npsComment: string | null;
  npsSubmittedAt: string | null;
  adAccountName: string;
  industryType: string;
};

export type NpsStats = {
  totalRatings: number;
  averageScore: number;
  promoters: number;
  passives: number;
  detractors: number;
  npsScore: number;
};

export type NpsRatingsResponse = {
  stats: NpsStats;
  ratings: NpsRating[];
};

function parseNpsRating(value: unknown): NpsRating {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.userId !== "string" ||
    !isNullableString(value.userEmail) ||
    !isNullableString(value.userName) ||
    typeof value.npsScore !== "number" ||
    !isNullableString(value.npsComment) ||
    !isNullableString(value.npsSubmittedAt) ||
    typeof value.adAccountName !== "string" ||
    typeof value.industryType !== "string"
  ) {
    throw new Error("Invalid NPS rating response");
  }

  return {
    id: value.id,
    userId: value.userId,
    userEmail: value.userEmail,
    userName: value.userName,
    npsScore: value.npsScore,
    npsComment: value.npsComment,
    npsSubmittedAt: value.npsSubmittedAt,
    adAccountName: value.adAccountName,
    industryType: value.industryType,
  };
}

export function parseNpsRatingsResponse(value: unknown): NpsRatingsResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.ratings) ||
    !isRecord(value.stats) ||
    typeof value.stats.totalRatings !== "number" ||
    typeof value.stats.averageScore !== "number" ||
    typeof value.stats.promoters !== "number" ||
    typeof value.stats.passives !== "number" ||
    typeof value.stats.detractors !== "number" ||
    typeof value.stats.npsScore !== "number"
  ) {
    throw new Error("Invalid NPS ratings response");
  }

  return {
    ratings: value.ratings.map(parseNpsRating),
    stats: {
      totalRatings: value.stats.totalRatings,
      averageScore: value.stats.averageScore,
      promoters: value.stats.promoters,
      passives: value.stats.passives,
      detractors: value.stats.detractors,
      npsScore: value.stats.npsScore,
    },
  };
}

export async function readNpsRatingsResponse(
  response: JsonResponseLike,
): Promise<NpsRatingsResponse> {
  return parseNpsRatingsResponse(await response.json());
}

export type MetaPurchaseEvent = {
  paymentType: string;
  amount: number;
  currency: string;
  transactionId: string;
  timestamp: string;
};

export type MetaPurchaseEventsResponse =
  | { success: true; event: MetaPurchaseEvent | null }
  | { success: false; error: string };

function parseMetaPurchaseEvent(value: unknown): MetaPurchaseEvent {
  if (
    !isRecord(value) ||
    typeof value.paymentType !== "string" ||
    typeof value.amount !== "number" ||
    typeof value.currency !== "string" ||
    typeof value.transactionId !== "string" ||
    typeof value.timestamp !== "string"
  ) {
    throw new Error("Invalid Meta purchase event response");
  }
  return {
    paymentType: value.paymentType,
    amount: value.amount,
    currency: value.currency,
    transactionId: value.transactionId,
    timestamp: value.timestamp,
  };
}

export function parseMetaPurchaseEventsResponse(
  value: unknown,
): MetaPurchaseEventsResponse {
  if (!isRecord(value)) {
    throw new Error("Invalid Meta purchase events response");
  }
  if (value.success === true && value.event === null) {
    return { success: true, event: null };
  }
  if (value.success === true) {
    return { success: true, event: parseMetaPurchaseEvent(value.event) };
  }
  if (value.success === false && typeof value.error === "string") {
    return { success: false, error: value.error };
  }
  throw new Error("Invalid Meta purchase events response");
}

export type MetaTriggerResponse =
  | { success: true; message: string; eventId: string }
  | { success: false; error: string };

export function parseMetaTriggerResponse(value: unknown): MetaTriggerResponse {
  if (!isRecord(value)) {
    throw new Error("Invalid Meta trigger response");
  }
  if (
    value.success === true &&
    typeof value.message === "string" &&
    typeof value.eventId === "string"
  ) {
    return { success: true, message: value.message, eventId: value.eventId };
  }
  if (value.success === false && typeof value.error === "string") {
    return { success: false, error: value.error };
  }
  throw new Error("Invalid Meta trigger response");
}
