import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
} from "node:crypto";

const AES_ALGORITHM = "aes-256-gcm";
const AES_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const SUBJECT_HMAC_KEY_PURPOSE =
  "thinkwithblack/gsc/google-subject-hmac-key/v1";
const SUBJECT_HMAC_VALUE_PURPOSE =
  "thinkwithblack/gsc/google-subject-hash/v1";
const CREDENTIAL_AAD_PURPOSE = "thinkwithblack/gsc/credential-envelope/v1";
const PKCE_AAD_PURPOSE = "thinkwithblack/gsc/pkce-verifier/v1";
const OPAQUE_PROOF_PURPOSE = "thinkwithblack/gsc/opaque-proof/v1";
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export const GSC_CREDENTIAL_FORMAT_VERSION = 1 as const;

export type GscCredentialBinding = Readonly<{
  userId: string;
  connectionId: string;
  googleClientId: string;
  generation: number;
  formatVersion: typeof GSC_CREDENTIAL_FORMAT_VERSION;
}>;

export type GscCredentialPlaintext = Readonly<{
  refreshToken: string;
  googleSubject: string;
  displayEmail: string;
  grantedScopes: readonly string[];
}>;

export type GscPkceBinding = Readonly<{
  userId: string;
  connectionId: string;
  googleClientId: string;
  redirectUri: string;
  generation: number;
  browserSessionHash: string;
  stateHash: string;
  formatVersion: typeof GSC_CREDENTIAL_FORMAT_VERSION;
}>;

export type GscOpaqueProofKind =
  | "ticket"
  | "state"
  | "browser_session"
  | "oidc_nonce";

export type GscEncryptedEnvelope = Readonly<{
  formatVersion: typeof GSC_CREDENTIAL_FORMAT_VERSION;
  nonce: string;
  ciphertext: string;
  authTag: string;
}>;

export type GscCredentialServiceDependencies = Readonly<{
  credentialKey: Uint8Array;
  randomBytes?: (length: number) => Uint8Array;
}>;

export type GscCredentialService = Readonly<{
  encryptCredentialEnvelope: (
    binding: GscCredentialBinding,
    credential: GscCredentialPlaintext,
  ) => GscEncryptedEnvelope;
  decryptCredentialEnvelope: (
    binding: GscCredentialBinding,
    envelope: GscEncryptedEnvelope,
  ) => GscCredentialPlaintext;
  encryptPkceVerifier: (
    binding: GscPkceBinding,
    verifier: string,
  ) => GscEncryptedEnvelope;
  decryptPkceVerifier: (
    binding: GscPkceBinding,
    envelope: GscEncryptedEnvelope,
  ) => string;
  hashGoogleSubject: (googleClientId: string, googleSubject: string) => string;
  hashOpaqueProof: (kind: GscOpaqueProofKind, value: string) => string;
}>;

export class GscCredentialServiceError extends Error {
  readonly code = "GSC_CREDENTIAL_INVALID" as const;

  constructor() {
    super("GSC credential operation failed");
    this.name = "GscCredentialServiceError";
  }
}

function fail(): never {
  throw new GscCredentialServiceError();
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonemptyString(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : fail();
}

function requireGeneration(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : fail();
}

function encodeStructured(purpose: string, values: readonly string[]): Buffer {
  return Buffer.from(JSON.stringify([purpose, ...values]), "utf8");
}

function credentialAad(binding: GscCredentialBinding): Buffer {
  return encodeStructured(CREDENTIAL_AAD_PURPOSE, [
    requireNonemptyString(binding.userId),
    requireNonemptyString(binding.connectionId),
    requireNonemptyString(binding.googleClientId),
    String(requireGeneration(binding.generation)),
    String(binding.formatVersion),
  ]);
}

function pkceAad(binding: GscPkceBinding): Buffer {
  return encodeStructured(PKCE_AAD_PURPOSE, [
    requireNonemptyString(binding.userId),
    requireNonemptyString(binding.connectionId),
    requireNonemptyString(binding.googleClientId),
    requireNonemptyString(binding.redirectUri),
    String(requireGeneration(binding.generation)),
    requireNonemptyString(binding.browserSessionHash),
    requireNonemptyString(binding.stateHash),
    String(binding.formatVersion),
  ]);
}

function requireCurrentVersion(value: unknown): void {
  if (value !== GSC_CREDENTIAL_FORMAT_VERSION) {
    fail();
  }
}

function decodeBase64Url(value: unknown, expectedBytes?: number): Buffer {
  const encoded = requireNonemptyString(value);
  if (!BASE64URL_PATTERN.test(encoded)) {
    fail();
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (
    decoded.length === 0 ||
    decoded.toString("base64url") !== encoded ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    fail();
  }
  return decoded;
}

function parseEnvelope(value: unknown): Readonly<{
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
}> {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["authTag", "ciphertext", "formatVersion", "nonce"])
  ) {
    fail();
  }
  requireCurrentVersion(value.formatVersion);
  return {
    nonce: decodeBase64Url(value.nonce, GCM_NONCE_BYTES),
    ciphertext: decodeBase64Url(value.ciphertext),
    authTag: decodeBase64Url(value.authTag, GCM_TAG_BYTES),
  };
}

function validateScopes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail();
  }
  const scopes = value.map(requireNonemptyString);
  if (new Set(scopes).size !== scopes.length) {
    fail();
  }
  return Object.freeze(scopes);
}

