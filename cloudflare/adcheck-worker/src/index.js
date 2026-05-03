import { neon } from "@neondatabase/serverless";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
};

const DEFAULT_RULES = {
  spendRateFullThreshold: 0.95,
  initialJudgementImpressions: 500,
  stopLossImpressions: 8000,
  minActiveAdsPerAdset: 3,
  cpaWarningMultiplier: 1.2,
  cpaStopMultiplier: 1.5,
  roasWarningRatio: 0.8,
  ctrWarningThreshold: 1,
  budgetIncreaseRatio: 0.2,
  budgetDecreaseRatio: 0.2,
  observationWindowDays: 3,
  protectLearningPhase: true,
  avoidEditingExistingAds: true,
};

export default {
  async fetch(request, env) {
    try {
      assertEnv(env);

      const url = new URL(request.url);
      if (request.method === "OPTIONS") return emptyCorsResponse(request);

      if (url.searchParams.has("token")) {
        return persistTokenAndRedirect(url);
      }

      if (url.pathname === "/api/auth/google" || url.pathname === "/api/login") {
        return redirectToEccalLogin(url, env);
      }

      if (url.pathname === "/api/auth/logout") {
        return logoutResponse(env);
      }

      if (url.pathname === "/api/auth/check" || url.pathname === "/api/auth/user") {
        const auth = await authenticate(request, env);
        if (!auth.ok) return json({ isAuthenticated: false, user: null }, 401);

        return json({
          isAuthenticated: true,
          user: safeUser(auth.user),
        });
      }

      if (url.pathname.startsWith("/api/v2/")) {
        const auth = await authenticate(request, env);
        if (!auth.ok) return json({ success: false, error: auth.error }, 401);
        return handleV2Api(request, env, auth.user);
      }

      if (url.pathname === "/health") {
        return json({ ok: true, service: "eccal-adcheck", timestamp: new Date().toISOString() });
      }

      return html(renderAppShell(env));
    } catch (error) {
      console.error("[ADCHECK] Unhandled error:", error);
      return json({ success: false, error: error.message || "INTERNAL_ERROR" }, error.status || 500);
    }
  },
};

async function handleV2Api(request, env, user) {
  const url = new URL(request.url);
  const sql = neon(env.DATABASE_URL);
  const path = url.pathname.replace(/^\/api\/v2/, "") || "/";

  await ensureV2Schema(sql);

  if (request.method === "GET" && path === "/companies") {
    return json({ success: true, data: await listCompanies(sql, user.id) });
  }

  if (request.method === "POST" && path === "/companies") {
    const body = await readJson(request);
    const company = await createCompany(sql, user.id, body);
    return json({ success: true, data: company }, 201);
  }

  const companyMatch = path.match(/^\/companies\/([^/]+)$/);
  if (companyMatch && request.method === "GET") {
    const context = await getCompanyContext(sql, user.id, companyMatch[1]);
    if (!context) return json({ success: false, error: "COMPANY_NOT_FOUND" }, 404);
    return json({ success: true, data: context });
  }

  if (companyMatch && request.method === "PATCH") {
    const updated = await updateCompany(sql, user.id, companyMatch[1], await readJson(request));
    if (!updated) return json({ success: false, error: "COMPANY_NOT_FOUND" }, 404);
    return json({ success: true, data: updated });
  }

  if (companyMatch && request.method === "DELETE") {
    const deleted = await deleteCompany(sql, user.id, companyMatch[1]);
    if (!deleted) return json({ success: false, error: "COMPANY_NOT_FOUND" }, 404);
    return json({ success: true });
  }

  const financialMatch = path.match(/^\/companies\/([^/]+)\/financial-profile$/);
  if (financialMatch && request.method === "PUT") {
    const profile = await upsertFinancialProfile(sql, user.id, financialMatch[1], await readJson(request));
    if (!profile) return json({ success: false, error: "COMPANY_NOT_FOUND" }, 404);
    return json({ success: true, data: profile });
  }

  const adAccountMatch = path.match(/^\/companies\/([^/]+)\/ad-accounts$/);
  if (adAccountMatch && request.method === "POST") {
    const account = await linkAdAccount(sql, user.id, adAccountMatch[1], await readJson(request));
    if (!account) return json({ success: false, error: "COMPANY_NOT_FOUND" }, 404);
    return json({ success: true, data: account }, 201);
  }

  const decisionRuleMatch = path.match(/^\/companies\/([^/]+)\/decision-rules$/);
  if (decisionRuleMatch && request.method === "GET") {
    const company = await getCompany(sql, user.id, decisionRuleMatch[1]);
    if (!company) return json({ success: false, error: "COMPANY_NOT_FOUND" }, 404);
    const ruleSet = await getActiveRuleSet(sql, decisionRuleMatch[1]);
    return json({ success: true, data: { ruleSet, normalizedRules: normalizeRules(ruleSet) } });
  }

  if (decisionRuleMatch && request.method === "PUT") {
    const company = await getCompany(sql, user.id, decisionRuleMatch[1]);
    if (!company) return json({ success: false, error: "COMPANY_NOT_FOUND" }, 404);
    const ruleSet = await upsertDecisionRules(sql, decisionRuleMatch[1], await readJson(request));
    return json({ success: true, data: ruleSet, normalizedRules: normalizeRules(ruleSet) });
  }

  if (request.method === "GET" && path === "/plans") {
    const plans = await sql`
      SELECT *
      FROM plan_results
      WHERE user_id = ${user.id} AND is_active = true
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return json({ success: true, data: camelizeRows(plans) });
  }

  if (request.method === "GET" && path === "/meta/accounts") {
    if (!user.metaAccessToken) return json({ success: false, error: "META_ACCESS_TOKEN_MISSING" }, 400);
    const accounts = await getMetaAdAccounts(env, user.metaAccessToken);
    return json({ success: true, data: accounts });
  }

  if (request.method === "POST" && path === "/ad-decision/run") {
    if (!user.metaAccessToken) return json({ success: false, error: "META_ACCESS_TOKEN_MISSING" }, 400);
    const body = await readJson(request);
    const result = await runDecision(sql, env, user, body);
    return json({ success: true, data: result });
  }

  if (request.method === "GET" && path === "/ad-decision/recommendations") {
    const companyId = url.searchParams.get("companyId");
    const rows = companyId
      ? await sql`
          SELECT *
          FROM ad_action_recommendations
          WHERE user_id = ${user.id} AND company_id = ${companyId}
          ORDER BY created_at DESC
          LIMIT 50
        `
      : await sql`
          SELECT *
          FROM ad_action_recommendations
          WHERE user_id = ${user.id}
          ORDER BY created_at DESC
          LIMIT 50
        `;
    return json({ success: true, data: camelizeRows(rows) });
  }

  const statusMatch = path.match(/^\/ad-decision\/recommendations\/([^/]+)\/status$/);
  if (statusMatch && request.method === "PATCH") {
    const body = await readJson(request);
    const updated = await updateRecommendationStatus(sql, user.id, statusMatch[1], body);
    if (!updated) return json({ success: false, error: "RECOMMENDATION_NOT_FOUND" }, 404);
    return json({ success: true, data: updated });
  }

  return json({ success: false, error: "NOT_FOUND" }, 404);
}

async function authenticate(request, env) {
  const token = extractToken(request);
  if (!token) return { ok: false, error: "AUTH_REQUIRED" };

  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return { ok: false, error: "AUTH_INVALID" };

  const userId = payload.sub || payload.id || payload.userId;
  if (!userId) return { ok: false, error: "AUTH_USER_MISSING" };

  const sql = neon(env.DATABASE_URL);
  const rows = await sql`
    SELECT id, email, name, first_name, last_name, profile_image_url, membership_level, credits,
           meta_access_token, meta_ad_account_id
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;

  const user = rows[0];
  if (!user) return { ok: false, error: "AUTH_USER_NOT_FOUND" };

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.first_name,
      lastName: user.last_name,
      profileImageUrl: user.profile_image_url,
      membershipLevel: user.membership_level,
      credits: user.credits,
      metaAccessToken: user.meta_access_token,
      metaAdAccountId: user.meta_ad_account_id,
    },
  };
}

