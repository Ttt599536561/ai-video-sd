export type UserRole = "USER" | "ADMIN";
export type UserStatus = "ACTIVE" | "BANNED";
export type LedgerType = "REDEEM_CODE" | "PURCHASE" | "VIDEO_COST" | "ADMIN_ADJUST" | "REFUND";
export type RedemptionCodeStatus = "ACTIVE" | "REDEEMED" | "VOID" | "EXPIRED";
export type BatchStatus = "ACTIVE" | "VOID";
export type ModelAuthType = "BEARER" | "HEADER_KEY";
export type VideoMode = "TEXT_IMAGE_TO_VIDEO" | "VIDEO_TO_VIDEO";
export type VideoJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
export type AssetType = "INPUT_IMAGE" | "INPUT_VIDEO" | "OUTPUT_VIDEO";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  creditBalance: number;
  purchasedPackageName?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  creditBalance: number;
  purchasedPackageName?: string;
  createdAt: Date;
}

export interface CreditLedgerEntry {
  id: string;
  userId: string;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  refType?: string;
  refId?: string;
  idempotencyKey: string;
  createdBy?: string;
  createdAt: Date;
}

export interface RedemptionBatch {
  id: string;
  name: string;
  quantity: number;
  creditsPerCode: number;
  expiresAt?: Date;
  status: BatchStatus;
  createdBy: string;
  createdAt: Date;
}

export interface RedemptionCode {
  id: string;
  batchId: string;
  codeHash: string;
  plainCode?: string;
  codePrefix: string;
  codeSuffix: string;
  credits: number;
  status: RedemptionCodeStatus;
  expiresAt?: Date;
  redeemedBy?: string;
  redeemedAt?: Date;
  createdAt: Date;
}

export interface RedemptionAttempt {
  id: string;
  userId: string;
  codeHash: string;
  success: boolean;
  failureReason?: string;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

export interface CreditPackage {
  id: string;
  name: string;
  priceCents: number;
  credits: number;
  validDays: number;
  purchaseUrl?: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModelConfig {
  id: string;
  modelName: string;
  displayName: string;
  providerBaseUrl: string;
  submitPath: string;
  statusPath?: string;
  resultPath?: string;
  authType: ModelAuthType;
  apiKeyCiphertext: string;
  apiKeyLast4: string;
  keyVersion?: number;
  costCredits: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedBy?: string;
  deletedAt?: Date;
}

export interface VideoJob {
  id: string;
  userId: string;
  modelConfigId: string;
  mode: VideoMode;
  prompt: string;
  resolution: "480P" | "720P" | "1080P";
  aspectRatio?: "9:16" | "16:9" | "1:1";
  durationSeconds: number;
  imageCount?: number;
  videoCount?: number;
  audioCount?: number;
  costCredits: number;
  status: VideoJobStatus;
  providerTaskId?: string;
  errorMessage?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface VideoAsset {
  id: string;
  jobId: string;
  type: AssetType;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  createdAt: Date;
}

export interface SystemSetting {
  id: "global";
  publicApiBaseUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy?: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    creditBalance: user.creditBalance,
    purchasedPackageName: user.purchasedPackageName,
    createdAt: user.createdAt
  };
}
