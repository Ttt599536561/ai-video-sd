import type { CreditPackage, ModelAuthType, ModelConfig, SystemSetting, UserStatus } from "../domain/types.js";
import { toPublicUser } from "../domain/types.js";
import type { InMemoryStore } from "../repositories/memory-store.js";
import type { ModelConfigEncryptionKeyring } from "../server-config.js";
import { createId, encryptSecret } from "./crypto.service.js";

interface AdminServiceOptions {
  encryptionKeyring: ModelConfigEncryptionKeyring;
}

interface CreateModelConfigInput {
  modelName: string;
  displayName: string;
  providerBaseUrl: string;
  submitPath: string;
  statusPath?: string;
  resultPath?: string;
  authType: ModelAuthType;
  apiKey: string;
  costCredits: number;
  enabled: boolean;
}

type UpdateModelConfigInput = Partial<CreateModelConfigInput>;

interface UpdateSystemSettingsInput {
  publicApiBaseUrl?: string | null;
}

interface CreatePackageInput {
  name: string;
  priceCents: number;
  credits: number;
  validDays: number;
  purchaseUrl?: string;
  enabled: boolean;
  sortOrder: number;
}

export class AdminService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly options: AdminServiceOptions
  ) {}

  listUsers() {
    return this.store.users.filter((user) => user.role !== "ADMIN").map(toPublicUser);
  }

  updateUser(userId: string, input: { status?: UserStatus; purchasedPackageName?: string }) {
    const user = this.store.findUserById(userId);
    if (!user) throw new Error("User not found");
    if (input.status) user.status = input.status;
    if (input.purchasedPackageName !== undefined) user.purchasedPackageName = input.purchasedPackageName;
    user.updatedAt = new Date();
    return toPublicUser(user);
  }

  adjustCredits(userId: string, amount: number, adminId: string, reason = "ADMIN_ADJUST") {
    const user = this.store.findUserById(userId);
    if (!user) throw new Error("User not found");
    const nextBalance = user.creditBalance + amount;
    if (nextBalance < 0) throw new Error("Credit balance cannot be negative");
    user.creditBalance = nextBalance;
    user.updatedAt = new Date();
    this.store.creditLedger.push({
      id: createId(),
      userId,
      type: "ADMIN_ADJUST",
      amount,
      balanceAfter: nextBalance,
      refType: "admin_adjustment",
      refId: reason,
      idempotencyKey: `admin-adjust:${createId()}`,
      createdBy: adminId,
      createdAt: new Date()
    });
    return toPublicUser(user);
  }

  createModelConfig(input: CreateModelConfigInput, adminId: string) {
    validateProviderUrl(input.providerBaseUrl);
    if (this.store.modelConfigs.some((model) => !model.deletedAt && model.modelName === input.modelName)) {
      throw new Error("Model already exists");
    }
    const now = new Date();
    const model: ModelConfig = {
      id: createId(),
      modelName: input.modelName,
      displayName: input.displayName,
      providerBaseUrl: input.providerBaseUrl,
      submitPath: input.submitPath,
      statusPath: input.statusPath,
      resultPath: input.resultPath,
      authType: input.authType,
      apiKeyCiphertext: encryptSecret(input.apiKey, this.options.encryptionKeyring.currentKey),
      apiKeyLast4: input.apiKey.slice(-4),
      keyVersion: this.options.encryptionKeyring.currentVersion,
      costCredits: input.costCredits,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
      updatedBy: adminId
    };
    this.store.modelConfigs.push(model);
    return maskModelConfig(model);
  }

  updateModelConfig(modelId: string, input: UpdateModelConfigInput, adminId: string) {
    const model = this.store.modelConfigs.find((item) => item.id === modelId && !item.deletedAt);
    if (!model) throw new Error("Model not found");
    if (input.providerBaseUrl !== undefined) {
      validateProviderUrl(input.providerBaseUrl);
      model.providerBaseUrl = input.providerBaseUrl;
    }
    if (
      input.modelName !== undefined &&
      input.modelName !== model.modelName &&
      this.store.modelConfigs.some((item) => !item.deletedAt && item.modelName === input.modelName)
    ) {
      throw new Error("Model already exists");
    }

    if (input.modelName !== undefined) model.modelName = input.modelName;
    if (input.displayName !== undefined) model.displayName = input.displayName;
    if (input.submitPath !== undefined) model.submitPath = input.submitPath;
    if (input.statusPath !== undefined) model.statusPath = input.statusPath;
    if (input.resultPath !== undefined) model.resultPath = input.resultPath;
    if (input.authType !== undefined) model.authType = input.authType;
    if (input.apiKey !== undefined) {
      model.apiKeyCiphertext = encryptSecret(input.apiKey, this.options.encryptionKeyring.currentKey);
      model.apiKeyLast4 = input.apiKey.slice(-4);
      model.keyVersion = this.options.encryptionKeyring.currentVersion;
    }
    if (input.costCredits !== undefined) model.costCredits = input.costCredits;
    if (input.enabled !== undefined) model.enabled = input.enabled;
    model.updatedAt = new Date();
    model.updatedBy = adminId;
    return maskModelConfig(model);
  }

  listModelConfigs() {
    return this.store.modelConfigs.filter((model) => !model.deletedAt).map(maskModelConfig);
  }

  listPublicModels() {
    return this.store.modelConfigs
      .filter((model) => model.enabled && !model.deletedAt)
      .map((model) => ({
        modelName: model.modelName,
        displayName: model.displayName,
        costCredits: model.costCredits
      }));
  }

  deleteModelConfig(modelId: string, adminId?: string): void {
    const model = this.store.modelConfigs.find((item) => item.id === modelId && !item.deletedAt);
    if (!model) {
      throw new Error("Model not found");
    }
    if (this.store.videoJobs.some((job) => job.modelConfigId === modelId)) {
      const now = new Date();
      model.modelName = `${model.modelName}__deleted__${model.id}`;
      model.enabled = false;
      model.deletedAt = now;
      model.updatedAt = now;
      model.updatedBy = adminId;
      return;
    }
    this.store.modelConfigs = this.store.modelConfigs.filter((model) => model.id !== modelId);
  }

  createCreditPackage(input: CreatePackageInput): CreditPackage {
    const now = new Date();
    const pkg: CreditPackage = {
      id: createId(),
      ...input,
      purchaseUrl: normalizePurchaseUrl(input.purchaseUrl),
      createdAt: now,
      updatedAt: now
    };
    this.store.creditPackages.push(pkg);
    return pkg;
  }

  updateCreditPackage(packageId: string, input: Partial<CreatePackageInput>): CreditPackage {
    const pkg = this.store.creditPackages.find((item) => item.id === packageId);
    if (!pkg) throw new Error("Credit package not found");
    if (input.name !== undefined) pkg.name = input.name;
    if (input.priceCents !== undefined) pkg.priceCents = input.priceCents;
    if (input.credits !== undefined) pkg.credits = input.credits;
    if (input.validDays !== undefined) pkg.validDays = input.validDays;
    if (input.purchaseUrl !== undefined) pkg.purchaseUrl = normalizePurchaseUrl(input.purchaseUrl);
    if (input.enabled !== undefined) pkg.enabled = input.enabled;
    if (input.sortOrder !== undefined) pkg.sortOrder = input.sortOrder;
    pkg.updatedAt = new Date();
    return pkg;
  }

  listCreditPackages(includeDisabled = false): CreditPackage[] {
    return this.store.creditPackages
      .filter((pkg) => includeDisabled || pkg.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  deleteCreditPackage(packageId: string): void {
    this.store.creditPackages = this.store.creditPackages.filter((pkg) => pkg.id !== packageId);
  }

  getSystemSettings(): Pick<SystemSetting, "publicApiBaseUrl"> {
    return {
      publicApiBaseUrl: this.store.systemSettings.find((setting) => setting.id === "global")?.publicApiBaseUrl
    };
  }

  updateSystemSettings(input: UpdateSystemSettingsInput, adminId: string): Pick<SystemSetting, "publicApiBaseUrl"> {
    const now = new Date();
    let setting = this.store.systemSettings.find((item) => item.id === "global");
    if (!setting) {
      setting = {
        id: "global",
        createdAt: now,
        updatedAt: now
      };
      this.store.systemSettings.push(setting);
    }
    if (input.publicApiBaseUrl !== undefined) {
      setting.publicApiBaseUrl = normalizePublicApiBaseUrl(input.publicApiBaseUrl);
    }
    setting.updatedAt = now;
    setting.updatedBy = adminId;
    return this.getSystemSettings();
  }
}

function normalizePurchaseUrl(rawUrl: string | undefined): string | undefined {
  const url = rawUrl?.trim();
  if (!url) return undefined;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Purchase URL must use http or https");
  }
  return parsed.toString();
}

export function normalizePublicApiBaseUrl(rawUrl: string | null | undefined): string | undefined {
  const url = rawUrl?.trim();
  if (!url) return undefined;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Public API base URL must use http or https");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  ) {
    throw new Error("Public API base URL must be publicly reachable");
  }
  return parsed.origin;
}

export function maskModelConfig(model: ModelConfig) {
  return {
    id: model.id,
    modelName: model.modelName,
    displayName: model.displayName,
    providerBaseUrl: model.providerBaseUrl,
    submitPath: model.submitPath,
    statusPath: model.statusPath,
    resultPath: model.resultPath,
    authType: model.authType,
    apiKeyLast4: model.apiKeyLast4,
    costCredits: model.costCredits,
    enabled: model.enabled,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    updatedBy: model.updatedBy
  };
}

function validateProviderUrl(rawUrl: string): void {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("Provider URL must use https");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  ) {
    throw new Error("Provider URL cannot target private network addresses");
  }
}