async function verifyJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(base64UrlDecode(headerPart));
  if (header.alg !== "HS256") return null;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const expectedData = encoder.encode(`${headerPart}.${payloadPart}`);
  const signature = base64UrlToBytes(signaturePart);
  const valid = await crypto.subtle.verify("HMAC", key, signature, expectedData);
  if (!valid) return null;

  const payload = JSON.parse(base64UrlDecode(payloadPart));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now - 60) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;

  return payload;
}

function extractToken(request) {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return parseCookies(request.headers.get("cookie")).auth_token || null;
}

function parseCookies(cookieHeader) {
  const result = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key) result[key] = decodeURIComponent(valueParts.join("="));
  }
  return result;
}

function persistTokenAndRedirect(url) {
  const token = url.searchParams.get("token");
  url.searchParams.delete("token");
  url.searchParams.delete("auth_success");
  url.searchParams.delete("user_id");
  const redirectTo = `${url.origin}${url.pathname || "/"}${url.search}${url.hash}`;

  return new Response(null, {
    status: 302,
    headers: {
      location: redirectTo,
      "set-cookie": cookieValue("auth_token", token, 7 * 24 * 60 * 60),
      "cache-control": "no-store",
    },
  });
}

function redirectToEccalLogin(url, env) {
  const returnTo = url.searchParams.get("returnTo") || env.PUBLIC_APP_URL || url.origin;
  const target = new URL("/api/auth/google-sso", env.ECCAL_AUTH_ORIGIN);
  target.searchParams.set("returnTo", returnTo);
  target.searchParams.set("service", "adcheck");
  return Response.redirect(target.toString(), 302);
}

function logoutResponse(env) {
  return new Response(null, {
    status: 302,
    headers: {
      location: env.PUBLIC_APP_URL || "/",
      "set-cookie": cookieValue("auth_token", "", 0),
      "cache-control": "no-store",
    },
  });
}

async function listCompanies(sql, userId) {
  return camelizeRows(await sql`
    SELECT *
    FROM companies
    WHERE user_id = ${userId} AND is_active = true
    ORDER BY updated_at DESC
  `);
}

async function createCompany(sql, userId, input) {
  const brandName = requiredString(input?.brandName, "brandName");
  const id = crypto.randomUUID();
  const rows = await sql`
    INSERT INTO companies (
      id, user_id, brand_name, company_name, website_url, industry, business_model,
      primary_market, currency, language, description, is_active, created_at, updated_at
    )
    VALUES (
      ${id}, ${userId}, ${brandName}, ${nullableString(input.companyName)}, ${nullableString(input.websiteUrl)},
      ${nullableString(input.industry)}, ${input.businessModel || "ecommerce"},
      ${input.primaryMarket || "TW"}, ${input.currency || "TWD"}, ${input.language || "zh-TW"},
      ${nullableString(input.description)}, true, now(), now()
    )
    RETURNING *
  `;
  return camelizeRow(rows[0]);
}

async function getCompany(sql, userId, companyId) {
  const rows = await sql`
    SELECT *
    FROM companies
    WHERE id = ${companyId} AND user_id = ${userId} AND is_active = true
    LIMIT 1
  `;
  return rows[0] ? camelizeRow(rows[0]) : null;
}

async function updateCompany(sql, userId, companyId, input) {
  const company = await getCompany(sql, userId, companyId);
  if (!company) return null;

  const rows = await sql`
    UPDATE companies
    SET brand_name = COALESCE(${nullableString(input.brandName)}, brand_name),
        company_name = ${nullableString(input.companyName)},
        website_url = ${nullableString(input.websiteUrl)},
        industry = ${nullableString(input.industry)},
        business_model = COALESCE(${nullableString(input.businessModel)}, business_model),
        primary_market = COALESCE(${nullableString(input.primaryMarket)}, primary_market),
        currency = COALESCE(${nullableString(input.currency)}, currency),
        language = COALESCE(${nullableString(input.language)}, language),
        description = ${nullableString(input.description)},
        updated_at = now()
    WHERE id = ${companyId}
    RETURNING *
  `;
  return camelizeRow(rows[0]);
}

async function deleteCompany(sql, userId, companyId) {
  const company = await getCompany(sql, userId, companyId);
  if (!company) return false;
  await sql`UPDATE companies SET is_active = false, updated_at = now() WHERE id = ${companyId}`;
  return true;
}

async function getCompanyContext(sql, userId, companyId) {
  const company = await getCompany(sql, userId, companyId);
  if (!company) return null;

  const [financialProfiles, adAccounts, products, ruleSets] = await Promise.all([
    sql`SELECT * FROM company_financial_profiles WHERE company_id = ${companyId} LIMIT 1`,
    sql`SELECT * FROM company_ad_accounts WHERE company_id = ${companyId} AND is_active = true ORDER BY updated_at DESC`,
    sql`SELECT * FROM product_profiles WHERE company_id = ${companyId} AND is_active = true ORDER BY updated_at DESC`,
    sql`SELECT * FROM decision_rule_sets WHERE (company_id = ${companyId} OR company_id IS NULL) AND is_active = true ORDER BY company_id NULLS LAST, is_default DESC, updated_at DESC LIMIT 1`,
  ]);

  return {
    company,
    financialProfile: financialProfiles[0] ? camelizeRow(financialProfiles[0]) : null,
    adAccounts: camelizeRows(adAccounts),
    products: camelizeRows(products),
    activeDecisionRuleSet: ruleSets[0] ? camelizeRow(ruleSets[0]) : null,
  };
}

async function upsertFinancialProfile(sql, userId, companyId, input) {
  const company = await getCompany(sql, userId, companyId);
  if (!company) return null;

  const existing = await sql`SELECT id FROM company_financial_profiles WHERE company_id = ${companyId} LIMIT 1`;
  if (existing[0]) {
    const rows = await sql`
      UPDATE company_financial_profiles
      SET average_order_value = ${nullableNumber(input.averageOrderValue)},
          gross_margin_rate = ${nullableNumber(input.grossMarginRate)},
          acceptable_ad_cost_rate = ${nullableNumber(input.acceptableAdCostRate)},
          break_even_roas = ${nullableNumber(input.breakEvenRoas)},
          target_roas = ${nullableNumber(input.targetRoas)},
          target_cpa = ${nullableNumber(input.targetCpa)},
          target_cpc = ${nullableNumber(input.targetCpc)},
          conversion_rate = ${nullableNumber(input.conversionRate)},
          ltv = ${nullableNumber(input.ltv)},
          return_rate = ${nullableNumber(input.returnRate)},
          shipping_cost_rate = ${nullableNumber(input.shippingCostRate)},
          payment_fee_rate = ${nullableNumber(input.paymentFeeRate)},
          notes = ${nullableString(input.notes)},
          updated_at = now()
      WHERE id = ${existing[0].id}
      RETURNING *
    `;
    return camelizeRow(rows[0]);
  }

  const rows = await sql`
    INSERT INTO company_financial_profiles (
      id, company_id, average_order_value, gross_margin_rate, acceptable_ad_cost_rate,
      break_even_roas, target_roas, target_cpa, target_cpc, conversion_rate, ltv,
      return_rate, shipping_cost_rate, payment_fee_rate, notes, created_at, updated_at
    )
    VALUES (
      ${crypto.randomUUID()}, ${companyId}, ${nullableNumber(input.averageOrderValue)},
      ${nullableNumber(input.grossMarginRate)}, ${nullableNumber(input.acceptableAdCostRate)},
      ${nullableNumber(input.breakEvenRoas)}, ${nullableNumber(input.targetRoas)},
      ${nullableNumber(input.targetCpa)}, ${nullableNumber(input.targetCpc)},
      ${nullableNumber(input.conversionRate)}, ${nullableNumber(input.ltv)},
      ${nullableNumber(input.returnRate)}, ${nullableNumber(input.shippingCostRate)},
      ${nullableNumber(input.paymentFeeRate)}, ${nullableString(input.notes)}, now(), now()
    )
    RETURNING *
  `;
  return camelizeRow(rows[0]);
}

