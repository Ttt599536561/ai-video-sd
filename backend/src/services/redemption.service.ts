import type { RedemptionCode } from "../domain/types.js";
import type { InMemoryStore } from "../repositories/memory-store.js";
import {
  createId,
  generateRedemptionCode,
  hashRedemptionCode,
  normalizeRedemptionCode
} from "./crypto.service.js";

interface RedemptionOptions {
  hashSecret: string;
}

interface GenerateBatchInput {
  name: string;
  quantity: number;
  creditsPerCode: number;
  expiresAt?: Date;
  createdBy: string;
}

interface RedeemInput {
  code: string;
  userId: string;
  ip?: string;
  userAgent?: string;
}

export class RedemptionService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly options: RedemptionOptions
  ) {}

  async generateBatch(input: GenerateBatchInput): Promise<{ batchId: string; codes: RedemptionCode[] }> {
    if (input.quantity < 1 || input.quantity > 5000) {
      throw new Error("Quantity must be between 1 and 5000");
    }
    if (input.creditsPerCode <= 0) {
      throw new Error("Credits per code must be positive");
    }
    const admin = this.store.findUserById(input.createdBy);
    if (!admin || admin.role !== "ADMIN") {
      throw new Error("Only admins can generate redemption codes");
    }

    const now = new Date();
    const batch = {
      id: createId(),
      name: input.name,
      quantity: input.quantity,
      creditsPerCode: input.creditsPerCode,
      expiresAt: input.expiresAt,
      status: "ACTIVE" as const,
      createdBy: input.createdBy,
      createdAt: now
    };
    this.store.redemptionBatches.push(batch);

    const codes: RedemptionCode[] = [];
    while (codes.length < input.quantity) {
      const plainCode = generateRedemptionCode();
      const codeHash = hashRedemptionCode(plainCode, this.options.hashSecret);
      if (this.store.findRedemptionCodeByHash(codeHash) || codes.some((code) => code.codeHash === codeHash)) {
        continue;
      }
      const normalized = normalizeRedemptionCode(plainCode);
      const code: RedemptionCode = {
        id: createId(),
        batchId: batch.id,
        codeHash,
        plainCode,
        codePrefix: plainCode.slice(0, 6),
        codeSuffix: normalized.slice(-4),
        credits: input.creditsPerCode,
        status: "ACTIVE",
        expiresAt: input.expiresAt,
        createdAt: now
      };
      codes.push(code);
      this.store.redemptionCodes.push(code);
    }

    return { batchId: batch.id, codes };
  }

  async redeem(input: RedeemInput): Promise<{ creditsAdded: number; balance: number }> {
    const user = this.store.findUserById(input.userId);
    if (!user) {
      throw new Error("User does not exist");
    }
    if (user.status === "BANNED") {
      throw new Error("User is banned");
    }

    const codeHash = hashRedemptionCode(input.code, this.options.hashSecret);
    const code = this.store.findRedemptionCodeByHash(codeHash);
    const attemptBase = {
      id: createId(),
      userId: input.userId,
      codeHash,
      ip: input.ip,
      userAgent: input.userAgent,
      createdAt: new Date()
    };

    if (!code) {
      this.store.redemptionAttempts.push({
        ...attemptBase,
        success: false,
        failureReason: "NOT_FOUND"
      });
      throw new Error("Redemption code does not exist");
    }
    if (code.status === "REDEEMED" || code.redeemedAt) {
      this.store.redemptionAttempts.push({
        ...attemptBase,
        success: false,
        failureReason: "ALREADY_REDEEMED"
      });
      throw new Error("Redemption code has already been used");
    }
    if (code.status === "VOID") {
      this.store.redemptionAttempts.push({
        ...attemptBase,
        success: false,
        failureReason: "VOID"
      });
      throw new Error("Redemption code has been voided");
    }
    if (code.expiresAt && code.expiresAt.getTime() < Date.now()) {
      code.status = "EXPIRED";
      this.store.redemptionAttempts.push({
        ...attemptBase,
        success: false,
        failureReason: "EXPIRED"
      });
      throw new Error("Redemption code has expired");
    }

    const now = new Date();
    code.status = "REDEEMED";
    code.redeemedBy = input.userId;
    code.redeemedAt = now;
    user.creditBalance += code.credits;
    user.updatedAt = now;
    this.store.creditLedger.push({
      id: createId(),
      userId: input.userId,
      type: "REDEEM_CODE",
      amount: code.credits,
      balanceAfter: user.creditBalance,
      refType: "redemption_code",
      refId: code.id,
      idempotencyKey: `redeem:${code.id}`,
      createdAt: now
    });
    this.store.redemptionAttempts.push({
      ...attemptBase,
      success: true
    });

    return { creditsAdded: code.credits, balance: user.creditBalance };
  }
}
