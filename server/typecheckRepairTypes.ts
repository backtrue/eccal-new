export type AuthenticatedEccalUser = Readonly<{
  id: string;
  email: string | null | undefined;
  name: string | null | undefined;
  membershipLevel: string | null | undefined;
  credits: number | null | undefined;
}>;

function optionalNullableString(value: unknown): string | null | undefined {
  return typeof value === 'string' || value === null ? value : undefined;
}

function optionalNullableNumber(value: unknown): number | null | undefined {
  return typeof value === 'number' || value === null ? value : undefined;
}

export function getAuthenticatedEccalUser(value: unknown): AuthenticatedEccalUser | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string') {
    return null;
  }

  return {
    id: candidate.id,
    email: optionalNullableString(candidate.email),
    name: optionalNullableString(candidate.name),
    membershipLevel: optionalNullableString(candidate.membershipLevel),
    credits: optionalNullableNumber(candidate.credits),
  };
}

export type PublicAccountMember = Readonly<{
  id: string;
  email: string | null | undefined;
  name: string | null | undefined;
  membership: string | null | undefined;
  credits: number | null | undefined;
}>;

export function projectPublicAccountMember(
  user: AuthenticatedEccalUser,
): PublicAccountMember {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    membership: user.membershipLevel,
    credits: user.credits,
  };
}

export function mapPublicProfileUpdate(input: {
  name: string | null | undefined;
  profilePicture: string | null | undefined;
}): {
  name: string | null | undefined;
  profileImageUrl: string | null | undefined;
} {
  return {
    name: input.name,
    profileImageUrl: input.profilePicture,
  };
}

export type NpsRatingRow = Readonly<{
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  npsScore: number | null;
  npsComment: string | null;
  npsSubmittedAt: Date | null;
  adAccountName: string;
  industryType: string;
}>;

export type NpsRatingsPayload = Readonly<{
  ratings: readonly NpsRatingRow[];
  stats: Readonly<{
    totalRatings: number;
    averageScore: number;
    promoters: number;
    passives: number;
    detractors: number;
    npsScore: number;
  }>;
}>;

export function buildNpsRatingsPayload(
  ratings: readonly NpsRatingRow[],
): NpsRatingsPayload {
  const totalRatings = ratings.length;
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  let totalScore = 0;

  for (const rating of ratings) {
    const score = rating.npsScore ?? 0;
    totalScore += score;
    if (score >= 9) {
      promoters += 1;
    } else if (score >= 7) {
      passives += 1;
    } else {
      detractors += 1;
    }
  }

  const averageScore = totalRatings > 0 ? totalScore / totalRatings : 0;
  const promoterPercentage = totalRatings > 0 ? (promoters / totalRatings) * 100 : 0;
  const detractorPercentage = totalRatings > 0 ? (detractors / totalRatings) * 100 : 0;

  return {
    ratings,
    stats: {
      totalRatings,
      averageScore,
      promoters,
      passives,
      detractors,
      npsScore: promoterPercentage - detractorPercentage,
    },
  };
}

export const STRIPE_API_VERSION = "2023-10-16" as const;

export type StripePaymentIntentReference =
  | string
  | null
  | { client_secret: string | null };

export type StripeInvoiceReference =
  | string
  | null
  | { payment_intent: StripePaymentIntentReference };

export function getPaymentIntentClientSecret(
  latestInvoice: StripeInvoiceReference,
): string | null {
  if (!latestInvoice || typeof latestInvoice === "string") {
    return null;
  }

  const paymentIntent = latestInvoice.payment_intent;
  if (!paymentIntent || typeof paymentIntent === "string") {
    return null;
  }

  return paymentIntent.client_secret;
}

export type EccalPurchasePlanType = "monthly" | "annual" | "founders";

export type EccalPurchasePlan = {
  planType: EccalPurchasePlanType;
  purchaseAmount: number;
  isFounders: boolean;
};

export function resolveEccalPurchasePlan(
  paymentType: string,
  amountInMinorUnits: number,
): EccalPurchasePlan {
  switch (paymentType) {
    case "monthly":
      return { planType: "monthly", purchaseAmount: 1280, isFounders: false };
    case "annual":
      return { planType: "annual", purchaseAmount: 12800, isFounders: false };
    case "founders_membership":
    case "lifetime":
      return { planType: "founders", purchaseAmount: 5990, isFounders: true };
    default:
      return {
        planType: "monthly",
        purchaseAmount: amountInMinorUnits / 100,
        isFounders: false,
      };
  }
}

export type PaymentSessionLogin<User> = (
  user: User,
  done: (error?: unknown) => void,
) => void;

export function restorePaymentSession<User>(
  login: PaymentSessionLogin<User>,
  user: User,
): Promise<void> {
  return new Promise((resolve, reject) => {
    login(user, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export type EccalPurchasePayment = {
  id: string;
  amount: number;
  currency: string;
};