async function linkAdAccount(sql, userId, companyId, input) {
  const company = await getCompany(sql, userId, companyId);
  if (!company) return null;
  const adAccountId = requiredString(input?.adAccountId, "adAccountId");
  const platform = input.platform || "meta";

  const existing = await sql`
    SELECT id
    FROM company_ad_accounts
    WHERE company_id = ${companyId} AND platform = ${platform} AND ad_account_id = ${adAccountId}
    LIMIT 1
  `;

  if (existing[0]) {
    const rows = await sql`
      UPDATE company_ad_accounts
      SET ad_account_name = ${nullableString(input.adAccountName)},
          currency = ${nullableString(input.currency)},
          timezone = ${nullableString(input.timezone)},
          is_active = true,
          updated_at = now()
      WHERE id = ${existing[0].id}
      RETURNING *
    `;
    return camelizeRow(rows[0]);
  }

  const rows = await sql`
    INSERT INTO company_ad_accounts (
      id, company_id, platform, ad_account_id, ad_account_name, currency, timezone,
      is_active, created_at, updated_at
    )
    VALUES (
      ${crypto.randomUUID()}, ${companyId}, ${platform}, ${adAccountId},
      ${nullableString(input.adAccountName)}, ${nullableString(input.currency)},
      ${nullableString(input.timezone)}, true, now(), now()
    )
    RETURNING *
  `;
  return camelizeRow(rows[0]);
}

async function upsertDecisionRules(sql, companyId, input) {
  const existing = await sql`
    SELECT id
    FROM decision_rule_sets
    WHERE company_id = ${companyId} AND is_active = true
    ORDER BY updated_at DESC
    LIMIT 1
  `;

  const values = normalizeRules(input);
  if (existing[0]) {
    const rows = await sql`
      UPDATE decision_rule_sets
      SET name = ${input.name || "company-default"},
          spend_rate_full_threshold = ${values.spendRateFullThreshold},
          initial_judgement_impressions = ${values.initialJudgementImpressions},
          stop_loss_impressions = ${values.stopLossImpressions},
          min_active_ads_per_adset = ${values.minActiveAdsPerAdset},
          cpa_warning_multiplier = ${values.cpaWarningMultiplier},
          cpa_stop_multiplier = ${values.cpaStopMultiplier},
          roas_warning_ratio = ${values.roasWarningRatio},
          ctr_warning_threshold = ${values.ctrWarningThreshold},
          budget_increase_ratio = ${values.budgetIncreaseRatio},
          budget_decrease_ratio = ${values.budgetDecreaseRatio},
          observation_window_days = ${values.observationWindowDays},
          protect_learning_phase = ${values.protectLearningPhase},
          avoid_editing_existing_ads = ${values.avoidEditingExistingAds},
          notes = ${nullableString(input.notes)},
          updated_at = now()
      WHERE id = ${existing[0].id}
      RETURNING *
    `;
    return camelizeRow(rows[0]);
  }

  const rows = await sql`
    INSERT INTO decision_rule_sets (
      id, company_id, name, spend_rate_full_threshold, initial_judgement_impressions,
      stop_loss_impressions, min_active_ads_per_adset, cpa_warning_multiplier,
      cpa_stop_multiplier, roas_warning_ratio, ctr_warning_threshold,
      budget_increase_ratio, budget_decrease_ratio, observation_window_days,
      protect_learning_phase, avoid_editing_existing_ads, notes, is_default, is_active,
      created_at, updated_at
    )
    VALUES (
      ${crypto.randomUUID()}, ${companyId}, ${input.name || "company-default"},
      ${values.spendRateFullThreshold}, ${values.initialJudgementImpressions},
      ${values.stopLossImpressions}, ${values.minActiveAdsPerAdset},
      ${values.cpaWarningMultiplier}, ${values.cpaStopMultiplier},
      ${values.roasWarningRatio}, ${values.ctrWarningThreshold},
      ${values.budgetIncreaseRatio}, ${values.budgetDecreaseRatio},
      ${values.observationWindowDays}, ${values.protectLearningPhase},
      ${values.avoidEditingExistingAds}, ${nullableString(input.notes)}, false, true, now(), now()
    )
    RETURNING *
  `;
  return camelizeRow(rows[0]);
}

async function getActiveRuleSet(sql, companyId) {
  const rows = await sql`
    SELECT *
    FROM decision_rule_sets
    WHERE (company_id = ${companyId} OR company_id IS NULL) AND is_active = true
    ORDER BY company_id NULLS LAST, is_default DESC, updated_at DESC
    LIMIT 1
  `;
  return rows[0] ? camelizeRow(rows[0]) : null;
}

async function runDecision(sql, env, user, body) {
  const companyId = requiredString(body.companyId, "companyId");
  const planResultId = requiredString(body.planResultId, "planResultId");
  const adAccountId = requiredString(body.adAccountId, "adAccountId");

  const companyContext = await getCompanyContext(sql, user.id, companyId);
  if (!companyContext) throw apiError("COMPANY_NOT_FOUND", 404);
  if (!companyContext.adAccounts.some((account) => account.adAccountId === adAccountId)) {
    throw apiError("AD_ACCOUNT_NOT_LINKED_TO_COMPANY", 400);
  }

  const plans = await sql`
    SELECT *
    FROM plan_results
    WHERE id = ${planResultId} AND user_id = ${user.id}
    LIMIT 1
  `;
  if (!plans[0]) throw apiError("PLAN_NOT_FOUND", 404);

  const plan = camelizeRow(plans[0]);
  const actual = await getMetaActualMetrics(env, user.metaAccessToken, adAccountId);
  const ruleSet = normalizeRules(companyContext.activeDecisionRuleSet);
  const output = evaluateDecision({ userId: user.id, companyContext, plan, actual, ruleSet });
  const saved = await saveRecommendations(sql, {
    userId: user.id,
    companyId,
    planResultId,
    adAccountId,
    output,
  });

  return {
    summary: output.summary,
    recommendations: saved,
  };
}

async function saveRecommendations(sql, input) {
  const saved = [];
  for (const recommendation of input.output.recommendations) {
    const id = crypto.randomUUID();
    const rows = await sql`
      INSERT INTO ad_action_recommendations (
        id, user_id, company_id, plan_result_id, ad_account_id, recommendation_date,
        decision_mode, overall_status, priority, action_type, target_level, target_id,
        target_name, reason_summary, detailed_reason, recommended_action, risk_note,
        metrics_snapshot, rule_snapshot, context_snapshot, approval_status, created_at, updated_at
      )
      VALUES (
        ${id}, ${input.userId}, ${input.companyId}, ${input.planResultId}, ${input.adAccountId}, now(),
        ${input.output.decisionMode}, ${input.output.overallStatus}, ${recommendation.priority},
        ${recommendation.actionType}, ${recommendation.targetLevel}, ${recommendation.targetId || null},
        ${recommendation.targetName || null}, ${recommendation.reasonSummary}, ${recommendation.detailedReason || null},
        ${recommendation.recommendedAction}, ${recommendation.riskNote || null},
        ${JSON.stringify(recommendation.metricsSnapshot)}, ${JSON.stringify(recommendation.ruleSnapshot)},
        ${JSON.stringify(recommendation.contextSnapshot || {})}, 'pending', now(), now()
      )
      RETURNING *
    `;

    await sql`
      INSERT INTO ad_action_logs (id, recommendation_id, user_id, company_id, action, metadata, created_at)
      VALUES (
        ${crypto.randomUUID()}, ${id}, ${input.userId}, ${input.companyId}, 'created',
        ${JSON.stringify({
          decisionMode: input.output.decisionMode,
          overallStatus: input.output.overallStatus,
          summary: input.output.summary,
        })},
        now()
      )
    `;

    saved.push(camelizeRow(rows[0]));
  }
  return saved;
}

