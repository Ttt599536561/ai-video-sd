import "dotenv/config";
import type { ModelConfig } from "../domain/types.js";
import { createPrismaClient, disconnectPrisma, isPersistentStore, PrismaBackedStore } from "../repositories/prisma-store.js";
import type { ModelConfigEncryptionKeyring } from "../server-config.js";
import { parseModelConfigEncryptionKeyring } from "../server-config.js";
import { decryptSecret, encryptSecret } from "../services/crypto.service.js";

interface MigrationOptions {
  apply: boolean;
}

interface MigrationResult {
  apply: boolean;
  currentVersion: number;
  scanned: number;
  wouldMigrate: number;
  migrated: number;
  alreadyCurrent: number;
  byVersion: Record<string, number>;
}

export function migrateModelConfigKeys(
  models: ModelConfig[],
  keyring: ModelConfigEncryptionKeyring,
  options: MigrationOptions
): MigrationResult {
  const result: MigrationResult = {
    apply: options.apply,
    currentVersion: keyring.currentVersion,
    scanned: models.length,
    wouldMigrate: 0,
    migrated: 0,
    alreadyCurrent: 0,
    byVersion: {}
  };

  for (const model of models) {
    const version = model.keyVersion ?? 1;
    result.byVersion[String(version)] = (result.byVersion[String(version)] ?? 0) + 1;

    if (version === keyring.currentVersion) {
      result.alreadyCurrent += 1;
      continue;
    }

    result.wouldMigrate += 1;

    if (!options.apply) continue;

    const plainText = decryptSecret(model.apiKeyCiphertext, keyring.keyForVersion(version));
    model.apiKeyCiphertext = encryptSecret(plainText, keyring.currentKey);
    model.keyVersion = keyring.currentVersion;
    model.updatedAt = new Date();
    result.migrated += 1;
  }

  return result;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const prisma = createPrismaClient();
  try {
    const store = await PrismaBackedStore.create(prisma);
    const result = migrateModelConfigKeys(store.modelConfigs, parseModelConfigEncryptionKeyring(process.env), {
      apply
    });
    if (apply && isPersistentStore(store)) {
      await store.flush();
    }
    console.log(JSON.stringify(result, null, 2));
    if (!apply) {
      console.log("Dry run only. Re-run with --apply to rewrite legacy ciphertexts.");
    }
  } finally {
    await disconnectPrisma(prisma);
  }
}

if (process.argv[1]?.endsWith("migrate-model-config-keys.ts") || process.argv[1]?.endsWith("migrate-model-config-keys.js")) {
  await main();
}
