import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
} from "node:crypto";

export const GTM_CREDENTIAL_FORMAT_VERSION = 1 as const;
export const GTM_READONLY_SCOPE =
  "https://www.googleapis.com/auth/tagmanager.readonly";
const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type GtmCredentialBinding = Readonly<{
  userId: string; connectionId: string; googleClientId: string; generation: number;
  formatVersion: typeof GTM_CREDENTIAL_FORMAT_VERSION;
}>;
export type GtmPkceBinding = GtmCredentialBinding & Readonly<{
  redirectUri: string; browserSessionHash: string; stateHash: string;
}>;
export type GtmCredentialPlaintext = Readonly<{
  refreshToken: string; googleSubject: string; displayEmail: string;
  grantedScopes: readonly string[];
}>;
export type GtmEncryptedEnvelope = Readonly<{
  formatVersion: typeof GTM_CREDENTIAL_FORMAT_VERSION;
  nonce: string; ciphertext: string; authTag: string;
}>;
export type GtmOpaqueProofKind = "ticket" | "state" | "browser_session" | "oidc_nonce";
export class GtmCredentialServiceError extends Error {
  readonly code = "GTM_CREDENTIAL_INVALID" as const;
  constructor() { super("GTM credential operation failed"); this.name = "GtmCredentialServiceError"; }
}
export type GtmCredentialService = Readonly<{
  encryptCredentialEnvelope: (b: GtmCredentialBinding, c: GtmCredentialPlaintext) => GtmEncryptedEnvelope;
  decryptCredentialEnvelope: (b: GtmCredentialBinding, e: GtmEncryptedEnvelope) => GtmCredentialPlaintext;
  encryptPkceVerifier: (b: GtmPkceBinding, v: string) => GtmEncryptedEnvelope;
  decryptPkceVerifier: (b: GtmPkceBinding, e: GtmEncryptedEnvelope) => string;
  hashGoogleSubject: (client: string, subject: string) => string;
  hashOpaqueProof: (kind: GtmOpaqueProofKind, value: string) => string;
  encryptBrowserHandoff: (userId: string, value: string) => GtmEncryptedEnvelope;
  decryptBrowserHandoff: (userId: string, envelope: GtmEncryptedEnvelope) => string;
}>;

const fail = (): never => { throw new GtmCredentialServiceError(); };
const str = (v: unknown): string => typeof v === "string" && v.length > 0 ? v : fail();
const gen = (v: unknown): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : fail();
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const aad = (purpose: string, values: readonly string[]) =>
  Buffer.from(JSON.stringify([purpose, ...values]), "utf8");
const bindingAad = (b: GtmCredentialBinding) => aad("thinkwithblack/gtm/credential/v1",
  [str(b.userId), str(b.connectionId), str(b.googleClientId), String(gen(b.generation)), String(b.formatVersion)]);
const pkceAad = (b: GtmPkceBinding) => aad("thinkwithblack/gtm/pkce/v1",
  [str(b.userId), str(b.connectionId), str(b.googleClientId), str(b.redirectUri),
    String(gen(b.generation)), str(b.browserSessionHash), str(b.stateHash), String(b.formatVersion)]);
const parse = (e: unknown) => {
  if (!record(e) || e.formatVersion !== GTM_CREDENTIAL_FORMAT_VERSION) fail();
  const decode = (v: unknown, n?: number) => {
    const s = str(v); if (!/^[A-Za-z0-9_-]+$/.test(s)) fail();
    const b = Buffer.from(s, "base64url");
    if (!b.length || b.toString("base64url") !== s || (n !== undefined && b.length !== n)) fail();
    return b;
  };
  return { nonce: decode((e as Record<string, unknown>).nonce, NONCE_BYTES),
    ciphertext: decode((e as Record<string, unknown>).ciphertext),
    authTag: decode((e as Record<string, unknown>).authTag, TAG_BYTES) };
};
const scopes = (v: unknown): readonly string[] => {
  if (!Array.isArray(v) || !v.length) fail();
  const result = (v as unknown[]).map(str); if (new Set(result).size !== result.length) fail();
  return Object.freeze(result);
};

