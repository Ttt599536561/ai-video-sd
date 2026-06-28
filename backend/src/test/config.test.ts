import { describe, expect, it } from "vitest";
import * as serverConfig from "../server-config.js";

const { parseModelConfigEncryptionKey } = serverConfig;

describe("server config", () => {
  it("parses a stable base64 model config encryption key", () => {
    const key = parseModelConfigEncryptionKey({
      MODEL_CONFIG_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64")
    });

    expect(key).toEqual(Buffer.alloc(32, 7));
  });

  it("parses a stable hex model config encryption key", () => {
    const key = parseModelConfigEncryptionKey({
      MODEL_CONFIG_ENCRYPTION_KEY_HEX: Buffer.alloc(32, 9).toString("hex")
    });

    expect(key).toEqual(Buffer.alloc(32, 9));
  });

  it("rejects missing or incorrectly sized model config encryption keys", () => {
    expect(() => parseModelConfigEncryptionKey({})).toThrow("MODEL_CONFIG_ENCRYPTION_KEY_BASE64 is required");
    expect(() => parseModelConfigEncryptionKey({ MODEL_CONFIG_ENCRYPTION_KEY_BASE64: "too-short" })).toThrow(
      "must decode to 32 bytes"
    );
  });

  it("parses a versioned model config encryption keyring", () => {
    const parseKeyring = (serverConfig as Record<string, unknown>).parseModelConfigEncryptionKeyring;

    expect(typeof parseKeyring).toBe("function");

    const keyring = (parseKeyring as (env: Record<string, string>) => {
      currentVersion: number;
      currentKey: Buffer;
      keyForVersion(version?: number): Buffer;
    })({
      MODEL_CONFIG_ENCRYPTION_KEYS: [
        `1:base64:${Buffer.alloc(32, 1).toString("base64")}`,
        `2:hex:${Buffer.alloc(32, 2).toString("hex")}`
      ].join(","),
      MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION: "2"
    });

    expect(keyring.currentVersion).toBe(2);
    expect(keyring.currentKey).toEqual(Buffer.alloc(32, 2));
    expect(keyring.keyForVersion(1)).toEqual(Buffer.alloc(32, 1));
    expect(keyring.keyForVersion()).toEqual(Buffer.alloc(32, 1));
  });

  it("rejects versioned keyrings without a configured current version", () => {
    const parseKeyring = (serverConfig as Record<string, unknown>).parseModelConfigEncryptionKeyring as (
      env: Record<string, string>
    ) => unknown;

    expect(() =>
      parseKeyring({
        MODEL_CONFIG_ENCRYPTION_KEYS: `1:base64:${Buffer.alloc(32, 1).toString("base64")}`
      })
    ).toThrow("MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION must be a positive integer");
  });

  it("requires DATABASE_URL in production unless memory store is explicitly enabled", () => {
    const shouldUseMemoryStore = (serverConfig as Record<string, unknown>).shouldUseMemoryStore as (
      env: Record<string, string | undefined>
    ) => boolean;

    expect(() => shouldUseMemoryStore({ NODE_ENV: "production" })).toThrow(
      "DATABASE_URL is required in production unless USE_IN_MEMORY_STORE=true"
    );
    expect(shouldUseMemoryStore({ NODE_ENV: "production", USE_IN_MEMORY_STORE: "true" })).toBe(true);
    expect(shouldUseMemoryStore({ NODE_ENV: "production", DATABASE_URL: "postgresql://example" })).toBe(false);
  });
});