async function updateRecommendationStatus(sql, userId, recommendationId, input) {
  const status = input.status;
  if (!["approved", "rejected", "dismissed"].includes(status)) throw apiError("INVALID_STATUS", 400);

  const existing = await sql`
    SELECT *
    FROM ad_action_recommendations
    WHERE id = ${recommendationId} AND user_id = ${userId}
    LIMIT 1
  `;
  if (!existing[0]) return null;

  const approvedAt = status === "approved" ? new Date().toISOString() : null;
  const rejectedAt = status === "rejected" ? new Date().toISOString() : null;
  const rows = await sql`
    UPDATE ad_action_recommendations
    SET approval_status = ${status},
        operator_note = ${nullableString(input.note)},
        approved_at = COALESCE(${approvedAt}, approved_at),
        rejected_at = COALESCE(${rejectedAt}, rejected_at),
        updated_at = now()
    WHERE id = ${recommendationId}
    RETURNING *
  `;

  await sql`
    INSERT INTO ad_action_logs (id, recommendation_id, user_id, company_id, action, note, metadata, created_at)
    VALUES (
      ${crypto.randomUUID()}, ${recommendationId}, ${userId}, ${existing[0].company_id},
      ${status}, ${nullableString(input.note)},
      ${JSON.stringify({ previousStatus: existing[0].approval_status, nextStatus: status })},
      now()
    )
  `;

  return camelizeRow(rows[0]);
}

async function getMetaAdAccounts(env, accessToken) {
  const baseUrl = `https://graph.facebook.com/${env.META_GRAPH_VERSION || "v24.0"}`;
  const accounts = [];
  let nextUrl = `${baseUrl}/me/adaccounts?fields=id,name,account_status&limit=100&access_token=${encodeURIComponent(accessToken)}`;
  let page = 0;

  while (nextUrl && page < 10) {
    page += 1;
    const response = await fetch(nextUrl);
    if (!response.ok) throw new Error(`META_ACCOUNT_LIST_FAILED:${response.status}:${await response.text()}`);
    const data = await response.json();
    for (const account of data.data || []) {
      if (account.account_status === 1) accounts.push({ id: account.id, name: account.name });
    }
    nextUrl = data.paging?.next || null;
  }

  return accounts;
}

async function getMetaActualMetrics(env, accessToken, adAccountId) {
  const baseUrl = `https://graph.facebook.com/${env.META_GRAPH_VERSION || "v24.0"}`;
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(now.getDate() + 1);
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - 28);
  const since = startDate.toISOString().split("T")[0];
  const until = endDate.toISOString().split("T")[0];
  const params = new URLSearchParams({
    fields: "spend,actions,action_values,outbound_clicks_ctr,impressions,clicks,inline_link_clicks",
    time_range: JSON.stringify({ since, until }),
    level: "account",
    access_token: accessToken,
  });
  const response = await fetch(`${baseUrl}/${accountId}/insights?${params.toString()}`);
  if (!response.ok) throw new Error(`META_INSIGHTS_FAILED:${response.status}:${await response.text()}`);
  const data = await response.json();
  const row = data.data?.[0] || {};
  const spend = toNumber(row.spend);
  const purchases = extractActionCount(row.actions, ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
  const purchaseValue = extractActionCount(row.action_values, ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
  const impressions = toNumber(row.impressions);
  const clicks = toNumber(row.inline_link_clicks || row.clicks);
  const ctr = row.outbound_clicks_ctr?.[0]?.value ? toNumber(row.outbound_clicks_ctr[0].value) : impressions > 0 ? (clicks / impressions) * 100 : 0;
  const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000));

  return {
    spend,
    dailySpend: round(spend / days, 2),
    purchases,
    dailyPurchases: round(purchases / days, 2),
    roas: spend > 0 ? round(purchaseValue / spend, 2) : 0,
    ctr: round(ctr, 2),
    cpa: purchases > 0 ? round(spend / purchases, 2) : null,
    impressions,
    clicks,
    raw: row,
  };
}

function evaluateDecision(input) {
  const targetDailyBudget = toNumber(input.plan.dailyAdBudget);
  const targetRoas = toNumber(input.plan.targetRoas);
  const targetDailyOrders = Math.max(1, Math.round(toNumber(input.plan.requiredOrders) / 30));
  const spendRate = targetDailyBudget > 0 ? input.actual.dailySpend / targetDailyBudget : 0;
  const budgetIsFull = spendRate >= input.ruleSet.spendRateFullThreshold;
  const roasAchieved = input.actual.roas >= targetRoas;
  const hasPurchase = input.actual.purchases > 0 || input.actual.dailyPurchases > 0;
  const targetCpa = targetDailyBudget / targetDailyOrders;
  const snapshot = (extra) => ({
    actual: input.actual,
    plan: {
      id: input.plan.id,
      planName: input.plan.planName,
      dailyAdBudget: input.plan.dailyAdBudget,
      requiredOrders: input.plan.requiredOrders,
      targetRoas: input.plan.targetRoas,
      currency: input.plan.currency,
    },
    ...extra,
  });
  const contextSnapshot = {
    companyId: input.companyContext.company.id,
    brandName: input.companyContext.company.brandName,
    businessModel: input.companyContext.company.businessModel,
    primaryMarket: input.companyContext.company.primaryMarket,
    currency: input.companyContext.company.currency,
    hasFinancialProfile: Boolean(input.companyContext.financialProfile),
    adAccountsCount: input.companyContext.adAccounts.length,
  };

  if (typeof input.actual.impressions === "number" && input.actual.impressions < input.ruleSet.initialJudgementImpressions) {
    return one("insufficient_data", "insufficient_data", "目前曝光還不到初判門檻，先累積資料，不急著動廣告。", {
      priority: "low",
      actionType: "observe",
      targetLevel: "account",
      reasonSummary: "曝光量不足，資料還不能支撐關閉、加碼或降預算判斷。",
      detailedReason: `目前曝光 ${input.actual.impressions}，低於初判門檻 ${input.ruleSet.initialJudgementImpressions}。`,
      recommendedAction: "先觀察到曝光達門檻後再重新巡帳。",
      riskNote: "資料不足時貿然調整，容易錯殺仍在學習的廣告。",
      metricsSnapshot: snapshot({ spendRate, targetDailyBudget, targetRoas, targetDailyOrders }),
      ruleSnapshot: input.ruleSet,
      contextSnapshot,
    });
  }

  if (!hasPurchase) {
    const ctrTooLow = input.actual.ctr > 0 && input.actual.ctr < input.ruleSet.ctrWarningThreshold;
    return one("technical_troubleshooting", ctrTooLow ? "needs_fix" : "observe", ctrTooLow ? "目前比較像素材或第一眼吸引力問題，先補素材，不急著加碼。" : "目前沒有轉單，先進入技術排查與觀察。", {
      priority: ctrTooLow || spendRate >= 0.5 ? "medium" : "low",
      actionType: ctrTooLow ? "add_creatives" : "observe",
      targetLevel: ctrTooLow ? "creative" : "account",
      reasonSummary: ctrTooLow ? "目前沒有轉單，且 CTR 偏低，優先補素材角度。" : "目前沒有轉單，但還不足以判定素材或受眾已失效。",
      detailedReason: `過去區間購買數為 0，CTR 為 ${input.actual.ctr}%。`,
      recommendedAction: ctrTooLow ? "下一輪先補三種素材角度：情境痛點、價格疑慮、角色認同，再觀察是否拉高點擊與轉換。" : "先維持觀察，確認曝光、點擊與事件追蹤資料是否持續進來。",
      riskNote: "沒有轉單時不要只看 ROAS，需先排除素材、受眾與 tracking 問題。",
      metricsSnapshot: snapshot({ spendRate, targetDailyBudget }),
      ruleSnapshot: input.ruleSet,
      contextSnapshot,
    });
  }

  if (roasAchieved && budgetIsFull) {
    return one("financial_decision", "can_scale", "ROAS 達標且預算基本花滿，這組已經進入可放大的狀態。", {
      priority: "high",
      actionType: "increase_budget",
      targetLevel: "account",
      reasonSummary: "ROAS 達標，且預算花費率已達加碼門檻。",
      detailedReason: `目前 ROAS ${input.actual.roas}，目標 ROAS ${targetRoas}；預算花費率 ${Math.round(spendRate * 100)}%。`,
      recommendedAction: `建議先小幅加碼 ${Math.round(input.ruleSet.budgetIncreaseRatio * 100)}%，觀察 CPA / ROAS 是否仍維持在目標線內。`,
      riskNote: "不要一次拉太大，避免破壞穩定投放與學習狀態。",
      metricsSnapshot: snapshot({ spendRate, targetDailyBudget, targetRoas, targetDailyOrders }),
      ruleSnapshot: input.ruleSet,
      contextSnapshot,
    });
  }

  if (input.actual.cpa !== null && input.actual.cpa >= targetCpa * input.ruleSet.cpaStopMultiplier) {
    return one("financial_decision", "stop_loss", "有轉單，但 CPA 已經明顯高於目標，需要先止損。", {
      priority: "high",
      actionType: "decrease_budget",
      targetLevel: "account",
      reasonSummary: "CPA 超過停止門檻，短期不適合加碼。",
      detailedReason: `目前 CPA ${input.actual.cpa}，目標 CPA 約 ${round(targetCpa, 2)}，已超過 ${input.ruleSet.cpaStopMultiplier} 倍門檻。`,
      recommendedAction: `建議先降低 ${Math.round(input.ruleSet.budgetDecreaseRatio * 100)}% 預算，並檢查高花費低轉換的活動或廣告組。`,
      riskNote: "MVP 只產生建議，不會自動改 Meta 預算。",
      metricsSnapshot: snapshot({ spendRate, targetDailyBudget, targetRoas, targetDailyOrders, targetCpa }),
      ruleSnapshot: input.ruleSet,
      contextSnapshot,
    });
  }

  if (!roasAchieved) {
    const status = input.actual.roas < targetRoas * input.ruleSet.roasWarningRatio ? "needs_fix" : "observe";
    return one("financial_decision", status, "有轉單但 ROAS 尚未達標，先觀察並找出效率落差，不建議加碼。", {
      priority: status === "needs_fix" ? "medium" : "low",
      actionType: status === "needs_fix" ? "decrease_budget" : "observe",
      targetLevel: "account",
      reasonSummary: "ROAS 未達標，尚未進入可放大狀態。",
      detailedReason: `目前 ROAS ${input.actual.roas}，低於目標 ROAS ${targetRoas}。`,
      recommendedAction: status === "needs_fix" ? "先降低低效率預算並檢查素材、受眾與落地頁，不要直接加碼。" : "先維持預算觀察，等待更多轉換資料再判斷是否調整。",
      riskNote: "ROAS 未達標時加碼，可能只是把虧損放大。",
      metricsSnapshot: snapshot({ spendRate, targetDailyBudget, targetRoas, targetDailyOrders, targetCpa }),
      ruleSnapshot: input.ruleSet,
      contextSnapshot,
    });
  }

  return one("financial_decision", "observe", "目前有效率，但還沒有足夠條件判定要加碼。", {
    priority: "low",
    actionType: "observe",
    targetLevel: "account",
    reasonSummary: "ROAS 達標但預算尚未花滿，先不要急著調整。",
    detailedReason: `目前預算花費率 ${Math.round(spendRate * 100)}%，低於 ${Math.round(input.ruleSet.spendRateFullThreshold * 100)}% 加碼門檻。`,
    recommendedAction: "先觀察投放是否能穩定花出預算，再判斷是否加碼或調整受眾。",
    metricsSnapshot: snapshot({ spendRate, targetDailyBudget, targetRoas, targetDailyOrders }),
    ruleSnapshot: input.ruleSet,
    contextSnapshot,
  });
}

