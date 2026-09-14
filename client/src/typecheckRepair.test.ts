import assert from "node:assert/strict";
import test from "node:test";

import { getAvailableLocales, getTranslations } from "./lib/i18n";
import {
  parseMetaPurchaseEventsResponse,
  parseMetaTriggerResponse,
  readAnalyticsQueryResult,
  readNpsRatingsResponse,
} from "./typecheckRepairContracts";
import { convertCurrency } from "../../shared/currency";
import { buildNpsRatingsPayload } from "../../server/typecheckRepairTypes";

const analyticsFixture = {
  totalRevenue: 12345,
  ecommercePurchases: 12,
  sessions: 321,
  averageOrderValue: 1024.6,
  conversionRate: 3.456,
};

test("Analytics query result preserves empty data and projects real values", async () => {
  assert.deepEqual(
    await readAnalyticsQueryResult(async () => ({ data: analyticsFixture })),
    {
      averageOrderValue: 1025,
      conversionRate: 3.46,
    },
  );
  assert.equal(
    await readAnalyticsQueryResult(async () => ({ data: undefined })),
    null,
  );
});

test("Analytics query errors remain errors", async () => {
  const expected = new Error("analytics failed");
  await assert.rejects(
    readAnalyticsQueryResult(async () => {
      throw expected;
    }),
    error => error === expected,
  );
});

const throughHttpJson = <Value>(value: Value): unknown =>
  JSON.parse(JSON.stringify(value));

test("NPS parser accepts reachable handler output for empty and populated query rows", async () => {
  const emptyNpsFixture = throughHttpJson(buildNpsRatingsPayload([]));
  assert.deepEqual(
    await readNpsRatingsResponse({ json: async () => emptyNpsFixture }),
    emptyNpsFixture,
  );

  const populated = throughHttpJson(buildNpsRatingsPayload([{
      id: "rating-1",
      userId: "member-1",
      userEmail: null,
      userName: "Synthetic member",
      npsScore: 9,
      npsComment: null,
      npsSubmittedAt: new Date("2026-09-09T00:00:00.000Z"),
      adAccountName: "Synthetic account",
      industryType: "ecommerce",
    }]));
  assert.deepEqual(
    await readNpsRatingsResponse({ json: async () => populated }),
    populated,
  );
});

test("NPS malformed data and JSON errors remain failures", async () => {
  await assert.rejects(
    readNpsRatingsResponse({ json: async () => ({ ratings: [] }) }),
    /Invalid NPS ratings response/,
  );
  const expected = new Error("json failed");
  await assert.rejects(
    readNpsRatingsResponse({
      json: async () => {
        throw expected;
      },
    }),
    error => error === expected,
  );
});

test("Meta purchase response distinguishes event, empty, provider failure, and malformed data", () => {
  const event = {
    paymentType: "card",
    amount: 1200,
    currency: "TWD",
    transactionId: "txn-synthetic",
    timestamp: "2026-09-09T00:00:00.000Z",
  };
  assert.deepEqual(
    parseMetaPurchaseEventsResponse({ success: true, event }),
    { success: true, event },
  );
  assert.deepEqual(
    parseMetaPurchaseEventsResponse({ success: true, event: null }),
    { success: true, event: null },
  );
  assert.deepEqual(
    parseMetaPurchaseEventsResponse({ success: false, error: "provider failed" }),
    { success: false, error: "provider failed" },
  );
  assert.throws(
    () => parseMetaPurchaseEventsResponse({ success: true }),
    /Invalid Meta purchase event response/,
  );
});

test("Meta trigger response preserves success, failure, and malformed branches", () => {
  assert.deepEqual(
    parseMetaTriggerResponse({
      success: true,
      message: "triggered",
      eventId: "event-synthetic",
    }),
    { success: true, message: "triggered", eventId: "event-synthetic" },
  );
  assert.deepEqual(
    parseMetaTriggerResponse({ success: false, error: "trigger failed" }),
    { success: false, error: "trigger failed" },
  );
  assert.throws(
    () => parseMetaTriggerResponse({ success: true, eventId: "missing-message" }),
    /Invalid Meta trigger response/,
  );
});

test("all supported locales provide the required existing text", () => {
  const locales = getAvailableLocales().sort();
  assert.deepEqual(locales, ["en", "ja", "zh-TW"]);
  for (const locale of locales) {
    const translations = getTranslations(locale);
    assert.ok(translations.checkout.title.trim());
    assert.ok(translations.checkout.subtitle.trim());
    assert.ok(translations.about.founder.vision.trim());
  }
});

test("Traditional Chinese checkout keys preserve the existing checkout screen text", () => {
  assert.deepEqual(getTranslations("zh-TW").checkout, {
    title: "升級至 Pro 方案",
    subtitle: "解鎖所有功能，享受完整的廣告分析體驗",
    loginRequired: "需要登入",
    loginRequiredDesc: "請先登入您的 Google 帳戶以繼續付款流程",
    subscriptionError: "付款初始化失敗",
    subscriptionErrorDesc: "無法初始化付款",
    preparingPayment: "正在準備付款...",
    backToPricing: "返回定價頁面",
    user: "用戶:",
    planFeatures: "方案內容:",
    securePayment: "安全付款",
  });
});

test("unknown currency conversion keeps the original amount", () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    assert.equal(convertCurrency(120, "XYZ", "TWD"), 120);
    assert.equal(convertCurrency(120, "TWD", "XYZ"), 120);
  } finally {
    console.warn = originalWarn;
  }
});