export function createGtmCredentialService(input: {
  credentialKey: Uint8Array; randomBytes?: (length: number) => Uint8Array;
}): GtmCredentialService {
  const key = Buffer.from(input.credentialKey);
  if (key.length !== 32) fail();
  const random = input.randomBytes ?? nodeRandomBytes;
  const subjectKey = createHmac("sha256", key).update("thinkwithblack/gtm/subject-key/v1").digest();
  const encrypt = (plain: Buffer, associated: Buffer): GtmEncryptedEnvelope => {
    try {
      const nonce = Buffer.from(random(NONCE_BYTES)); if (nonce.length !== NONCE_BYTES) fail();
      const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(associated);
      return Object.freeze({ formatVersion: GTM_CREDENTIAL_FORMAT_VERSION,
        nonce: nonce.toString("base64url"),
        ciphertext: Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64url"),
        authTag: cipher.getAuthTag().toString("base64url") });
    } catch { return fail(); }
  };
  const decrypt = (envelope: GtmEncryptedEnvelope, associated: Buffer): Buffer => {
    try {
      const e = parse(envelope);
      const decipher = createDecipheriv(ALGORITHM, key, e.nonce, { authTagLength: TAG_BYTES });
      decipher.setAAD(associated); decipher.setAuthTag(e.authTag);
      return Buffer.concat([decipher.update(e.ciphertext), decipher.final()]);
    } catch { return fail(); }
  };
  const encryptCredentialEnvelope = (b: GtmCredentialBinding, c: GtmCredentialPlaintext) =>
    encrypt(Buffer.from(JSON.stringify({ refreshToken: str(c.refreshToken), googleSubject: str(c.googleSubject),
      displayEmail: str(c.displayEmail), grantedScopes: scopes(c.grantedScopes) })), bindingAad(b));
  const decryptCredentialEnvelope = (b: GtmCredentialBinding, e: GtmEncryptedEnvelope) => {
    try {
      const v: unknown = JSON.parse(decrypt(e, bindingAad(b)).toString("utf8"));
      if (!record(v)) fail();
      const value = v as Record<string, unknown>;
      return Object.freeze({ refreshToken: str(value.refreshToken), googleSubject: str(value.googleSubject),
        displayEmail: str(value.displayEmail), grantedScopes: scopes(value.grantedScopes) });
    } catch { return fail(); }
  };
  const encryptPkceVerifier = (b: GtmPkceBinding, v: string) => encrypt(Buffer.from(str(v)), pkceAad(b));
  const decryptPkceVerifier = (b: GtmPkceBinding, e: GtmEncryptedEnvelope): string =>
    str(decrypt(e, pkceAad(b)).toString("utf8"));
  return Object.freeze({
    encryptCredentialEnvelope, decryptCredentialEnvelope, encryptPkceVerifier, decryptPkceVerifier,
    hashGoogleSubject: (client: string, subject: string) => createHmac("sha256", subjectKey)
      .update(aad("thinkwithblack/gtm/subject-hash/v1", [str(client), str(subject)])).digest("base64url"),
    hashOpaqueProof: (kind: GtmOpaqueProofKind, value: string) => {
      if (!["ticket", "state", "browser_session", "oidc_nonce"].includes(kind)) fail();
      return createHash("sha256").update(aad("thinkwithblack/gtm/proof/v1", [kind, str(value)])).digest("base64url");
    },
    encryptBrowserHandoff: (userId: string, value: string) =>
      encrypt(Buffer.from(str(value)), aad("thinkwithblack/gtm/browser-handoff/v1", [str(userId)])),
    decryptBrowserHandoff: (userId: string, envelope: GtmEncryptedEnvelope) =>
      str(decrypt(envelope, aad("thinkwithblack/gtm/browser-handoff/v1", [str(userId)])).toString("utf8")),
  });
}