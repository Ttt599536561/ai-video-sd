import { PrismaClient } from "@prisma/client";
import type {
  AuditLog,
  CreditLedgerEntry,
  CreditPackage,
  ModelConfig,
  RedemptionAttempt,
  RedemptionBatch,
  RedemptionCode,
  SystemSetting,
  User,
  VideoAsset,
  VideoJob
} from "../domain/types.js";
import { InMemoryStore } from "./memory-store.js";

type Delegate = {
  findMany(args?: unknown): Promise<unknown[]>;
  upsert(args: unknown): Promise<unknown>;
  deleteMany(args?: unknown): Promise<unknown>;
};

type PrismaStoreClient = PrismaClient & {
  user: Delegate;
  creditLedger: Delegate;
  redemptionBatch: Delegate;
  redemptionCode: Delegate;
  redemptionAttempt: Delegate;
  creditPackage: Delegate;
  modelConfig: Delegate;
  videoJob: Delegate;
  videoAsset: Delegate;
  systemSetting: Delegate;
  auditLog: Delegate;
};

type PersistentStore = InMemoryStore & {
  flush(): Promise<void>;
};

export function isPersistentStore(store: InMemoryStore): store is PersistentStore {
  return typeof (store as Partial<PersistentStore>).flush === "function";
}

export class PrismaBackedStore extends InMemoryStore {
  private flushPromise?: Promise<void>;

  private constructor(private readonly prisma: PrismaStoreClient) {
    super();
  }

  static async create(prisma: PrismaClient): Promise<PrismaBackedStore> {
    const store = new PrismaBackedStore(prisma as PrismaStoreClient);
    await store.load();
    return store;
  }

  async load(): Promise<void> {
    this.users = (await this.prisma.user.findMany()) as User[];
    this.creditLedger = (await this.prisma.creditLedger.findMany()) as CreditLedgerEntry[];
    this.redemptionBatches = (await this.prisma.redemptionBatch.findMany()) as RedemptionBatch[];
    this.redemptionCodes = (await this.prisma.redemptionCode.findMany()).map(deserializeRedemptionCode);
    this.redemptionAttempts = (await this.prisma.redemptionAttempt.findMany()) as RedemptionAttempt[];
    this.creditPackages = (await this.prisma.creditPackage.findMany()) as CreditPackage[];
    this.modelConfigs = (await this.prisma.modelConfig.findMany()) as ModelConfig[];
    this.videoJobs = (await this.prisma.videoJob.findMany()) as VideoJob[];
    this.videoAssets = (await this.prisma.videoAsset.findMany()) as VideoAsset[];
    this.systemSettings = (await this.prisma.systemSetting.findMany()) as SystemSetting[];
    this.auditLogs = (await this.prisma.auditLog.findMany()) as AuditLog[];
  }

  async flush(): Promise<void> {
    this.flushPromise ??= this.flushInternal().finally(() => {
      this.flushPromise = undefined;
    });
    await this.flushPromise;
  }

  private async flushInternal(): Promise<void> {
    await upsertRows(this.prisma.user, this.users, serializeUser);
    await upsertRows(this.prisma.creditPackage, this.creditPackages, serializeCreditPackage);
    await upsertRows(this.prisma.modelConfig, this.modelConfigs, serializeModelConfig);
    await upsertRows(this.prisma.redemptionBatch, this.redemptionBatches, serializeRedemptionBatch);
    await upsertRows(this.prisma.redemptionCode, this.redemptionCodes, serializeRedemptionCode);
    await upsertRows(this.prisma.redemptionAttempt, this.redemptionAttempts, serializeRedemptionAttempt);
    await upsertRows(this.prisma.creditLedger, this.creditLedger, serializeCreditLedgerEntry);
    await upsertRows(this.prisma.videoJob, this.videoJobs, serializeVideoJob);
    await upsertRows(this.prisma.videoAsset, this.videoAssets, serializeVideoAsset);
    await upsertRows(this.prisma.systemSetting, this.systemSettings, serializeSystemSetting);
    await upsertRows(this.prisma.auditLog, this.auditLogs, serializeAuditLog);

    await deleteMissingRows(this.prisma.videoAsset, this.videoAssets.map((asset) => asset.id));
    await deleteMissingRows(this.prisma.videoJob, this.videoJobs.map((job) => job.id));
    await deleteMissingRows(this.prisma.creditPackage, this.creditPackages.map((pkg) => pkg.id));
    await deleteMissingRows(this.prisma.modelConfig, this.modelConfigs.map((model) => model.id));
    await deleteMissingRows(this.prisma.systemSetting, this.systemSettings.map((setting) => setting.id));
  }
}

async function upsertRows<T extends { id: string }>(
  delegate: Delegate,
  rows: T[],
  serialize: (row: T) => Record<string, unknown>
): Promise<void> {
  for (const row of rows) {
    const data = serialize(row);
    await delegate.upsert({
      where: { id: row.id },
      create: data,
      update: data
    });
  }
}

async function deleteMissingRows(delegate: Delegate, keepIds: string[]): Promise<void> {
  await delegate.deleteMany({
    where: {
      id: {
        notIn: keepIds
      }
    }
  });
}