function serializeCredential(value: GscCredentialPlaintext): Buffer {
  const credential = {
    refreshToken: requireNonemptyString(value.refreshToken),
    googleSubject: requireNonemptyString(value.googleSubject),
    displayEmail: requireNonemptyString(value.displayEmail),
    grantedScopes: validateScopes(value.grantedScopes),
  };
  return Buffer.from(JSON.stringify(credential), "utf8");
}

function parseCredential(value: Buffer): GscCredentialPlaintext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.toString("utf8"));
  } catch {
    fail();
  }
  if (
    !isRecord(parsed) ||
    !exactKeys(parsed, [
      "displayEmail",
      "googleSubject",
      "grantedScopes",
      "refreshToken",
    ])
  ) {
    fail();
  }
  return Object.freeze({
    refreshToken: requireNonemptyString(parsed.refreshToken),
    googleSubject: requireNonemptyString(parsed.googleSubject),
    displayEmail: requireNonemptyString(parsed.displayEmail),
    grantedScopes: validateScopes(parsed.grantedScopes),
  });
}

export function createGscCredentialService(
  dependencies: GscCredentialServiceDependencies,
): GscCredentialService {
  const credentialKey = Buffer.from(dependencies.credentialKey);
  if (credentialKey.length !== AES_KEY_BYTES) {
    fail();
  }
  const randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  const subjectHmacKey = createHmac("sha256", credentialKey)
    .update(SUBJECT_HMAC_KEY_PURPOSE, "utf8")
    .digest();

  function encrypt(plaintext: Buffer, aad: Buffer): GscEncryptedEnvelope {
    try {
      const nonce = Buffer.from(randomBytes(GCM_NONCE_BYTES));
      if (nonce.length !== GCM_NONCE_BYTES) {
        fail();
      }
      const cipher = createCipheriv(AES_ALGORITHM, credentialKey, nonce, {
        authTagLength: GCM_TAG_BYTES,
      });
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Object.freeze({
        formatVersion: GSC_CREDENTIAL_FORMAT_VERSION,
        nonce: nonce.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
        authTag: authTag.toString("base64url"),
      });
    } catch {
      fail();
    }
  }

  function decrypt(envelope: GscEncryptedEnvelope, aad: Buffer): Buffer {
    try {
      const parsed = parseEnvelope(envelope);
      const decipher = createDecipheriv(
        AES_ALGORITHM,
        credentialKey,
        parsed.nonce,
        { authTagLength: GCM_TAG_BYTES },
      );
      decipher.setAAD(aad);
      decipher.setAuthTag(parsed.authTag);
      return Buffer.concat([
        decipher.update(parsed.ciphertext),
        decipher.final(),
      ]);
    } catch {
      fail();
    }
  }

  function encryptCredentialEnvelope(
    binding: GscCredentialBinding,
    credential: GscCredentialPlaintext,
  ): GscEncryptedEnvelope {
    try {
      requireCurrentVersion(binding.formatVersion);
      return encrypt(serializeCredential(credential), credentialAad(binding));
    } catch {
      fail();
    }
  }

  function decryptCredentialEnvelope(
    binding: GscCredentialBinding,
    envelope: GscEncryptedEnvelope,
  ): GscCredentialPlaintext {
    try {
      requireCurrentVersion(binding.formatVersion);
      return parseCredential(decrypt(envelope, credentialAad(binding)));
    } catch {
      fail();
    }
  }

  function encryptPkceVerifier(
    binding: GscPkceBinding,
    verifier: string,
  ): GscEncryptedEnvelope {
    try {
      requireCurrentVersion(binding.formatVersion);
      return encrypt(
        Buffer.from(requireNonemptyString(verifier), "utf8"),
        pkceAad(binding),
      );
    } catch {
      fail();
    }
  }

  function decryptPkceVerifier(
    binding: GscPkceBinding,
    envelope: GscEncryptedEnvelope,
  ): string {
    try {
      requireCurrentVersion(binding.formatVersion);
      return requireNonemptyString(
        decrypt(envelope, pkceAad(binding)).toString("utf8"),
      );
    } catch {
      fail();
    }
  }

  function hashGoogleSubject(
    googleClientId: string,
    googleSubject: string,
  ): string {
    try {
      return createHmac("sha256", subjectHmacKey)
        .update(
          encodeStructured(SUBJECT_HMAC_VALUE_PURPOSE, [
            requireNonemptyString(googleClientId),
            requireNonemptyString(googleSubject),
          ]),
        )
        .digest("base64url");
    } catch {
      fail();
    }
  }

  function hashOpaqueProof(kind: GscOpaqueProofKind, value: string): string {
    try {
      if (
        kind !== "ticket" &&
        kind !== "state" &&
        kind !== "browser_session" &&
        kind !== "oidc_nonce"
      ) {
        fail();
      }
      return createHash("sha256")
        .update(
          encodeStructured(OPAQUE_PROOF_PURPOSE, [
            kind,
            requireNonemptyString(value),
          ]),
        )
        .digest("base64url");
    } catch {
      fail();
    }
  }

  return Object.freeze({
    encryptCredentialEnvelope,
    decryptCredentialEnvelope,
    encryptPkceVerifier,
    decryptPkceVerifier,
    hashGoogleSubject,
    hashOpaqueProof,
  });
}
