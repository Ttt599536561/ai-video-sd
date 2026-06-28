import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../repositories/memory-store.js";
import { AuthService } from "../services/auth.service.js";
import { RedemptionService } from "../services/redemption.service.js";

describe("RedemptionService", () => {
  it("generates a batch of unique admin redemption codes", async () => {
    const store = new InMemoryStore();
    const auth = new AuthService(store, { jwtSecret: "test" });
    const redemption = new RedemptionService(store, { hashSecret: "hash-secret" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const batch = await redemption.generateBatch({
      name: "Launch credits",
      quantity: 5,
      creditsPerCode: 100,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdBy: admin.user.id
    });

    expect(batch.codes).toHaveLength(5);
    expect(new Set(batch.codes.map((code) => code.plainCode)).size).toBe(5);
    expect(batch.codes.every((code) => /^[A-Za-z0-9]{18}$/.test(code.plainCode ?? ""))).toBe(true);
  });

  it("generates permanent 18-character alphanumeric codes when no expiry is provided", async () => {
    const store = new InMemoryStore();
    const auth = new AuthService(store, { jwtSecret: "test" });
    const redemption = new RedemptionService(store, { hashSecret: "hash-secret" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });

    const batch = await redemption.generateBatch({
      name: "Permanent credits",
      quantity: 1,
      creditsPerCode: 88,
      createdBy: admin.user.id
    });

    expect(batch.codes[0].plainCode).toMatch(/^[A-Za-z0-9]{18}$/);
    expect(batch.codes[0].expiresAt).toBeUndefined();

    const redeemed = await redemption.redeem({
      code: batch.codes[0].plainCode,
      userId: user.user.id
    });
    expect(redeemed.balance).toBe(88);
  });

  it("redeems a valid code once and writes a credit ledger entry", async () => {
    const store = new InMemoryStore();
    const auth = new AuthService(store, { jwtSecret: "test" });
    const redemption = new RedemptionService(store, { hashSecret: "hash-secret" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    const batch = await redemption.generateBatch({
      name: "Gift",
      quantity: 1,
      creditsPerCode: 250,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdBy: admin.user.id
    });

    const result = await redemption.redeem({
      code: batch.codes[0].plainCode,
      userId: user.user.id,
      ip: "127.0.0.1",
      userAgent: "vitest"
    });

    expect(result.creditsAdded).toBe(250);
    expect(result.balance).toBe(250);
    expect(store.creditLedger).toHaveLength(1);
    expect(store.creditLedger[0].type).toBe("REDEEM_CODE");
  });

  it("rejects duplicate and invalid redemption codes", async () => {
    const store = new InMemoryStore();
    const auth = new AuthService(store, { jwtSecret: "test" });
    const redemption = new RedemptionService(store, { hashSecret: "hash-secret" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    const batch = await redemption.generateBatch({
      name: "Gift",
      quantity: 1,
      creditsPerCode: 100,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdBy: admin.user.id
    });

    await redemption.redeem({
      code: batch.codes[0].plainCode,
      userId: user.user.id,
      ip: "127.0.0.1",
      userAgent: "vitest"
    });

    await expect(
      redemption.redeem({
        code: batch.codes[0].plainCode,
        userId: user.user.id,
        ip: "127.0.0.1",
        userAgent: "vitest"
      })
    ).rejects.toThrow("Redemption code has already been used");

    await expect(
      redemption.redeem({
        code: "JK-NOT-A-REAL-CODE",
        userId: user.user.id,
        ip: "127.0.0.1",
        userAgent: "vitest"
      })
    ).rejects.toThrow("Redemption code does not exist");
  });
});
