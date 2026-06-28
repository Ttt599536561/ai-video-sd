import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuditLog, CreditPackage, ModelConfig, PublicUser, RedemptionCode, User, VideoJob } from "./domain/types.js";
import { toPublicUser } from "./domain/types.js";
import { InMemoryStore } from "./repositories/memory-store.js";
import { isPersistentStore } from "./repositories/prisma-store.js";
import {
  createModelConfigEncryptionKeyring,
  type ModelConfigEncryptionKeyring
} from "./server-config.js";
import { AdminService, normalizePublicApiBaseUrl } from "./services/admin.service.js";
import { AuthService } from "./services/auth.service.js";
import { createEncryptionKey, createId, decryptSecret } from "./services/crypto.service.js";
import { toAppErrorResponse } from "./services/errors.js";
import { OpenAiVideoProvider } from "./services/openai-video-provider.js";
import { RedemptionService } from "./services/redemption.service.js";
import { VideoFileStorage } from "./services/video-file-storage.js";
import type { VideoStatusSyncScheduler } from "./services/video-status-sync.service.js";
import { isProviderBackedTaskId } from "./services/video-status-sync.service.js";
import { VideoService } from "./services/video.service.js";

type VideoProviderFactory = (input: { baseUrl: string; apiKey: string }) => OpenAiVideoProvider;
type FetchLike = typeof fetch;
const MAX_REFERENCE_IMAGE_DATA_URL_BYTES = 2.5 * 1024 * 1024;

interface DefaultVideoProviderConfig {
  baseUrl: string;
  apiKey: string;
}

export interface CreateAppOptions {
  store?: InMemoryStore;
  jwtSecret: string;
  redemptionHashSecret: string;
  bodyLimitBytes?: number;
  encryptionKey?: Buffer;
  encryptionKeyring?: ModelConfigEncryptionKeyring;
  bootstrapAdminSecret?: string;
  defaultVideoProviderConfig?: DefaultVideoProviderConfig;
  videoProviderFactory?: VideoProviderFactory;
  realVideoJobsEnabled?: boolean;
  videoStorage?: VideoFileStorage;
  videoStatusSyncScheduler?: VideoStatusSyncScheduler;
  publicApiBaseUrl?: string;
  referenceMediaFetch?: FetchLike;
}

interface AuthenticatedRequest extends FastifyRequest {
  currentUser: User;
}

