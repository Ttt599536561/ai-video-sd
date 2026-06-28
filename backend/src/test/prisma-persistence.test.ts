import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { PrismaBackedStore } from "../repositories/prisma-store.js";
import { AuthService } from "../services/auth.service.js";
import { createId } from "../services/crypto.service.js";

describe("PrismaBackedStore", () => {
  it("persists registered users so a fresh store can log in after reload", async () => {
    const prisma = createFakePrisma();
    const firstStore = await PrismaBackedStore.create(prisma);
    const firstAuth = new AuthService(firstStore, { jwtSecret: "test-secret" });

    const registered = await firstAuth.register({ email: "person@example.com", password: "password123" });
    await firstStore.flush();

    const secondStore = await PrismaBackedStore.create(prisma);
    const secondAuth = new AuthService(secondStore, { jwtSecret: "test-secret" });

    const login = await secondAuth.login({ email: "person@example.com", password: "password123" });
    expect(login.user.id).toBe(registered.user.id);
    expect(login.user.email).toBe("person@example.com");
  });

  it("flushes mutations made through HTTP routes", async () => {
    const prisma = createFakePrisma();
    const appStore = await PrismaBackedStore.create(prisma);
    const app = await createApp({
      store: appStore,
      jwtSecret: "test-secret",
      redemptionHashSecret: "hash-secret"
    });

    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "route-person@example.com", password: "password123" }
    });
    expect(registered.statusCode).toBe(201);
    await app.close();

    const freshStore = await PrismaBackedStore.create(prisma);
    const freshAuth = new AuthService(freshStore, { jwtSecret: "test-secret" });
    const login = await freshAuth.login({ email: "route-person@example.com", password: "password123" });

    expect(login.user.email).toBe("route-person@example.com");
  });

  it("persists admin audit logs written by HTTP routes", async () => {
    const prisma = createFakePrisma();
    const appStore = await PrismaBackedStore.create(prisma);
    const app = await createApp({
      store: appStore,
      jwtSecret: "test-secret",
      redemptionHashSecret: "hash-secret"
    });
    const auth = new AuthService(appStore, { jwtSecret: "test-secret" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    await appStore.flush();

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/credit-packages",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Persistent audit pack",
        priceCents: 1000,
        credits: 200,
        validDays: 30,
        enabled: true,
        sortOrder: 1,
        purchaseUrl: "https://pay.example.com/persistent"
      }
    });
    expect(created.statusCode).toBe(201);
    await app.close();

    const freshStore = await PrismaBackedStore.create(prisma);
    expect(freshStore.auditLogs).toEqual([
      expect.objectContaining({
        actorId: admin.user.id,
        action: "CREDIT_PACKAGE_CREATED",
        targetType: "credit_package",
        targetId: created.json().id,
        metadata: expect.objectContaining({
          after: expect.objectContaining({
            name: "Persistent audit pack",
            credits: 200,
            purchaseUrl: "https://pay.example.com/persistent"
          })
        })
      })
    ]);
    expect(freshStore.creditPackages).toEqual([
      expect.objectContaining({
        name: "Persistent audit pack",
        purchaseUrl: "https://pay.example.com/persistent"
      })
    ]);
  });

  it("persists full redemption codes so admins can review generated history after reload", async () => {
    const prisma = createFakePrisma();
    const appStore = await PrismaBackedStore.create(prisma);
    const app = await createApp({
      store: appStore,
      jwtSecret: "test-secret",
      redemptionHashSecret: "hash-secret"
    });
    const auth = new AuthService(appStore, { jwtSecret: "test-secret" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    await appStore.flush();

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/redemption-batches",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Reloadable gifts",
        quantity: 1,
        creditsPerCode: 88,
        expiresAt: null
      }
    });
    expect(created.statusCode).toBe(201);
    const generatedCode = created.json().codes[0].plainCode;
    await app.close();

    const freshStore = await PrismaBackedStore.create(prisma);

    expect(freshStore.redemptionCodes).toEqual([
      expect.objectContaining({
        plainCode: generatedCode,
        credits: 88,
        status: "ACTIVE"
      })
    ]);
  });

  it("persists system settings across store reloads", async () => {
    const prisma = createFakePrisma();
    const firstStore = await PrismaBackedStore.create(prisma);
    firstStore.systemSettings.push({
      id: "global",
      publicApiBaseUrl: "https://api.example.com",
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: "admin-id"
    });
    await firstStore.flush();

    const freshStore = await PrismaBackedStore.create(prisma);

    expect(freshStore.systemSettings).toEqual([
      expect.objectContaining({
        id: "global",
        publicApiBaseUrl: "https://api.example.com",
        updatedBy: "admin-id"
      })
    ]);
  });

  it("persists model config encryption key versions", async () => {
    const prisma = createFakePrisma();
    const firstStore = await PrismaBackedStore.create(prisma);
    firstStore.modelConfigs.push({
      id: createId(),
      modelName: "video-ds-2.0",
      displayName: "Video DS 2.0",
      providerBaseUrl: "https://provider.example.com",
      submitPath: "/v1/videos",
      authType: "BEARER",
      apiKeyCiphertext: "v1:iv:tag:cipher",
      apiKeyLast4: "cret",
      keyVersion: 2,
      costCredits: 80,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await firstStore.flush();

    const freshStore = await PrismaBackedStore.create(prisma);
    expect(freshStore.modelConfigs).toEqual([
      expect.objectContaining({
        modelName: "video-ds-2.0",
        keyVersion: 2
      })
    ]);
  });
});

function createFakePrisma() {
  const tableNames = [
    "user",
    "creditLedger",
    "redemptionBatch",
    "redemptionCode",
    "redemptionAttempt",
    "creditPackage",
    "modelConfig",
    "videoJob",
    "videoAsset",
    "systemSetting",
    "auditLog"
  ] as const;

  const prisma: Record<string, unknown> = {
    $disconnect: async () => undefined
  };

  for (const tableName of tableNames) {
    const rows = new Map<string, Record<string, unknown>>();
    prisma[tableName] = {
      findMany: async () => [...rows.values()].map((row) => ({ ...row })),
      upsert: async ({ where, create, update }: { where: { id: string }; create: object; update: object }) => {
        const next = { ...(rows.get(where.id) ?? {}), ...(rows.has(where.id) ? update : create) };
        rows.set(where.id, next);
        return { ...next };
      },
      deleteMany: async ({ where }: { where?: { id?: { notIn?: string[] } } } = {}) => {
        const keepIds = where?.id?.notIn;
        if (!keepIds) {
          rows.clear();
          return { count: 0 };
        }
        let count = 0;
        for (const id of [...rows.keys()]) {
          if (!keepIds.includes(id)) {
            rows.delete(id);
            count += 1;
          }
        }
        return { count };
      }
    };
  }

  return prisma as never;
}