function one(decisionMode, overallStatus, summary, recommendation) {
  return { decisionMode, overallStatus, summary, recommendations: [recommendation] };
}

async function ensureV2Schema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS companies (
      id text PRIMARY KEY,
      user_id varchar NOT NULL REFERENCES users(id),
      brand_name varchar NOT NULL,
      company_name varchar,
      website_url varchar,
      industry varchar,
      business_model varchar NOT NULL DEFAULT 'ecommerce',
      primary_market varchar NOT NULL DEFAULT 'TW',
      currency varchar NOT NULL DEFAULT 'TWD',
      language varchar NOT NULL DEFAULT 'zh-TW',
      description text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS company_financial_profiles (
      id text PRIMARY KEY,
      company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      average_order_value numeric(12, 2),
      gross_margin_rate numeric(5, 4),
      acceptable_ad_cost_rate numeric(5, 4),
      break_even_roas numeric(8, 2),
      target_roas numeric(8, 2),
      target_cpa numeric(12, 2),
      target_cpc numeric(8, 2),
      conversion_rate numeric(8, 4),
      ltv numeric(12, 2),
      return_rate numeric(5, 4),
      shipping_cost_rate numeric(5, 4),
      payment_fee_rate numeric(5, 4),
      notes text,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS company_ad_accounts (
      id text PRIMARY KEY,
      company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      platform varchar NOT NULL DEFAULT 'meta',
      ad_account_id varchar NOT NULL,
      ad_account_name varchar,
      currency varchar,
      timezone varchar,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS product_profiles (
      id text PRIMARY KEY,
      company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      sku varchar,
      product_name varchar NOT NULL,
      product_url varchar,
      catalog_id varchar,
      content_id varchar,
      price numeric(12, 2),
      gross_margin_rate numeric(5, 4),
      product_role varchar NOT NULL DEFAULT 'main_product',
      is_consumable boolean DEFAULT false,
      repurchase_cycle_days integer,
      target_persona varchar,
      core_pain_point text,
      main_benefit text,
      fabe_notes jsonb,
      related_product_ids text[],
      notes text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS decision_rule_sets (
      id text PRIMARY KEY,
      company_id text REFERENCES companies(id) ON DELETE CASCADE,
      name varchar NOT NULL DEFAULT 'default',
      spend_rate_full_threshold numeric(5, 4) NOT NULL DEFAULT 0.95,
      initial_judgement_impressions integer NOT NULL DEFAULT 500,
      stop_loss_impressions integer NOT NULL DEFAULT 8000,
      min_active_ads_per_adset integer NOT NULL DEFAULT 3,
      cpa_warning_multiplier numeric(5, 2) NOT NULL DEFAULT 1.20,
      cpa_stop_multiplier numeric(5, 2) NOT NULL DEFAULT 1.50,
      roas_warning_ratio numeric(5, 2) NOT NULL DEFAULT 0.80,
      ctr_warning_threshold numeric(5, 2) NOT NULL DEFAULT 1.00,
      budget_increase_ratio numeric(5, 2) NOT NULL DEFAULT 0.20,
      budget_decrease_ratio numeric(5, 2) NOT NULL DEFAULT 0.20,
      observation_window_days integer NOT NULL DEFAULT 3,
      protect_learning_phase boolean NOT NULL DEFAULT true,
      avoid_editing_existing_ads boolean NOT NULL DEFAULT true,
      notes text,
      is_default boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ad_action_recommendations (
      id text PRIMARY KEY,
      user_id varchar NOT NULL REFERENCES users(id),
      company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      plan_result_id text REFERENCES plan_results(id),
      ad_account_id varchar NOT NULL,
      recommendation_date timestamp NOT NULL DEFAULT now(),
      decision_mode varchar NOT NULL,
      overall_status varchar NOT NULL,
      priority varchar NOT NULL DEFAULT 'medium',
      action_type varchar NOT NULL,
      target_level varchar NOT NULL,
      target_id varchar,
      target_name varchar,
      reason_summary text NOT NULL,
      detailed_reason text,
      recommended_action text NOT NULL,
      risk_note text,
      metrics_snapshot jsonb NOT NULL,
      rule_snapshot jsonb NOT NULL,
      context_snapshot jsonb,
      approval_status varchar NOT NULL DEFAULT 'pending',
      approved_at timestamp,
      executed_at timestamp,
      rejected_at timestamp,
      operator_note text,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ad_action_logs (
      id text PRIMARY KEY,
      recommendation_id text NOT NULL REFERENCES ad_action_recommendations(id) ON DELETE CASCADE,
      user_id varchar NOT NULL REFERENCES users(id),
      company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      action varchar NOT NULL,
      note text,
      metadata jsonb,
      created_at timestamp DEFAULT now()
    )
  `;
}

function normalizeRules(ruleSet) {
  return {
    spendRateFullThreshold: toNumber(ruleSet?.spendRateFullThreshold, DEFAULT_RULES.spendRateFullThreshold),
    initialJudgementImpressions: toNumber(ruleSet?.initialJudgementImpressions, DEFAULT_RULES.initialJudgementImpressions),
    stopLossImpressions: toNumber(ruleSet?.stopLossImpressions, DEFAULT_RULES.stopLossImpressions),
    minActiveAdsPerAdset: toNumber(ruleSet?.minActiveAdsPerAdset, DEFAULT_RULES.minActiveAdsPerAdset),
    cpaWarningMultiplier: toNumber(ruleSet?.cpaWarningMultiplier, DEFAULT_RULES.cpaWarningMultiplier),
    cpaStopMultiplier: toNumber(ruleSet?.cpaStopMultiplier, DEFAULT_RULES.cpaStopMultiplier),
    roasWarningRatio: toNumber(ruleSet?.roasWarningRatio, DEFAULT_RULES.roasWarningRatio),
    ctrWarningThreshold: toNumber(ruleSet?.ctrWarningThreshold, DEFAULT_RULES.ctrWarningThreshold),
    budgetIncreaseRatio: toNumber(ruleSet?.budgetIncreaseRatio, DEFAULT_RULES.budgetIncreaseRatio),
    budgetDecreaseRatio: toNumber(ruleSet?.budgetDecreaseRatio, DEFAULT_RULES.budgetDecreaseRatio),
    observationWindowDays: toNumber(ruleSet?.observationWindowDays, DEFAULT_RULES.observationWindowDays),
    protectLearningPhase: ruleSet?.protectLearningPhase ?? DEFAULT_RULES.protectLearningPhase,
    avoidEditingExistingAds: ruleSet?.avoidEditingExistingAds ?? DEFAULT_RULES.avoidEditingExistingAds,
  };
}

function renderAppShell(env) {
  const loginUrl = "/api/auth/google";
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>小黑幫你調廣告</title>
  <style>
    :root{color-scheme:light;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--soft:#f8fafc;--brand:#111827;--ok:#047857;--warn:#b45309;--bad:#b91c1c}
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8fafc;color:var(--ink)}
    main{max-width:1120px;margin:0 auto;padding:28px 18px 56px}
    header{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:20px}
    h1{font-size:28px;margin:0 0 4px;letter-spacing:0}
    h2{font-size:22px;margin:0 0 8px}
    h3{font-size:16px;margin:0 0 8px}
    p{color:#475569;line-height:1.65;margin:6px 0}
    button,a.btn{border:0;background:var(--brand);color:white;padding:10px 14px;border-radius:8px;text-decoration:none;cursor:pointer;font-weight:650}
    button.secondary,a.secondary{background:white;color:var(--ink);border:1px solid var(--line)}
    button.ghost{background:transparent;color:var(--ink);border:1px solid transparent}
    button:disabled{opacity:.45;cursor:not-allowed}
    input,select{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:11px 12px;margin:7px 0 14px;background:white;color:var(--ink)}
    label{display:block;font-size:13px;font-weight:700;color:#334155}
    .topline{font-size:13px;color:var(--muted)}
    .shell{display:grid;grid-template-columns:260px minmax(0,1fr);gap:18px}
    .panel{background:white;border:1px solid var(--line);border-radius:8px;padding:20px}
    .step-list{display:grid;gap:10px}
    .step{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:8px;background:white}
    .step.active{border-color:#111827;box-shadow:0 0 0 1px #111827 inset}
    .step.done .num{background:var(--ok)}
    .num{width:24px;height:24px;border-radius:999px;background:#94a3b8;color:white;display:grid;place-items:center;font-size:13px;font-weight:800;flex:0 0 auto}
    .step b{display:block;font-size:14px}
    .step span{display:block;font-size:12px;color:var(--muted);margin-top:2px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
    .card{border:1px solid var(--line);border-radius:8px;padding:14px;margin:10px 0;background:white}
    .card.selected{border-color:#111827;box-shadow:0 0 0 1px #111827 inset}
    .card.clickable{cursor:pointer}
    .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:14px 0}
    .metric{border:1px solid var(--line);border-radius:8px;padding:12px;background:#f8fafc}
    .metric b{font-size:18px}
    .metric span{display:block;font-size:12px;color:var(--muted);margin-top:3px}
    .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
    .message{border:1px solid #bae6fd;background:#f0f9ff;color:#075985;border-radius:8px;padding:12px;margin-bottom:14px}
    .error{border-color:#fecaca;background:#fef2f2;color:#991b1b}
    .muted{font-size:13px;color:var(--muted)}
    .empty{border:1px dashed #cbd5e1;border-radius:8px;padding:18px;text-align:center;color:var(--muted)}
    .badge{display:inline-flex;align-items:center;border-radius:999px;background:#f1f5f9;color:#334155;padding:4px 8px;font-size:12px;font-weight:700}
    .summary{display:grid;gap:10px;margin-top:14px}
    .summary div{border-top:1px solid var(--line);padding-top:10px}
    @media(max-width:820px){main{padding-top:18px}.shell{grid-template-columns:1fr}header{align-items:flex-start;flex-direction:column}.step-list{grid-template-columns:1fr 1fr}.panel{padding:16px}}
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>小黑幫你調廣告</h1>
        <p>Adcheck Beta · Cloudflare Worker</p>
      </div>
      <a class="btn" href="${loginUrl}" id="login">登入</a>
    </header>
    <section class="panel" id="app">載入中...</section>
  </main>
  <script>
    const app = document.getElementById('app');
    let state = {
      user: null,
      companies: [],
      companyContexts: [],
      plans: [],
      metaAccounts: [],
      recommendations: [],
      selectedCompanyId: '',
      selectedPlanId: '',
      selectedAdAccountId: '',
      message: '',
      messageType: 'info',
      loading: false
    };
    const $ = (id) => document.getElementById(id);
    async function api(path, options = {}) {
      const res = await fetch(path, { credentials: 'include', headers: { 'content-type': 'application/json' }, ...options });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || res.statusText);
      return data;
    }
    async function init() {
      const auth = await fetch('/api/auth/check', { credentials: 'include' });
      if (!auth.ok) {
        app.innerHTML = '<h2>需要登入</h2><p>登入後即可建立公司、綁定 Meta 廣告帳號並產生巡帳建議。</p><a class="btn" href="/api/auth/google">使用 ECCAL 登入</a>';
        return;
      }
      const data = await auth.json();
      state.user = data.user;
      document.getElementById('login').textContent = data.user.email || '已登入';
      await refresh();
    }
    async function refresh() {
      state.loading = true;
      renderLoading();
      const [companies, plans, recs, metaAccounts] = await Promise.all([
        api('/api/v2/companies'),
        api('/api/v2/plans'),
        api('/api/v2/ad-decision/recommendations'),
        api('/api/v2/meta/accounts').catch(() => ({ data: [], metaUnavailable: true }))
      ]);
      state.companies = companies.data || [];
      state.companyContexts = await Promise.all(
        state.companies.map(async (company) => {
          try {
            const context = await api('/api/v2/companies/' + encodeURIComponent(company.id));
            return context.data;
          } catch {
            return { company, adAccounts: [] };
          }
        })
      );
      state.plans = plans.data || [];
      state.recommendations = recs.data || [];
      state.metaAccounts = metaAccounts.data || [];
      state.selectedCompanyId = state.selectedCompanyId || state.companies[0]?.id || '';
      state.selectedPlanId = state.selectedPlanId || state.plans[0]?.id || '';
      state.selectedAdAccountId = state.selectedAdAccountId || firstLinkedAccount()?.adAccountId || '';
      state.loading = false;
      render();
    }
    function renderLoading() {
      app.innerHTML = '<h2>讀取資料中</h2><p>正在同步品牌、KPI Plan 與 Meta 帳號資料。</p>';
    }
    function render() {
      const step = currentStep();
      app.className = 'panel';
      app.innerHTML =
        messageHtml() +
        '<div class="shell">' +
          '<aside>' + stepListHtml(step) + summaryHtml() + '</aside>' +
          '<section>' + stepContentHtml(step) + '</section>' +
        '</div>';
    }
    function currentStep() {
      if (!state.companies.length) return 1;
      if (!state.selectedPlanId) return 2;
      if (!linkedAccountsForSelectedCompany().length) return 3;
      return 4;
    }
    function stepListHtml(active) {
      const items = [
        ['品牌', '建立或選擇要巡帳的品牌'],
        ['KPI Plan', '選擇這次判斷的目標'],
        ['Meta 帳號', '綁定要讀取的廣告帳號'],
        ['巡帳建議', '產生並處理建議']
      ];
      return '<div class="step-list">' + items.map((item, index) => {
        const n = index + 1;
        const cls = n === active ? 'step active' : n < active ? 'step done' : 'step';
        return '<div class="'+cls+'"><div class="num">'+n+'</div><div><b>'+item[0]+'</b><span>'+item[1]+'</span></div></div>';
      }).join('') + '</div>';
    }
    function stepContentHtml(step) {
      if (step === 1) return brandStepHtml();
      if (step === 2) return planStepHtml();
      if (step === 3) return metaStepHtml();
      return decisionStepHtml();
    }
    function brandStepHtml() {
      return '<h2>先建立你的品牌</h2>' +
        '<p>巡帳建議會綁在品牌底下，之後要做收費、用量紀錄、多人管理都會比較乾淨。</p>' +
        existingCompaniesHtml() +
        '<div class="grid">' +
          '<div><label>品牌名稱</label><input id="brandName" placeholder="例如：黑膠保養所"></div>' +
          '<div><label>網站</label><input id="websiteUrl" placeholder="https://example.com"></div>' +
          '<div><label>主要市場</label><select id="primaryMarket"><option value="TW">台灣</option><option value="JP">日本</option><option value="US">美國</option></select></div>' +
          '<div><label>幣別</label><select id="currency"><option value="TWD">TWD</option><option value="JPY">JPY</option><option value="USD">USD</option></select></div>' +
        '</div>' +
        '<div class="actions"><button onclick="createCompany()">建立品牌並繼續</button></div>';
    }
    function existingCompaniesHtml() {
      if (!state.companies.length) return '';
      return '<h3>已建立品牌</h3>' + state.companies.map(company => {
        const selected = company.id === state.selectedCompanyId ? ' selected' : '';
        return '<div class="card clickable'+selected+'" onclick="selectCompany(\\''+escAttr(company.id)+'\\')"><b>'+esc(company.brandName)+'</b><p class="muted">'+esc(company.websiteUrl || '未填網站')+'</p></div>';
      }).join('');
    }
    function planStepHtml() {
      if (!state.plans.length) {
        return '<h2>先建立 KPI Plan</h2><p>Adcheck 會用既有 ECCAL KPI Plan 判斷 ROAS、日預算、訂單目標是否達標。</p><div class="empty">目前沒有可用的 Plan。請先回 ECCAL 建立活動預算 / KPI Plan。</div><div class="actions"><a class="btn" href="https://eccal.thinkwithblack.com/campaign-planner">建立 KPI Plan</a><button class="secondary" onclick="refresh()">重新整理</button></div>';
      }
      return '<h2>選擇這次巡帳的 KPI Plan</h2><p>這一步決定系統拿什麼目標線來判斷是否加碼、觀察或止損。</p>' +
        '<div>' + state.plans.map(plan => planCardHtml(plan)).join('') + '</div>' +
        '<div class="actions"><button onclick="goToStep(3)" '+(!state.selectedPlanId ? 'disabled' : '')+'>使用這個 Plan</button><button class="secondary" onclick="goToStep(1)">回品牌</button></div>';
    }
    function planCardHtml(plan) {
      const selected = plan.id === state.selectedPlanId ? ' selected' : '';
      return '<div class="card clickable'+selected+'" onclick="selectPlan(\\''+escAttr(plan.id)+'\\')"><div class="badge">'+esc(plan.currency || 'TWD')+'</div><h3>'+esc(plan.planName || '未命名 Plan')+'</h3><div class="metrics"><div class="metric"><b>'+formatMoney(plan.targetRevenue)+'</b><span>目標營收</span></div><div class="metric"><b>'+formatMoney(plan.dailyAdBudget)+'</b><span>日預算</span></div><div class="metric"><b>'+esc(plan.targetRoas || '-')+'</b><span>目標 ROAS</span></div><div class="metric"><b>'+esc(plan.requiredOrders || '-')+'</b><span>目標訂單</span></div></div></div>';
    }
    function metaStepHtml() {
      const linked = linkedAccountsForSelectedCompany();
      const metaChoices = state.metaAccounts.length
        ? '<h3>從 Meta 授權帳號選擇</h3>' + state.metaAccounts.map(account => '<div class="card clickable" onclick="fillMetaAccount(\\''+escAttr(account.id)+'\\',\\''+escAttr(account.name || account.id)+'\\')"><b>'+esc(account.name || account.id)+'</b><p class="muted">'+esc(account.id)+'</p></div>').join('')
        : '<div class="empty">沒有讀到 Meta 帳號清單。你仍可先手動填 ad account id；如果之後跑巡帳出現 token 錯誤，再回 ECCAL 重新授權 Meta。</div>';
      return '<h2>綁定 Meta 廣告帳號</h2><p>Adcheck 只會讀取成效並產生建議，MVP 不會直接修改 Meta 廣告。</p>' +
        (linked.length ? '<h3>已綁定</h3>' + linked.map(a => '<div class="card"><b>'+esc(a.adAccountName || a.adAccountId)+'</b><p class="muted">'+esc(a.adAccountId)+'</p></div>').join('') : '') +
        metaChoices +
        '<h3>手動綁定</h3><div class="grid"><div><label>Ad account ID</label><input id="adAccountId" placeholder="act_123456789"></div><div><label>顯示名稱</label><input id="adAccountName" placeholder="主帳號 / 台灣站 / 日本站"></div></div>' +
        '<div class="actions"><button onclick="linkAccount()">綁定並繼續</button><a class="secondary btn" href="https://eccal.thinkwithblack.com/facebook-setup">回 ECCAL 授權 Meta</a><button class="secondary" onclick="goToStep(2)">回 Plan</button></div>';
    }
    function decisionStepHtml() {
      const linked = linkedAccountsForSelectedCompany();
      const selectedPlan = state.plans.find(p => p.id === state.selectedPlanId);
      const latest = state.recommendations.filter(r => !state.selectedCompanyId || r.companyId === state.selectedCompanyId).slice(0, 5);
      return '<h2>產生巡帳建議</h2><p>系統會讀 Meta 近 28 天帳戶成效，套用 deterministic rules，產生人工審核建議。</p>' +
        '<div class="grid"><div><label>KPI Plan</label><select id="runPlanId">'+state.plans.map(p => '<option value="'+escAttr(p.id)+'" '+(p.id===state.selectedPlanId?'selected':'')+'>'+esc(p.planName || p.id)+'</option>').join('')+'</select></div><div><label>Meta 帳號</label><select id="runAdAccountId">'+linked.map(a => '<option value="'+escAttr(a.adAccountId)+'" '+(a.adAccountId===state.selectedAdAccountId?'selected':'')+'>'+esc(a.adAccountName || a.adAccountId)+'</option>').join('')+'</select></div></div>' +
        (selectedPlan ? '<div class="metrics"><div class="metric"><b>'+formatMoney(selectedPlan.dailyAdBudget)+'</b><span>日預算</span></div><div class="metric"><b>'+esc(selectedPlan.targetRoas || '-')+'</b><span>目標 ROAS</span></div><div class="metric"><b>'+esc(selectedPlan.requiredOrders || '-')+'</b><span>目標訂單</span></div></div>' : '') +
        '<div class="actions"><button onclick="runDecision()">開始巡帳</button><button class="secondary" onclick="goToStep(3)">回 Meta</button></div>' +
        '<h3>最近建議</h3>' + (latest.length ? latest.map(recommendationHtml).join('') : '<div class="empty">尚未產生建議。</div>');
    }
    function recommendationHtml(r) {
      return '<div class="card"><div class="badge">'+esc(statusLabel(r.overallStatus))+'</div><h3>'+esc(actionLabel(r.actionType))+'</h3><p>'+esc(r.reasonSummary)+'</p><p>'+esc(r.recommendedAction)+'</p><div class="actions"><button data-id="'+escAttr(r.id)+'" data-status="approved" onclick="setStatus(this.dataset.id,this.dataset.status)">採納</button><button class="secondary" data-id="'+escAttr(r.id)+'" data-status="rejected" onclick="setStatus(this.dataset.id,this.dataset.status)">拒絕</button><button class="secondary" data-id="'+escAttr(r.id)+'" data-status="dismissed" onclick="setStatus(this.dataset.id,this.dataset.status)">略過</button></div></div>';
    }
    function summaryHtml() {
      const company = state.companies.find(c => c.id === state.selectedCompanyId);
      const plan = state.plans.find(p => p.id === state.selectedPlanId);
      const linked = linkedAccountsForSelectedCompany();
      return '<div class="panel summary"><h3>目前設定</h3><div><b>品牌</b><p class="muted">'+esc(company?.brandName || '尚未選擇')+'</p></div><div><b>KPI Plan</b><p class="muted">'+esc(plan?.planName || '尚未選擇')+'</p></div><div><b>Meta 帳號</b><p class="muted">'+(linked.map(a => esc(a.adAccountName || a.adAccountId)).join('、') || '尚未綁定')+'</p></div></div>';
    }
    function messageHtml() {
      if (!state.message) return '';
      const cls = state.messageType === 'error' ? 'message error' : 'message';
      return '<div class="'+cls+'">'+esc(state.message)+'</div>';
    }
    async function createCompany() {
      try {
        state.message = '';
        const brandName = $('brandName').value.trim();
        const websiteUrl = $('websiteUrl').value.trim();
        const primaryMarket = $('primaryMarket').value;
        const currency = $('currency').value;
        if (!brandName) throw new Error('請先輸入品牌名稱');
        const result = await api('/api/v2/companies', { method:'POST', body: JSON.stringify({ brandName, websiteUrl, primaryMarket, currency }) });
        state.selectedCompanyId = result.data.id;
        state.messageType = 'info';
        state.message = '公司已建立';
        await refresh();
      } catch (error) {
        state.messageType = 'error';
        state.message = error.message || '公司建立失敗';
        render();
      }
    }
    async function linkAccount() {
      try {
        state.message = '';
        const companyId = $('companyId').value;
        const adAccountId = $('adAccountId').value.trim();
        const adAccountName = $('adAccountName').value.trim();
        if (!companyId) throw new Error('請先建立或選擇公司');
        if (!adAccountId) throw new Error('請輸入 Meta ad account id，例如 act_123456789');
        await api('/api/v2/companies/' + encodeURIComponent(companyId) + '/ad-accounts', {
          method:'POST',
          body: JSON.stringify({ adAccountId, adAccountName, platform:'meta' })
        });
        state.selectedAdAccountId = adAccountId;
        state.messageType = 'info';
        state.message = 'Meta 帳號已綁定：' + adAccountId;
        await refresh();
      } catch (error) {
        state.messageType = 'error';
        state.message = error.message || 'Meta 帳號綁定失敗';
        render();
      }
    }
    async function runDecision() {
      try {
        state.message = '';
        const companyId = state.selectedCompanyId;
        const planResultId = $('runPlanId').value;
        const adAccountId = $('runAdAccountId').value;
        if (!companyId) throw new Error('請先選擇公司');
        if (!planResultId) throw new Error('請先建立 KPI Plan');
        if (!adAccountId) throw new Error('請先選擇已綁定 Meta 帳號');
        state.selectedPlanId = planResultId;
        state.selectedAdAccountId = adAccountId;
        const result = await api('/api/v2/ad-decision/run', { method:'POST', body: JSON.stringify({ companyId, planResultId, adAccountId }) });
        state.messageType = 'info';
        state.message = result.data.summary;
        await refresh();
      } catch (error) {
        state.messageType = 'error';
        state.message = error.message || '巡帳失敗';
        render();
      }
    }
    async function setStatus(id, status) {
      await api('/api/v2/ad-decision/recommendations/' + id + '/status', { method:'PATCH', body: JSON.stringify({ status }) });
      state.messageType = 'info';
      state.message = '建議狀態已更新';
      await refresh();
    }
    function selectCompany(id) {
      state.selectedCompanyId = id;
      state.selectedAdAccountId = firstLinkedAccount()?.adAccountId || '';
      render();
    }
    function selectPlan(id) {
      state.selectedPlanId = id;
      render();
    }
    function fillMetaAccount(id, name) {
      $('adAccountId').value = id;
      $('adAccountName').value = name;
    }
    function goToStep(step) {
      if (step === 1 || step === 2 || step === 3 || step === 4) renderForcedStep(step);
    }
    function renderForcedStep(step) {
      app.innerHTML = messageHtml() + '<div class="shell"><aside>' + stepListHtml(step) + summaryHtml() + '</aside><section>' + stepContentHtml(step) + '</section></div>';
    }
    function linkedAccountsForSelectedCompany() {
      const context = state.companyContexts.find(ctx => ctx.company?.id === state.selectedCompanyId);
      return context?.adAccounts || [];
    }
    function firstLinkedAccount() {
      return linkedAccountsForSelectedCompany()[0] || null;
    }
    function formatMoney(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '-';
      return Math.round(number).toLocaleString('zh-TW');
    }
    function statusLabel(value) {
      return ({can_scale:'可加碼',observe:'觀察',needs_fix:'需修正',stop_loss:'止損',insufficient_data:'資料不足'}[value] || value);
    }
    function actionLabel(value) {
      return ({increase_budget:'提高預算',decrease_budget:'降低預算',add_creatives:'新增素材',observe:'觀察',fix_tracking:'修追蹤',improve_landing_page:'改善落地頁'}[value] || value);
    }
    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    }
    function escAttr(value) {
      return esc(value).replace(new RegExp(String.fromCharCode(96), 'g'), '&#96;');
    }
    init().catch(err => { app.innerHTML = '<h2>載入失敗</h2><pre>'+err.message+'</pre>'; });
  </script>
</body>
</html>`;
}

function safeUser(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImageUrl: user.profileImageUrl,
    membershipLevel: user.membershipLevel,
    credits: user.credits,
    hasFacebookAuth: Boolean(user.metaAccessToken),
    hasSelectedAdAccount: Boolean(user.metaAdAccountId),
    metaAdAccountId: user.metaAdAccountId,
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function html(markup, status = 200) {
  return new Response(markup, { status, headers: HTML_HEADERS });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function assertEnv(env) {
  for (const key of ["DATABASE_URL", "JWT_SECRET"]) {
    if (!env[key]) throw new Error(`${key} is required`);
  }
}

function requiredString(value, key) {
  if (typeof value !== "string" || !value.trim()) throw apiError(`${key.toUpperCase()}_REQUIRED`, 400);
  return value.trim();
}

function nullableString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function extractActionCount(actions, keys) {
  if (!Array.isArray(actions)) return 0;
  return actions
    .filter((item) => keys.includes(item.action_type))
    .reduce((sum, item) => sum + toNumber(item.value), 0);
}

function camelizeRows(rows) {
  return rows.map(camelizeRow);
}

function camelizeRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }
  return out;
}

function apiError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function base64UrlToBytes(value) {
  const binary = base64UrlDecode(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function cookieValue(name, value, maxAge) {
  const encoded = encodeURIComponent(value || "");
  return `${name}=${encoded}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function emptyCorsResponse() {
  return new Response(null, { status: 204 });
}
