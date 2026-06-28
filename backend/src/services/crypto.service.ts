import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const REDEMPTION_CODE_LENGTH = 18;

export function createId(): string {
  return randomUUID();
}

export function normalizeRedemptionCode(code: string): string {
  return code.trim().replace(/[^A-Za-z0-9]/g, "");
}

export function formatRedemptionCode(normalized: string): string {
  return normalized;
}

export function generateRedemptionCode(): string {
  let raw = "";
  while (raw.length < REDEMPTION_CODE_LENGTH) {
    const byte = randomBytes(1)[0];
    raw += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return raw;
}

export function hashRedemptionCode(code: string, secret: string): string {
  const normalized = normalizeRedemptionCode(code);
  return createHmac("sha256", secret).update(normalized).digest("hex");
}

export function createEncryptionKey(): Buffer {
  return randomBytes(32);
}

export function encryptSecret(plainText: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptSecret(cipherText: string, key: Buffer): string {
  const [version, ivText, tagText, encryptedText] = cipherText.split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("Unsupported cipher text");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}
