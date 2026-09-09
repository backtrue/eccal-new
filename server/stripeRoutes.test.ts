import assert from "node:assert/strict";
import test from "node:test";
import {
  STRIPE_API_VERSION,
  getPaymentIntentClientSecret,
  resolveEccalPurchasePlan,
  restorePaymentSession,
} from "./typecheckRepairTypes";

test("uses the approved Stripe API version", () => {
  assert.equal(STRIPE_API_VERSION, "2023-10-16");
});

test("reads a client secret only from an expanded payment intent", () => {
  assert.equal(getPaymentIntentClientSecret(null), null);
  assert.equal(getPaymentIntentClientSecret("in_123"), null);
  assert.equal(getPaymentIntentClientSecret({ payment_intent: "pi_123" }), null);
  assert.equal(
    getPaymentIntentClientSecret({
      payment_intent: { client_secret: "pi_secret_123" },
    }),
    "pi_secret_123",
  );
});

test("maps Stripe purchase types to the database enum", () => {
  assert.deepEqual(resolveEccalPurchasePlan("monthly", 999), {
    planType: "monthly",
    purchaseAmount: 1280,
    isFounders: false,
  });
  assert.deepEqual(resolveEccalPurchasePlan("annual", 999), {
    planType: "annual",
    purchaseAmount: 12800,
    isFounders: false,
  });
  assert.deepEqual(resolveEccalPurchasePlan("founders_membership", 999), {
    planType: "founders",
    purchaseAmount: 5990,
    isFounders: true,
  });
  assert.deepEqual(resolveEccalPurchasePlan("lifetime", 999), {
    planType: "founders",
    purchaseAmount: 5990,
    isFounders: true,
  });
  assert.deepEqual(resolveEccalPurchasePlan("custom", 4525), {
    planType: "monthly",
    purchaseAmount: 45.25,
    isFounders: false,
  });
});

test("waits for Passport login and propagates session errors", async () => {
  const user = { id: "member-123" };
  let observedUser: typeof user | undefined;

  await restorePaymentSession((sessionUser, done) => {
    observedUser = sessionUser;
    done();
  }, user);
  assert.equal(observedUser, user);

  const expected = new Error("session save failed");
  await assert.rejects(
    restorePaymentSession((_sessionUser, done) => done(expected), user),
    expected,
  );
});