export async function createApp(options: CreateAppOptions) {
  const store = options.store ?? new InMemoryStore();
  const auth = new AuthService(store, { jwtSecret: options.jwtSecret });
  const redemption = new RedemptionService(store, { hashSecret: options.redemptionHashSecret });
  const encryptionKeyring =
    options.encryptionKeyring ??
    createModelConfigEncryptionKeyring(new Map([[1, options.encryptionKey ?? createEncryptionKey()]]), 1);
  const admin = new AdminService(store, { encryptionKeyring });
  const videoProviderFactory =
    options.videoProviderFactory ??
    ((input: { baseUrl: string; apiKey: string }) =>
      new OpenAiVideoProvider({ baseUrl: input.baseUrl, apiKey: input.apiKey }));
  const providerForModel = (model: ModelConfig) => {
    if (model.authType !== "BEARER") {
      throw new Error("Provider video jobs currently require bearer auth");
    }
    return videoProviderFactory({
      baseUrl: model.providerBaseUrl,
      apiKey: decryptSecret(model.apiKeyCiphertext, encryptionKeyring.keyForVersion(model.keyVersion))
    });
  };
  const referenceMediaFetch = options.referenceMediaFetch ?? fetch;
  const video = new VideoService(store, {
    providerFactory: options.realVideoJobsEnabled ? providerForModel : undefined,
    outputStorage: options.realVideoJobsEnabled ? options.videoStorage : undefined,
    referenceMediaResolver:
      options.realVideoJobsEnabled && options.videoStorage
        ? {
            resolve: (job, references, context) => resolveProviderReferenceMedia(job, references, context)
          }
        : undefined
  });
  const app = Fastify({ logger: false, bodyLimit: options.bodyLimitBytes ?? 64 * 1024 * 1024 });

  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"]
  });

  if (options.videoStorage) {
    const cleanupTimer = setInterval(() => {
      void options.videoStorage!.cleanupExpiredAssets(store.videoAssets).then(async (deletedCount) => {
        if (deletedCount > 0 && isPersistentStore(store)) {
          await store.flush();
        }
      });
    }, 60 * 60 * 1000);
    cleanupTimer.unref();
    app.addHook("onClose", async () => {
      clearInterval(cleanupTimer);
    });
  }

  if (isPersistentStore(store)) {
    app.addHook("onResponse", async (request) => {
      if (["POST", "PATCH", "DELETE"].includes(request.method)) {
        await store.flush();
      }
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    const response = toAppErrorResponse(error);
    reply.status(response.statusCode).send(response);
  });

  function requireUser(request: FastifyRequest): User {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) throw new Error("Unauthorized");
    const payload = auth.verifyToken(token);
    const user = store.findUserById(payload.userId);
    if (!user) throw new Error("Unauthorized");
    return user;
  }

  function requireAdmin(request: FastifyRequest): User {
    const user = requireUser(request);
    if (user.role !== "ADMIN") throw new Error("Forbidden");
    return user;
  }

  function recordAudit(
    request: FastifyRequest,
    actor: User,
    input: Omit<AuditLog, "id" | "actorId" | "createdAt" | "ip">
  ): AuditLog {
    const log: AuditLog = {
      id: createId(),
      actorId: actor.id,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
      ip: request.ip,
      createdAt: new Date()
    };
    store.auditLogs.push(log);
    return log;
  }

  function summarizeModelConfig(model: ModelConfig) {
    return {
      id: model.id,
      modelName: model.modelName,
      displayName: model.displayName,
      submitPath: model.submitPath,
      statusPath: model.statusPath,
      resultPath: model.resultPath,
      authType: model.authType,
      costCredits: model.costCredits,
      enabled: model.enabled,
      deleted: Boolean(model.deletedAt)
    };
  }

  function summarizeCreditPackage(pkg: CreditPackage) {
    return {
      id: pkg.id,
      name: pkg.name,
      priceCents: pkg.priceCents,
      credits: pkg.credits,
      validDays: pkg.validDays,
      purchaseUrl: pkg.purchaseUrl,
      enabled: pkg.enabled,
      sortOrder: pkg.sortOrder
    };
  }

  function summarizeSystemSettings() {
    return admin.getSystemSettings();
  }

  function summarizeUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      creditBalance: user.creditBalance,
      purchasedPackageName: user.purchasedPackageName
    };
  }

  function toAdminRedemptionCodeRecord(code: RedemptionCode) {
    const batch = store.redemptionBatches.find((item) => item.id === code.batchId);
    const redeemer = code.redeemedBy ? store.findUserById(code.redeemedBy) : undefined;
    return {
      id: code.id,
      batchId: code.batchId,
      batchName: batch?.name ?? "Unknown batch",
      plainCode: code.plainCode ?? null,
      codePrefix: code.codePrefix,
      codeSuffix: code.codeSuffix,
      credits: code.credits,
      status: code.status,
      expiresAt: code.expiresAt ?? null,
      validityDays: redemptionValidityDays(code),
      redeemedBy: code.redeemedBy ?? null,
      redeemedByEmail: redeemer?.email ?? null,
      redeemedAt: code.redeemedAt ?? null,
      createdAt: code.createdAt
    };
  }

  function redemptionValidityDays(code: RedemptionCode): number | null {
    if (!code.expiresAt || !code.redeemedAt) return null;
    return Math.max(0, Math.ceil((code.expiresAt.getTime() - code.redeemedAt.getTime()) / 86_400_000));
  }

  function generationDurationSeconds(job: VideoJob): number | null {
    if (!job.completedAt) return null;
    return Math.max(0, Math.round((job.completedAt.getTime() - job.createdAt.getTime()) / 1000));
  }

  function toVideoJobRecord(job: VideoJob) {
    const model = store.modelConfigs.find((item) => item.id === job.modelConfigId);
    const user = store.findUserById(job.userId);
    const aspectRatio = job.aspectRatio ?? "16:9";
    return {
      ...job,
      userEmail: user?.email ?? null,
      modelName: model?.displayName ?? model?.modelName ?? job.modelConfigId,
      modelProviderName: model?.modelName ?? job.modelConfigId,
      generatedAt: job.createdAt,
      aspectRatio,
      size: aspectRatio,
      imageCount: job.imageCount ?? 0,
      videoCount: job.videoCount ?? 0,
      audioCount: job.audioCount ?? 0,
      generationDurationSeconds: generationDurationSeconds(job)
    };
  }

  app.get("/health", async () => ({ ok: true }));

  app.post("/api/auth/register", async (request, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(8) }).parse(request.body);
    const result = await auth.register(body);
    reply.status(201).send(result);
  });

  app.post("/api/auth/login", async (request) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(request.body);
    return auth.login(body);
  });

  app.post("/api/auth/bootstrap-admin", async (request, reply) => {
    if (!options.bootstrapAdminSecret) {
      throw new Error("Admin bootstrap is disabled");
    }
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        bootstrapSecret: z.string().min(1)
      })
      .parse(request.body);
    if (body.bootstrapSecret !== options.bootstrapAdminSecret) {
      throw new Error("Forbidden");
    }
    const result = await auth.register({ email: body.email, password: body.password, role: "ADMIN" });
    reply.status(201).send(result);
  });

  app.get("/api/me", async (request) => toPublicUser(requireUser(request)));

  app.patch("/api/me/password", async (request) => {
    const user = requireUser(request);
    const body = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8)
      })
      .parse(request.body);
    await auth.changePassword({ userId: user.id, ...body });
    return { ok: true };
  });

  app.get("/api/credits/balance", async (request) => {
    const user = requireUser(request);
    return { balance: user.creditBalance };
  });

  app.get("/api/credits/ledger", async (request) => {
    const user = requireUser(request);
    return store.creditLedger.filter((entry) => entry.userId === user.id);
  });

  app.get("/api/credits/redemptions", async (request) => {
    const user = requireUser(request);
    return store.redemptionCodes
      .filter((code) => code.redeemedBy === user.id && code.redeemedAt)
      .map((code) => {
        const batch = store.redemptionBatches.find((item) => item.id === code.batchId);
        return {
          id: code.id,
          batchId: code.batchId,
          batchName: batch?.name ?? "Unknown batch",
          credits: code.credits,
          codePrefix: code.codePrefix,
          codeSuffix: code.codeSuffix,
          redeemedAt: code.redeemedAt,
          expiresAt: code.expiresAt,
          validityDays: redemptionValidityDays(code)
        };
      })
      .sort((a, b) => new Date(b.redeemedAt!).getTime() - new Date(a.redeemedAt!).getTime());
  });

  app.post("/api/credits/redeem", async (request) => {
    const user = requireUser(request);
    const body = z.object({ code: z.string().min(1) }).parse(request.body);
    return redemption.redeem({
      code: body.code,
      userId: user.id,
      ip: request.ip,
      userAgent: request.headers["user-agent"]
    });
  });

  app.get("/api/credit-packages", async () => admin.listCreditPackages(false));

  app.get("/api/models", async () => admin.listPublicModels());

  app.get("/api/admin/users", async (request) => {
    requireAdmin(request);
    return admin.listUsers();
  });

  app.patch("/api/admin/users/:id", async (request) => {
    const currentAdmin = requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ status: z.enum(["ACTIVE", "BANNED"]).optional(), purchasedPackageName: z.string().optional() }).parse(request.body);
    const userBefore = store.findUserById(params.id);
    const before = userBefore ? summarizeUser(userBefore) : undefined;
    const updated = admin.updateUser(params.id, body);
    const userAfter = store.findUserById(params.id);
    const action =
      body.status === "BANNED" ? "USER_BANNED" : body.status === "ACTIVE" ? "USER_UNBANNED" : "USER_UPDATED";
    recordAudit(request, currentAdmin, {
      action,
      targetType: "user",
      targetId: params.id,
      metadata: {
        before,
        after: userAfter ? summarizeUser(userAfter) : updated
      }
    });
    return updated;
  });

  app.post("/api/admin/users/:id/adjust-credits", async (request) => {
    const currentAdmin = requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ amount: z.number().int(), reason: z.string().optional() }).parse(request.body);
    const balanceBefore = store.findUserById(params.id)?.creditBalance;
    const updated = admin.adjustCredits(params.id, body.amount, currentAdmin.id, body.reason);
    recordAudit(request, currentAdmin, {
      action: "USER_CREDITS_ADJUSTED",
      targetType: "user",
      targetId: params.id,
      metadata: {
        amount: body.amount,
        reason: body.reason ?? "ADMIN_ADJUST",
        balanceBefore,
        balanceAfter: updated.creditBalance
      }
    });
    return updated;
  });

  app.post("/api/admin/model-configs", async (request, reply) => {
    const currentAdmin = requireAdmin(request);
    const body = z
      .object({
        modelName: z.string().min(1),
        displayName: z.string().min(1),
        providerBaseUrl: z.string().url(),
        submitPath: z.string().min(1),
        statusPath: z.string().optional(),
        resultPath: z.string().optional(),
        authType: z.enum(["BEARER", "HEADER_KEY"]),
        apiKey: z.string().min(1),
        costCredits: z.number().int().positive(),
        enabled: z.boolean()
      })
      .parse(request.body);
    const created = admin.createModelConfig(body, currentAdmin.id);
    const createdModel = store.modelConfigs.find((item) => item.id === created.id);
    recordAudit(request, currentAdmin, {
      action: "MODEL_CONFIG_CREATED",
      targetType: "model_config",
      targetId: created.id,
      metadata: {
        after: createdModel ? summarizeModelConfig(createdModel) : undefined,
        apiKeyChanged: true
      }
    });
    reply.status(201).send(created);
  });

  app.get("/api/admin/model-configs", async (request) => {
    requireAdmin(request);
    return admin.listModelConfigs();
  });

  app.get("/api/admin/provider-models", async (request) => {
    requireAdmin(request);
    if (!options.defaultVideoProviderConfig) {
      throw new Error("Default video provider is not configured");
    }
    const provider = videoProviderFactory(options.defaultVideoProviderConfig);
    return {
      baseUrl: options.defaultVideoProviderConfig.baseUrl,
      models: await provider.listVideoModels()
    };
  });

  app.get("/api/admin/system-settings", async (request) => {
    requireAdmin(request);
    return admin.getSystemSettings();
  });

  app.patch("/api/admin/system-settings", async (request) => {
    const currentAdmin = requireAdmin(request);
    const body = z
      .object({
        publicApiBaseUrl: z.string().nullable().optional()
      })
      .parse(request.body);
    const before = summarizeSystemSettings();
    const updated = admin.updateSystemSettings(body, currentAdmin.id);
    recordAudit(request, currentAdmin, {
      action: "SYSTEM_SETTINGS_UPDATED",
      targetType: "system_settings",
      targetId: "global",
      metadata: {
        before,
        after: updated,
        changedFields: Object.keys(body)
      }
    });
    return updated;
  });

  app.patch("/api/admin/model-configs/:id", async (request) => {
    const currentAdmin = requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        modelName: z.string().min(1).optional(),
        displayName: z.string().min(1).optional(),
        providerBaseUrl: z.string().url().optional(),
        submitPath: z.string().min(1).optional(),
        statusPath: z.string().optional(),
        resultPath: z.string().optional(),
        authType: z.enum(["BEARER", "HEADER_KEY"]).optional(),
        apiKey: z.string().min(1).optional(),
        costCredits: z.number().int().positive().optional(),
        enabled: z.boolean().optional()
      })
      .parse(request.body);
    const modelBefore = store.modelConfigs.find((item) => item.id === params.id && !item.deletedAt);
    const before = modelBefore ? summarizeModelConfig(modelBefore) : undefined;
    const updated = admin.updateModelConfig(params.id, body, currentAdmin.id);
    const modelAfter = store.modelConfigs.find((item) => item.id === params.id && !item.deletedAt);
    recordAudit(request, currentAdmin, {
      action: "MODEL_CONFIG_UPDATED",
      targetType: "model_config",
      targetId: params.id,
      metadata: {
        before,
        after: modelAfter ? summarizeModelConfig(modelAfter) : updated,
        changedFields: Object.keys(body),
        apiKeyChanged: body.apiKey !== undefined
      }
    });
    return updated;
  });

  app.post("/api/admin/model-configs/:id/test-provider", async (request) => {
    requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const model = store.modelConfigs.find((item) => item.id === params.id && !item.deletedAt);
    if (!model) throw new Error("Model not found");
    if (model.authType !== "BEARER") {
      throw new Error("Provider connectivity test currently requires bearer auth");
    }
    const provider = videoProviderFactory({
      baseUrl: model.providerBaseUrl,
      apiKey: decryptSecret(model.apiKeyCiphertext, encryptionKeyring.keyForVersion(model.keyVersion))
    });
    return {
      ok: true,
      models: await provider.listVideoModels()
    };
  });

  app.delete("/api/admin/model-configs/:id", async (request, reply) => {
    const currentAdmin = requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const modelBefore = store.modelConfigs.find((item) => item.id === params.id && !item.deletedAt);
    const before = modelBefore ? summarizeModelConfig(modelBefore) : undefined;
    admin.deleteModelConfig(params.id, currentAdmin.id);
    const modelAfter = store.modelConfigs.find((item) => item.id === params.id);
    recordAudit(request, currentAdmin, {
      action: "MODEL_CONFIG_DELETED",
      targetType: "model_config",
      targetId: params.id,
      metadata: {
        before,
        deletionType: modelAfter?.deletedAt ? "soft" : "hard"
      }
    });
    reply.status(204).send();
  });

  app.post("/api/admin/credit-packages", async (request, reply) => {
    const currentAdmin = requireAdmin(request);
    const body = z
      .object({
        name: z.string().min(1),
        priceCents: z.number().int().nonnegative(),
        credits: z.number().int().positive(),
        validDays: z.number().int().positive(),
        purchaseUrl: z.string().optional(),
        enabled: z.boolean(),
        sortOrder: z.number().int()
      })
      .parse(request.body);
    const created = admin.createCreditPackage(body);
    recordAudit(request, currentAdmin, {
      action: "CREDIT_PACKAGE_CREATED",
      targetType: "credit_package",
      targetId: created.id,
      metadata: {
        after: summarizeCreditPackage(created)
      }
    });
    reply.status(201).send(created);
  });

  app.get("/api/admin/credit-packages", async (request) => {
    requireAdmin(request);
    return admin.listCreditPackages(true);
  });

  app.patch("/api/admin/credit-packages/:id", async (request) => {
    const currentAdmin = requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        priceCents: z.number().int().nonnegative().optional(),
        credits: z.number().int().positive().optional(),
        validDays: z.number().int().positive().optional(),
        purchaseUrl: z.string().optional(),
        enabled: z.boolean().optional(),
        sortOrder: z.number().int().optional()
      })
      .parse(request.body);
    const packageBefore = store.creditPackages.find((item) => item.id === params.id);
    const before = packageBefore ? summarizeCreditPackage(packageBefore) : undefined;
    const updated = admin.updateCreditPackage(params.id, body);
    recordAudit(request, currentAdmin, {
      action: "CREDIT_PACKAGE_UPDATED",
      targetType: "credit_package",
      targetId: params.id,
      metadata: {
        before,
        after: summarizeCreditPackage(updated),
        changedFields: Object.keys(body)
      }
    });
    return updated;
  });

  app.delete("/api/admin/credit-packages/:id", async (request, reply) => {
    const currentAdmin = requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const packageBefore = store.creditPackages.find((item) => item.id === params.id);
    const before = packageBefore ? summarizeCreditPackage(packageBefore) : undefined;
    admin.deleteCreditPackage(params.id);
    recordAudit(request, currentAdmin, {
      action: "CREDIT_PACKAGE_DELETED",
      targetType: "credit_package",
      targetId: params.id,
      metadata: { before }
    });
    reply.status(204).send();
  });

  app.post("/api/admin/redemption-batches", async (request, reply) => {
    const currentAdmin = requireAdmin(request);
    const body = z
      .object({
        name: z.string().min(1),
        quantity: z.number().int().min(1).max(5000),
        creditsPerCode: z.number().int().positive(),
        expiresAt: z.string().datetime().nullable().optional()
      })
      .parse(request.body);
    const created = await redemption.generateBatch({
      ...body,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      createdBy: currentAdmin.id
    });
    recordAudit(request, currentAdmin, {
      action: "REDEMPTION_BATCH_CREATED",
      targetType: "redemption_batch",
      targetId: created.batchId,
      metadata: {
        name: body.name,
        quantity: body.quantity,
        creditsPerCode: body.creditsPerCode,
        expiresAt: body.expiresAt ?? null,
        generatedCodeCount: created.codes.length
      }
    });
    reply.status(201).send(created);
  });

  app.get("/api/admin/redemption-batches", async (request) => {
    requireAdmin(request);
    return store.redemptionBatches;
  });

  app.get("/api/admin/redemption-codes", async (request) => {
    requireAdmin(request);
    return store.redemptionCodes
      .map(toAdminRedemptionCodeRecord)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });

  app.get("/api/admin/redemption-batches/:id/codes", async (request) => {
    requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    return store.redemptionCodes.filter((code) => code.batchId === params.id).map(toAdminRedemptionCodeRecord);
  });

  app.get("/api/admin/video-jobs", async (request) => {
    requireAdmin(request);
    return video.listJobs().map(toVideoJobRecord);
  });

  app.get("/api/admin/audit-logs", async (request) => {
    requireAdmin(request);
    return store.auditLogs
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 100)
      .map((log) => ({
        ...log,
        actorEmail: log.actorId ? store.findUserById(log.actorId)?.email : undefined
      }));
  });

  app.post("/api/video/uploads/presign", async (request) => {
    requireUser(request);
    const body = z.object({ filename: z.string().min(1), mimeType: z.string().min(1) }).parse(request.body);
    return {
      uploadUrl: `https://storage.example.com/uploads/${encodeURIComponent(body.filename)}`,
      storageKey: `uploads/${Date.now()}-${body.filename}`,
      mimeType: body.mimeType
    };
  });

  app.post("/api/video/jobs", async (request, reply) => {
    const user = requireUser(request);
    const body = z
      .object({
        model: z.string().min(1),
        mode: z.enum(["TEXT_IMAGE_TO_VIDEO", "VIDEO_TO_VIDEO"]),
        prompt: z.string().min(1),
        resolution: z.enum(["480P", "720P", "1080P"]),
        aspectRatio: z.enum(["9:16", "16:9", "1:1"]).optional(),
        durationSeconds: z.number().int().min(5).max(15),
        images: z.array(z.string().min(1)).max(4).optional(),
        videos: z.array(z.string().min(1)).max(3).optional(),
        audios: z.array(z.string().min(1)).max(1).optional()
      })
      .parse(request.body);
    validateReferenceImages(body.images);
    const created = await video.createJob({
      ...body,
      userId: user.id,
      referencePublicBaseUrl: publicApiBaseUrlForRequest(request)
    });
    if (isProviderBackedTaskId(created.providerTaskId)) {
      await options.videoStatusSyncScheduler?.enqueueJobSync(created.id);
    }
    reply.status(201).send(created);
  });

  function validateReferenceImages(images?: string[]) {
    const oversized = images?.find((image) => Buffer.byteLength(image, "utf8") > MAX_REFERENCE_IMAGE_DATA_URL_BYTES);
    if (oversized) throw new Error("Reference image too large");
  }

  async function resolveProviderReferenceMedia(
    job: VideoJob,
    references: { images?: string[]; videos?: string[]; audios?: string[] },
    context: { publicBaseUrl?: string }
  ): Promise<{ images?: string[]; videos?: string[]; audios?: string[] }> {
    return {
      images: await resolveReferenceList(job, "image", references.images, context),
      videos: await resolveReferenceList(job, "video", references.videos, context),
      audios: await resolveReferenceList(job, "audio", references.audios, context)
    };
  }

  async function resolveReferenceList(
    job: VideoJob,
    kind: "image" | "video" | "audio",
    values: string[] | undefined,
    context: { publicBaseUrl?: string }
  ): Promise<string[] | undefined> {
    if (!values?.length) return undefined;
    const urls: string[] = [];
    for (const [index, value] of values.entries()) {
      urls.push(await resolveReferenceValue(job, kind, index + 1, value, context));
    }
    return urls;
  }

  async function resolveReferenceValue(
    job: VideoJob,
    kind: "image" | "video" | "audio",
    index: number,
    value: string,
    context: { publicBaseUrl?: string }
  ): Promise<string> {
    if (/^https?:\/\//i.test(value)) return value;
    const dataUrl = parseReferenceDataUrl(value, kind);
    if (!dataUrl) throw new Error(`Invalid ${kind} reference media`);
    if (!options.videoStorage) throw new Error("Video storage is not configured");
    const stored = await options.videoStorage.saveReferenceMedia(job, {
      kind,
      index,
      content: dataUrl.content,
      mimeType: dataUrl.mimeType
    });
    const publicUrl = `${publicApiBaseUrlForContext(context)}/api/video/reference-assets/${encodeURIComponent(job.id)}/${encodeURIComponent(stored.filename)}`;
    await assertReferenceUrlReachable(publicUrl, dataUrl.mimeType);
    return publicUrl;
  }

  async function assertReferenceUrlReachable(publicUrl: string, expectedMimeType: string): Promise<void> {
    let response: Response;
    try {
      response = await referenceMediaFetch(publicUrl, { method: "GET" });
    } catch (error) {
      const message = error instanceof Error && error.message ? `: ${error.message}` : "";
      throw new Error(`Public API reference media URL is not reachable${message}`);
    }
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) {
      throw new Error(`Public API reference media URL is not reachable: HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().startsWith(expectedMimeType.toLowerCase())) {
      throw new Error(`Public API reference media URL returned unexpected content type: ${contentType}`);
    }
  }

  function publicApiBaseUrlForContext(context: { publicBaseUrl?: string }): string {
    const baseUrl = (context.publicBaseUrl ?? "").replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error("Public API base URL is required for provider reference media");
    }
    return baseUrl;
  }

  function publicApiBaseUrlForRequest(request: FastifyRequest): string | undefined {
    const configured = normalizePublicApiBaseUrl(admin.getSystemSettings().publicApiBaseUrl ?? options.publicApiBaseUrl);
    if (configured) return configured;
    const host = request.headers["x-forwarded-host"] ?? request.headers.host;
    const hostValue = Array.isArray(host) ? host[0] : host;
    if (!hostValue || /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)(:|$)/i.test(hostValue)) return undefined;
    const protoHeader = request.headers["x-forwarded-proto"];
    const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
    return normalizePublicApiBaseUrl(`${proto === "http" ? "http" : "https"}://${hostValue}`);
  }

  function parseReferenceDataUrl(value: string, kind: "image" | "video" | "audio"): { mimeType: string; content: Uint8Array } | undefined {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i.exec(value.trim());
    if (!match) return undefined;
    const [, mimeType, base64] = match;
    if (!mimeType.startsWith(`${kind}/`)) return undefined;
    return {
      mimeType,
      content: Buffer.from(base64, "base64")
    };
  }

  app.get("/api/video/jobs", async (request) => {
    const user = requireUser(request);
    return video.listJobs(user.id);
  });

  app.get("/api/video/job-records", async (request) => {
    const user = requireUser(request);
    return video.listJobs(user.id).map((job) => {
      const record = toVideoJobRecord(job);
      return {
        id: record.id,
        createdAt: record.createdAt,
        generatedAt: record.generatedAt,
        modelName: record.modelName,
        modelProviderName: record.modelProviderName,
        prompt: record.prompt,
        resolution: record.resolution,
        aspectRatio: record.aspectRatio,
        size: record.size,
        durationSeconds: record.durationSeconds,
        imageCount: record.imageCount,
        videoCount: record.videoCount,
        audioCount: record.audioCount,
        costCredits: record.costCredits,
        status: record.status,
        generationDurationSeconds: record.generationDurationSeconds
      };
    });
  });

  app.get("/api/video/jobs/:id", async (request) => {
    const user = requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    return video.getJob(params.id, user.id);
  });

  app.get("/api/video/jobs/:id/download-url", async (request) => {
    const user = requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    if (!options.videoStorage) throw new Error("Video storage is not configured");
    const job = video.getJob(params.id, user.id);
    const asset = findJobOutputAsset(job.id);
    assertAssetIsDownloadable(asset);
    return { downloadUrl: options.videoStorage.createSignedDownloadPath(asset.id) };
  });

  app.post("/api/video/jobs/:id/process", async (request) => {
    const user = requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        outcome: z.enum(["SUCCEEDED", "FAILED"]).optional(),
        errorMessage: z.string().optional()
      })
      .parse(request.body ?? {});
    const job = video.getJob(params.id, user.id);
    if (job.providerTaskId && !job.providerTaskId.startsWith("mock-task-")) {
      throw new Error("Invalid operation: use provider sync for real video jobs");
    }
    return video.processJob(params.id, body);
  });

  app.post("/api/video/jobs/:id/sync", async (request, reply) => {
    const user = requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const job = video.getJob(params.id, user.id);
    if (options.videoStatusSyncScheduler && isProviderBackedTaskId(job.providerTaskId)) {
      await options.videoStatusSyncScheduler.enqueueJobSync(params.id);
      reply.status(202).send({ queued: true, jobId: params.id });
      return;
    }
    return video.syncJob(params.id);
  });

  app.delete("/api/video/jobs/:id", async (request, reply) => {
    requireUser(request);
    reply.status(405).send({
      error: "Video task records cannot be deleted",
      code: "VIDEO_JOB_DELETE_NOT_ALLOWED",
      message: "生成任务记录不可删除，请在项目页删除视频作品",
      statusCode: 405
    });
  });

  app.get("/api/video/assets", async (request) => {
    const user = requireUser(request);
    const userJobs = video.listJobs(user.id);
    const userJobById = new Map(userJobs.map((job) => [job.id, job]));
    return store.videoAssets
      .filter((asset) => asset.type === "OUTPUT_VIDEO" && !asset.deletedAt && userJobById.has(asset.jobId))
      .map((asset) => {
        const job = userJobById.get(asset.jobId)!;
        return {
          ...asset,
          prompt: job.prompt,
          resolution: job.resolution,
          durationSeconds: job.durationSeconds,
          status: job.status,
          completedAt: job.completedAt,
          jobCreatedAt: job.createdAt,
          downloadUrl: options.videoStorage?.createSignedDownloadPath(asset.id)
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  });

  app.get("/api/video/assets/:id/download-url", async (request) => {
    const user = requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    if (!options.videoStorage) throw new Error("Video storage is not configured");
    const asset = findVideoAsset(params.id);
    video.getJob(asset.jobId, user.id);
    assertAssetIsDownloadable(asset);
    return { downloadUrl: options.videoStorage.createSignedDownloadPath(asset.id) };
  });

  app.get("/api/video/reference-assets/:jobId/:filename", async (request, reply) => {
    const params = z.object({ jobId: z.string(), filename: z.string() }).parse(request.params);
    const asset = findReferenceAsset(params.jobId, params.filename);
    reply.header("content-type", asset.mimeType);
    reply.header("content-length", String(asset.sizeBytes));
    reply.header("cache-control", "public, max-age=86400");
    return reply.send(options.videoStorage!.openReadStream(asset.storageKey));
  });

  app.get("/api/video/assets/:id/download", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    if (!options.videoStorage) throw new Error("Video storage is not configured");
    const asset = findVideoAsset(params.id);
    assertAssetIsDownloadable(asset);
    if (!options.videoStorage.verifySignedDownload(asset.id, queryToSearchParams(request.query))) {
      throw new Error("Unauthorized");
    }
    const range = parseByteRange(request.headers.range, asset.sizeBytes);
    const filename = `${asset.id}.${extensionForMimeType(asset.mimeType)}`;
    reply.header("content-type", asset.mimeType);
    reply.header("content-disposition", `attachment; filename="${filename}"`);
    reply.header("accept-ranges", "bytes");
    if (range) {
      reply.status(206);
      reply.header("content-range", `bytes ${range.start}-${range.end}/${asset.sizeBytes}`);
      reply.header("content-length", String(range.end - range.start + 1));
      return reply.send(options.videoStorage.openReadStream(asset.storageKey, range));
    }
    reply.header("content-length", String(asset.sizeBytes));
    return reply.send(options.videoStorage.openReadStream(asset.storageKey));
  });

  app.delete("/api/video/assets/:id", async (request, reply) => {
    const user = requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const asset = findVideoAsset(params.id);
    video.getJob(asset.jobId, user.id);
    store.videoAssets = store.videoAssets.filter((item) => item.id !== asset.id);
    reply.status(204).send();
  });

  function findVideoAsset(assetId: string) {
    const asset = store.videoAssets.find((item) => item.id === assetId && !item.deletedAt);
    if (!asset) throw new Error("Video asset not found");
    return asset;
  }

  function findJobOutputAsset(jobId: string) {
    const asset = store.videoAssets.find((item) => item.jobId === jobId && item.type === "OUTPUT_VIDEO" && !item.deletedAt);
    if (!asset) throw new Error("Video asset not found");
    return asset;
  }

  function findReferenceAsset(jobId: string, filename: string) {
    if (!options.videoStorage) throw new Error("Video storage is not configured");
    const safeFilename = decodeURIComponent(filename);
    if (safeFilename.includes("/") || safeFilename.includes("\\") || safeFilename.includes("..")) {
      throw new Error("Video asset not found");
    }
    const storageKey = `references/${jobId}/${safeFilename}`;
    const lower = safeFilename.toLowerCase();
    const mimeType =
      lower.endsWith(".png") ? "image/png" :
      lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" :
      lower.endsWith(".webp") ? "image/webp" :
      lower.endsWith(".mp4") ? "video/mp4" :
      lower.endsWith(".webm") ? "video/webm" :
      lower.endsWith(".mov") ? "video/quicktime" :
      lower.endsWith(".mp3") ? "audio/mpeg" :
      lower.endsWith(".wav") ? "audio/wav" :
      lower.endsWith(".m4a") ? "audio/mp4" :
      "application/octet-stream";
    return {
      storageKey,
      mimeType,
      sizeBytes: options.videoStorage.sizeOf(storageKey)
    };
  }

  function assertAssetIsDownloadable(asset: { expiresAt?: Date }) {
    if (asset.expiresAt && asset.expiresAt <= new Date()) {
      throw new Error("Video asset has expired");
    }
  }

  return app;
}

export type AppUser = PublicUser;

function queryToSearchParams(query: unknown): URLSearchParams {
  const searchParams = new URLSearchParams();
  if (!query || typeof query !== "object") return searchParams;
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (typeof value === "string") searchParams.set(key, value);
  }
  return searchParams;
}

function parseByteRange(rangeHeader: string | undefined, sizeBytes: number): { start: number; end: number } | undefined {
  if (!rangeHeader || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return undefined;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return undefined;
  const start = rawStart ? Number.parseInt(rawStart, 10) : Math.max(sizeBytes - Number.parseInt(rawEnd, 10), 0);
  const end = rawEnd && rawStart ? Number.parseInt(rawEnd, 10) : sizeBytes - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= sizeBytes) {
    return undefined;
  }
  return {
    start,
    end: Math.min(end, sizeBytes - 1)
  };
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/quicktime") return "mov";
  return "bin";
}
