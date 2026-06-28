import { describe, expect, it } from "vitest";
import { parseModelConfigEncryptionKeyring } from "../server-config.js";
import { decryptSecret, encryptSecret } from "../services/crypto.service.js";
import { migrateModelConfigKeys } from "../scripts/migrate-model-config-keys.js";
import type { ModelConfig } from "../domain/types.js";

describe("model config key migration", () => {
  it("reports legacy encrypted model configs without changing them in dry-run mode", () => {
    const keyring = parseModelConfigEncryptionKeyring({
      MODEL_CONFIG_ENCRYPTION_KEYS: [
        `1:base64:${Buffer.alloc(32, 1).toString("base64")}`,
        `2:base64:${Buffer.alloc(32, 2).toString("base64")}`
      ].join(","),
      MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION: "2"
    });
    const models = [
      createModel("legacy", encryptSecret("sk-legacy-secret", keyring.keyForVersion(1)), 1),
      createModel("current", encryptSecret("sk-current-secret", keyring.keyForVersion(2)), 2)
    ];
    const legacyCiphertext = models[0].apiKeyCiphertext;

    const result = migrateModelConfigKeys(models, keyring, { apply: false });

    expect(result).toEqual({
      apply: false,
      currentVersion: 2,
      scanned: 2,
      wouldMigrate: 1,
      migrated: 0,
      alreadyCurrent: 1,
      byVersion: { "1": 1, "2": 1 }
    });
    expect(models[0].apiKeyCiphertext).toBe(legacyCiphertext);
    expect(models[0].keyVersion).toBe(1);
  });

  it("re-encrypts legacy encrypted model configs to the current key version in apply mode", () => {
    const keyring = parseModelConfigEncryptionKeyring({
      MODEL_CONFIG_ENCRYPTION_KEYS: [
        `1:base64:${Buffer.alloc(32, 1).toString("base64")}`,
        `2:base64:${Buffer.alloc(32, 2).toString("base64")}`
      ].join(","),
      MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION: "2"
    });
    const models = [
      createModel("legacy", encryptSecret("sk-legacy-secret", keyring.keyForVersion(1)), 1),
      createModel("missing-version", encryptSecret("sk-missing-version", keyring.keyForVersion(1)), undefined)
    ];
    const originalCiphertexts = models.map((model) => model.apiKeyCiphertext);

    const result = migrateModelConfigKeys(models, keyring, { apply: true });

    expect(result).toMatchObject({
      apply: true,
      currentVersion: 2,
      scanned: 2,
      wouldMigrate: 2,
      migrated: 2,
      alreadyCurrent: 0,
      byVersion: { "1": 2 }
    });
    expect(models.map((model) => model.keyVersion)).toEqual([2, 2]);
    expect(models.map((model) => model.apiKeyCiphertext)).not.toEqual(originalCiphertexts);
    expect(decryptSecret(models[0].apiKeyCiphertext, keyring.keyForVersion(2))).toBe("sk-legacy-secret");
    expect(decryptSecret(models[1].apiKeyCiphertext, keyring.keyForVersion(2))).toBe("sk-missing-version");
  });
});

function createModel(modelName: string, apiKeyCiphertext: string, keyVersion: number | undefined): ModelConfig {
  return {
    id: modelName,
    modelName,
    displayName: modelName,
    providerBaseUrl: "https://provider.example.com",
    submitPath: "/v1/videos",
    authType: "BEARER",
    apiKeyCiphertext,
    apiKeyLast4: "cret",
    keyVersion,
    costCredits: 80,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}
