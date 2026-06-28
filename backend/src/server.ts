import "dotenv/config";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { InMemoryStore } from "./repositories/memory-store.js";
import { createPrismaClient, disconnectPrisma, PrismaBackedStore } from "./repositories/prisma-store.js";
import { parseModelConfigEncryptionKeyring, requiredEnv, shouldUseMemoryStore } from "./server-config.js";
import { decryptSecret } from "./services/crypto.service.js";
import { OpenAiVideoProvider } from "./services/openai-video-provider.js";
import { VideoFileStorage } from "./services/video-file-storage.js";
import { BullMqVideoStatusSyncScheduler, VideoStatusSynchronizer } from "./services/video-status-sync.service.js";
import { VideoService } from "./services/video.service.js";

const port = Number(process.env.PORT ?? 4000);
const bodyLimitBytes = Number(process.env.REQUEST_BODY_LIMIT_BYTES ?? 64 * 1024 * 1024);
const useMemoryStore = shouldUseMemoryStore(process.env);
const prisma = useMemoryStore ? undefined : createPrismaClient();
const store = prisma ? await PrismaBackedStore.create(prisma) : new InMemoryStore();
const jwtSecret = requiredEnv(process.env, "JWT_SECRET", "dev-jwt-secret");
const redemptionHashSecret = requiredEnv(process.env, "REDEMPTION_HASH_SECRET", "dev-redemption-secret");
const videoStorage = new VideoFileStorage({
  rootDir: resolve(process.env.VIDEO_STORAGE_DIR ?? "storage/videos"),
  signingSecret: jwtSecret
});
const realVideoJobsEnabled = process.env.VIDEO_PROVIDER_REAL_JOBS === "true";
const redisUrl = process.env.REDIS_URL;
const encryptionKeyring = parseModelConfigEncryptionKeyring(process.env);
const providerForModel = (model: (typeof store.modelConfigs)[number]) => {
  if (model.authType !== "BEARER") {
    throw new Error("Provider video jobs currently require bearer auth");
  }
  return new OpenAiVideoProvider({
    baseUrl: model.providerBaseUrl,
    apiKey: decryptSecret(model.apiKeyCiphertext, encryptionKeyring.keyForVersion(model.keyVersion))
  });
};

if (useMemoryStore) {
  console.warn(
    "Using non-persistent InMemoryStore. Set DATABASE_URL to use PostgreSQL/Prisma persistence."
  );
} else {
  console.log("Using PostgreSQL/Prisma persistent store.");
}

const statusSyncScheduler =
  realVideoJobsEnabled && redisUrl
    ? new BullMqVideoStatusSyncScheduler({
        redisUrl,
        scanIntervalMs: 1500,
        synchronizer: new VideoStatusSynchronizer(
          store,
          new VideoService(store, {
            providerFactory: providerForModel,
            outputStorage: videoStorage
          })
        )
      })
    : undefined;

const app = await createApp({
  store,
  jwtSecret,
  redemptionHashSecret,
  bodyLimitBytes,
  encryptionKeyring,
  defaultVideoProviderConfig:
    process.env.VIDEO_PROVIDER_BASE_URL && process.env.VIDEO_PROVIDER_API_KEY
      ? {
          baseUrl: process.env.VIDEO_PROVIDER_BASE_URL,
          apiKey: process.env.VIDEO_PROVIDER_API_KEY
        }
      : undefined,
  realVideoJobsEnabled,
  videoStorage,
  videoStatusSyncScheduler: statusSyncScheduler,
  publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL,
  bootstrapAdminSecret: process.env.BOOTSTRAP_ADMIN_SECRET
});

await statusSyncScheduler?.start();

async function shutdown(): Promise<void> {
  await app.close();
  await statusSyncScheduler?.close();
  if (prisma) {
    await disconnectPrisma(prisma);
  }
}

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

await app.listen({ port, host: "0.0.0.0" });
console.log(`API listening on http://0.0.0.0:${port}`);