function serializeUser(user: User): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    role: user.role,
    status: user.status,
    creditBalance: user.creditBalance,
    purchasedPackageName: user.purchasedPackageName,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function serializeCreditLedgerEntry(entry: CreditLedgerEntry): Record<string, unknown> {
  return {
    id: entry.id,
    userId: entry.userId,
    type: entry.type,
    amount: entry.amount,
    balanceAfter: entry.balanceAfter,
    refType: entry.refType,
    refId: entry.refId,
    idempotencyKey: entry.idempotencyKey,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt
  };
}

function serializeRedemptionBatch(batch: RedemptionBatch): Record<string, unknown> {
  return {
    id: batch.id,
    name: batch.name,
    quantity: batch.quantity,
    creditsPerCode: batch.creditsPerCode,
    expiresAt: batch.expiresAt ?? null,
    status: batch.status,
    createdBy: batch.createdBy,
    createdAt: batch.createdAt
  };
}

function serializeRedemptionCode(code: RedemptionCode): Record<string, unknown> {
  return {
    id: code.id,
    batchId: code.batchId,
    codeHash: code.codeHash,
    codeCiphertext: code.plainCode ?? null,
    codePrefix: code.codePrefix,
    codeSuffix: code.codeSuffix,
    credits: code.credits,
    status: code.status,
    expiresAt: code.expiresAt ?? null,
    redeemedBy: code.redeemedBy,
    redeemedAt: code.redeemedAt,
    createdAt: code.createdAt
  };
}

function deserializeRedemptionCode(row: unknown): RedemptionCode {
  const code = row as RedemptionCode & { codeCiphertext?: string | null };
  return {
    id: code.id,
    batchId: code.batchId,
    codeHash: code.codeHash,
    plainCode: code.plainCode ?? code.codeCiphertext ?? undefined,
    codePrefix: code.codePrefix,
    codeSuffix: code.codeSuffix,
    credits: code.credits,
    status: code.status,
    expiresAt: code.expiresAt ?? undefined,
    redeemedBy: code.redeemedBy ?? undefined,
    redeemedAt: code.redeemedAt ?? undefined,
    createdAt: code.createdAt
  };
}

function serializeRedemptionAttempt(attempt: RedemptionAttempt): Record<string, unknown> {
  return {
    id: attempt.id,
    userId: attempt.userId,
    codeHash: attempt.codeHash,
    success: attempt.success,
    failureReason: attempt.failureReason,
    ip: attempt.ip,
    userAgent: attempt.userAgent,
    createdAt: attempt.createdAt
  };
}

function serializeCreditPackage(pkg: CreditPackage): Record<string, unknown> {
  return {
    id: pkg.id,
    name: pkg.name,
    priceCents: pkg.priceCents,
    credits: pkg.credits,
    validDays: pkg.validDays,
    purchaseUrl: pkg.purchaseUrl,
    enabled: pkg.enabled,
    sortOrder: pkg.sortOrder,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt
  };
}

function serializeModelConfig(model: ModelConfig): Record<string, unknown> {
  return {
    id: model.id,
    modelName: model.modelName,
    displayName: model.displayName,
    providerBaseUrl: model.providerBaseUrl,
    submitPath: model.submitPath,
    statusPath: model.statusPath,
    resultPath: model.resultPath,
    authType: model.authType,
    apiKeyCiphertext: model.apiKeyCiphertext,
    apiKeyLast4: model.apiKeyLast4,
    keyVersion: model.keyVersion ?? 1,
    costCredits: model.costCredits,
    enabled: model.enabled,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    updatedBy: model.updatedBy,
    deletedAt: model.deletedAt ?? null
  };
}

function serializeVideoJob(job: VideoJob): Record<string, unknown> {
  return {
    id: job.id,
    userId: job.userId,
    modelConfigId: job.modelConfigId,
    mode: job.mode,
    prompt: job.prompt,
    resolution: job.resolution,
    aspectRatio: job.aspectRatio ?? null,
    durationSeconds: job.durationSeconds,
    imageCount: job.imageCount ?? 0,
    videoCount: job.videoCount ?? 0,
    audioCount: job.audioCount ?? 0,
    costCredits: job.costCredits,
    status: job.status,
    providerTaskId: job.providerTaskId,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt
  };
}

function serializeVideoAsset(asset: VideoAsset): Record<string, unknown> {
  return {
    id: asset.id,
    jobId: asset.jobId,
    type: asset.type,
    storageKey: asset.storageKey,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    expiresAt: asset.expiresAt,
    deletedAt: asset.deletedAt,
    createdAt: asset.createdAt
  };
}

function serializeSystemSetting(setting: SystemSetting): Record<string, unknown> {
  return {
    id: setting.id,
    publicApiBaseUrl: setting.publicApiBaseUrl ?? null,
    createdAt: setting.createdAt,
    updatedAt: setting.updatedAt,
    updatedBy: setting.updatedBy
  };
}

function serializeAuditLog(log: AuditLog): Record<string, unknown> {
  return {
    id: log.id,
    actorId: log.actorId,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    metadata: log.metadata,
    ip: log.ip,
    createdAt: log.createdAt
  };
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

export async function disconnectPrisma(prisma: PrismaClient): Promise<void> {
  await prisma.$disconnect();
}
