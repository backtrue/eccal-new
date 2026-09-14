import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

const syntheticSecret = "synthetic-jwt-secret-for-typecheck-repair";
process.env.JWT_SECRET = syntheticSecret;

const { generateToken, isJwtPayload, verifyToken } = await import("./jwt-auth");

test("generateToken and verifyToken preserve member id, nullable email, and seven-day expiry", () => {
  const token = generateToken({ id: "member-synthetic", email: null });
  const payload = verifyToken(token);

  assert.equal(payload.userId, "member-synthetic");
  assert.equal(payload.email, null);
  assert.equal(payload.exp - payload.iat, 7 * 24 * 60 * 60);
});

test("verifyToken accepts the existing string email payload", () => {
  const token = generateToken({ id: "member-with-email", email: "member@example.test" });
  const payload = verifyToken(token);

  assert.equal(payload.userId, "member-with-email");
  assert.equal(payload.email, "member@example.test");
});

test("verifyToken rejects signed values that are not the legal member payload", () => {
  const stringToken = jwt.sign("not-a-member-payload", syntheticSecret);
  assert.throws(() => verifyToken(stringToken), /Invalid JWT payload/);

  const wrongEmailToken = jwt.sign(
    { userId: "member-synthetic", email: 42 },
    syntheticSecret,
    { expiresIn: "7d" },
  );
  assert.throws(() => verifyToken(wrongEmailToken), /Invalid JWT payload/);
});

test("verifyToken rejects a token with a modified signature", () => {
  const token = generateToken({ id: "member-synthetic", email: null });
  const replacement = token.endsWith("a") ? "b" : "a";
  const tampered = `${token.slice(0, -1)}${replacement}`;

  assert.throws(() => verifyToken(tampered));
});

test("payload guard rejects missing timestamps without inventing defaults", () => {
  assert.equal(isJwtPayload({ userId: "member-synthetic", email: null }), false);
});
