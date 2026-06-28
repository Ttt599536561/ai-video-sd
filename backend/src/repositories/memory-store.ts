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

export class InMemoryStore {
  users: User[] = [];
  creditLedger: CreditLedgerEntry[] = [];
  redemptionBatches: RedemptionBatch[] = [];
  redemptionCodes: RedemptionCode[] = [];
  redemptionAttempts: RedemptionAttempt[] = [];
  creditPackages: CreditPackage[] = [];
  modelConfigs: ModelConfig[] = [];
  videoJobs: VideoJob[] = [];
  videoAssets: VideoAsset[] = [];
  systemSettings: SystemSetting[] = [];
  auditLogs: AuditLog[] = [];

  findUserByEmail(email: string): User | undefined {
    return this.users.find((user) => user.email === email.toLowerCase());
  }

  findUserById(id: string): User | undefined {
    return this.users.find((user) => user.id === id);
  }

  findRedemptionCodeByHash(codeHash: string): RedemptionCode | undefined {
    return this.redemptionCodes.find((code) => code.codeHash === codeHash);
  }
}
