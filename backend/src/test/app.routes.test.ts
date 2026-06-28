import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { InMemoryStore } from "../repositories/memory-store.js";
import { parseModelConfigEncryptionKeyring } from "../server-config.js";
import { AuthService } from "../services/auth.service.js";
import { createId, decryptSecret, encryptSecret } from "../services/crypto.service.js";
import { OpenAiVideoProvider } from "../services/openai-video-provider.js";
import { VideoFileStorage } from "../services/video-file-storage.js";

describe("HTTP API", () => {
  let tmpRootDir: string | undefined;

  afterEach(() => {
    if (tmpRootDir) {
      rmSync(tmpRootDir, { recursive: true, force: true });
      tmpRootDir = undefined;
    }
  });

  it("registers, logs in, and returns the current user", async () => {
    const app = await createApp({ store: new InMemoryStore(), jwtSecret: "test", redemptionHashSecret: "hash" });

    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "person@example.com", password: "password123" }
    });
    expect(register.statusCode).toBe(201);
    const registered = register.json();
    expect(registered.user.email).toBe("person@example.com");

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${registered.token}` }
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe("person@example.com");
  });

  it("allows the current user to change password", async () => {
    const app = await createApp({ store: new InMemoryStore(), jwtSecret: "test", redemptionHashSecret: "hash" });

    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "person@example.com", password: "password123" }
    });
    const token = register.json().token;

    const changed = await app.inject({
      method: "PATCH",
      url: "/api/me/password",
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: "password123", newPassword: "new-password123" }
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ ok: true });

    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "person@example.com", password: "password123" }
    });
    expect(oldLogin.statusCode).toBe(400);

    const newLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "person@example.com", password: "new-password123" }
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it("bootstraps the first admin only with the configured secret", async () => {
    const app = await createApp({
      store: new InMemoryStore(),
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      bootstrapAdminSecret: "bootstrap-secret"
    });

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap-admin",
      payload: { email: "admin@example.com", password: "password123", bootstrapSecret: "wrong" }
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap-admin",
      payload: { email: "admin@example.com", password: "password123", bootstrapSecret: "bootstrap-secret" }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().user.role).toBe("ADMIN");
  });

  it("disables admin bootstrap after an admin account exists", async () => {
    const store = new InMemoryStore();
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      bootstrapAdminSecret: "bootstrap-secret"
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    await auth.register({ email: "existing-admin@example.com", password: "password123", role: "ADMIN" });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap-admin",
      payload: { email: "second-admin@example.com", password: "password123", bootstrapSecret: "bootstrap-secret" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ADMIN_BOOTSTRAP_DISABLED");
  });

  it("allows admins to manage the public API base URL setting", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/system-settings",
      headers: { authorization: `Bearer ${user.token}` }
    });
    expect(forbidden.statusCode).toBe(403);

    const saved = await app.inject({
      method: "PATCH",
      url: "/api/admin/system-settings",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { publicApiBaseUrl: "https://api.example.com/" }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ publicApiBaseUrl: "https://api.example.com" });

    const loaded = await app.inject({
      method: "GET",
      url: "/api/admin/system-settings",
      headers: { authorization: `Bearer ${admin.token}` }
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual({ publicApiBaseUrl: "https://api.example.com" });
  });

  it("rejects private public API base URL settings", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/admin/system-settings",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { publicApiBaseUrl: "http://127.0.0.1:4000" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("PUBLIC_API_BASE_URL_INVALID");
  });

  it("allows admins to generate codes and users to redeem them", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/redemption-batches",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Gift",
        quantity: 2,
        creditsPerCode: 150,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString()
      }
    });
    expect(created.statusCode).toBe(201);
    const code = created.json().codes[0].plainCode;

    const redeemed = await app.inject({
      method: "POST",
      url: "/api/credits/redeem",
      headers: { authorization: `Bearer ${user.token}` },
      payload: { code }
    });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json().balance).toBe(150);
  });

  it("lets admins list every generated redemption code with full record details", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/redemption-batches",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Gift",
        quantity: 2,
        creditsPerCode: 150,
        expiresAt: null
      }
    });
    const [redeemedCode, activeCode] = created.json().codes;

    await app.inject({
      method: "POST",
      url: "/api/credits/redeem",
      headers: { authorization: `Bearer ${user.token}` },
      payload: { code: redeemedCode.plainCode }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/redemption-codes",
      headers: { authorization: `Bearer ${admin.token}` }
    });

    expect(response.statusCode).toBe(200);
    const records = response.json();
    expect(records).toHaveLength(2);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: redeemedCode.id,
          batchId: created.json().batchId,
          batchName: "Gift",
          plainCode: redeemedCode.plainCode,
          credits: 150,
          status: "REDEEMED",
          redeemedBy: user.user.id,
          redeemedByEmail: "user@example.com",
          redeemedAt: expect.any(String),
          createdAt: expect.any(String)
        }),
        expect.objectContaining({
          id: activeCode.id,
          batchId: created.json().batchId,
          batchName: "Gift",
          plainCode: activeCode.plainCode,
          credits: 150,
          status: "ACTIVE",
          redeemedBy: null,
          redeemedByEmail: null,
          expiresAt: null,
          createdAt: expect.any(String)
        })
      ])
    );
    for (const record of records) {
      expect(record).not.toHaveProperty("codeHash");
    }
  });

  it("lists only the current user's masked redemption records", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    const otherUser = await auth.register({ email: "other@example.com", password: "password123" });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/redemption-batches",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Spring campaign",
        quantity: 2,
        creditsPerCode: 150,
        expiresAt: null
      }
    });
    const [firstCode, secondCode] = created.json().codes;

    await app.inject({
      method: "POST",
      url: "/api/credits/redeem",
      headers: { authorization: `Bearer ${user.token}` },
      payload: { code: firstCode.plainCode }
    });
    await app.inject({
      method: "POST",
      url: "/api/credits/redeem",
      headers: { authorization: `Bearer ${otherUser.token}` },
      payload: { code: secondCode.plainCode }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/credits/redemptions",
      headers: { authorization: `Bearer ${user.token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        id: firstCode.id,
        batchId: created.json().batchId,
        batchName: "Spring campaign",
        credits: 150,
        codePrefix: firstCode.plainCode.slice(0, 6),
        codeSuffix: firstCode.plainCode.slice(-4),
        redeemedAt: expect.any(String),
        validityDays: null
      })
    ]);
    expect(response.json()[0]).not.toHaveProperty("codeHash");
    expect(response.json()[0]).not.toHaveProperty("plainCode");
    expect(response.json()[0]).not.toHaveProperty("idempotencyKey");
  });

  it("allows admins to generate permanent 18-character redemption codes", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/redemption-batches",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Permanent",
        quantity: 1,
        creditsPerCode: 99,
        expiresAt: null
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().codes[0].plainCode).toMatch(/^[A-Za-z0-9]{18}$/);
    expect(created.json().codes[0].expiresAt).toBeUndefined();
  });

  it("blocks non-admin access to admin endpoints", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${user.token}` }
    });
    expect(response.statusCode).toBe(403);
  });

  it("returns structured error codes and localized messages for common user-facing failures", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });

    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/credits/balance"
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toMatchObject({
      code: "AUTH_REQUIRED",
      message: "请先登录后再继续操作",
      statusCode: 401
    });

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${user.token}` }
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({
      code: "FORBIDDEN",
      message: "当前账号没有权限执行此操作",
      statusCode: 403
    });

    await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${user.user.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: "BANNED" }
    });
    const banned = await app.inject({
      method: "POST",
      url: "/api/credits/redeem",
      headers: { authorization: `Bearer ${user.token}` },
      payload: { code: "ABCDEFGH1234567890" }
    });
    expect(banned.statusCode).toBe(403);
    expect(banned.json()).toMatchObject({
      code: "USER_BANNED",
      message: "账号已被封禁，请联系管理员",
      statusCode: 403
    });
    await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${user.user.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: "ACTIVE" }
    });

    const missingCode = await app.inject({
      method: "POST",
      url: "/api/credits/redeem",
      headers: { authorization: `Bearer ${user.token}` },
      payload: { code: "ABCDEFGH1234567890" }
    });
    expect(missingCode.statusCode).toBe(404);
    expect(missingCode.json()).toMatchObject({
      code: "REDEMPTION_CODE_NOT_FOUND",
      message: "兑换码不存在，请检查后重试",
      statusCode: 404
    });

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-structured-errors",
        displayName: "Structured Error Model",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/video",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });
    const insufficientCredits = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "video-ds-structured-errors",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8
      }
    });
    expect(insufficientCredits.statusCode).toBe(400);
    expect(insufficientCredits.json()).toMatchObject({
      code: "INSUFFICIENT_CREDITS",
      message: "积分不足，请先购买或兑换积分",
      statusCode: 400
    });
  });

  it("does not include admin accounts in the admin user list", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    await auth.register({ email: "user@example.com", password: "password123" });

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${admin.token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().map((user: { email: string }) => user.email)).toEqual(["user@example.com"]);
  });

  it("records sanitized audit logs for admin model, package, redemption, user status, and credit actions", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });

    const model = await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-audit",
        displayName: "Audit Model",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/videos",
        authType: "BEARER",
        apiKey: "sk-audit-secret",
        costCredits: 50,
        enabled: true
      }
    });
    await app.inject({
      method: "PATCH",
      url: `/api/admin/model-configs/${model.json().id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { enabled: false, costCredits: 55 }
    });
    await app.inject({
      method: "DELETE",
      url: `/api/admin/model-configs/${model.json().id}`,
      headers: { authorization: `Bearer ${admin.token}` }
    });

    const creditPackage = await app.inject({
      method: "POST",
      url: "/api/admin/credit-packages",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Audit pack",
        priceCents: 990,
        credits: 100,
        validDays: 7,
        enabled: true,
        sortOrder: 1
      }
    });
    await app.inject({
      method: "PATCH",
      url: `/api/admin/credit-packages/${creditPackage.json().id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { enabled: false, credits: 120 }
    });
    await app.inject({
      method: "DELETE",
      url: `/api/admin/credit-packages/${creditPackage.json().id}`,
      headers: { authorization: `Bearer ${admin.token}` }
    });

    const redemptionBatch = await app.inject({
      method: "POST",
      url: "/api/admin/redemption-batches",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Audit gifts",
        quantity: 2,
        creditsPerCode: 30,
        expiresAt: null
      }
    });
    await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${user.user.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: "BANNED" }
    });
    await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${user.user.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: "ACTIVE" }
    });
    await app.inject({
      method: "POST",
      url: `/api/admin/users/${user.user.id}/adjust-credits`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { amount: 25, reason: "AUDIT_TEST" }
    });

    const logs = await app.inject({
      method: "GET",
      url: "/api/admin/audit-logs",
      headers: { authorization: `Bearer ${admin.token}` }
    });

    expect(logs.statusCode).toBe(200);
    const body = logs.json();
    expect(body.map((log: { action: string }) => log.action)).toEqual(
      expect.arrayContaining([
        "MODEL_CONFIG_CREATED",
        "MODEL_CONFIG_UPDATED",
        "MODEL_CONFIG_DELETED",
        "CREDIT_PACKAGE_CREATED",
        "CREDIT_PACKAGE_UPDATED",
        "CREDIT_PACKAGE_DELETED",
        "REDEMPTION_BATCH_CREATED",
        "USER_BANNED",
        "USER_UNBANNED",
        "USER_CREDITS_ADJUSTED"
      ])
    );
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: admin.user.id,
          action: "USER_CREDITS_ADJUSTED",
          targetType: "user",
          targetId: user.user.id,
          metadata: expect.objectContaining({
            amount: 25,
            reason: "AUDIT_TEST",
            balanceAfter: 25
          })
        }),
        expect.objectContaining({
          actorId: admin.user.id,
          action: "REDEMPTION_BATCH_CREATED",
          targetType: "redemption_batch",
          targetId: redemptionBatch.json().batchId,
          metadata: expect.objectContaining({
            name: "Audit gifts",
            quantity: 2,
            creditsPerCode: 30
          })
        })
      ])
    );
    expect(JSON.stringify(body)).not.toContain("sk-audit-secret");
    for (const code of redemptionBatch.json().codes) {
      expect(JSON.stringify(body)).not.toContain(code.plainCode);
      expect(JSON.stringify(body)).not.toContain(code.codeHash);
    }
  });

  it("allows browser preflight for admin PATCH and DELETE requests", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });

    const patchPreflight = await app.inject({
      method: "OPTIONS",
      url: "/api/admin/credit-packages/package-id",
      headers: {
        origin: "http://127.0.0.1:8765",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "content-type,authorization"
      }
    });

    const deletePreflight = await app.inject({
      method: "OPTIONS",
      url: "/api/admin/credit-packages/package-id",
      headers: {
        origin: "http://127.0.0.1:8765",
        "access-control-request-method": "DELETE",
        "access-control-request-headers": "content-type,authorization"
      }
    });

    expect(patchPreflight.statusCode).toBe(204);
    expect(patchPreflight.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(deletePreflight.statusCode).toBe(204);
    expect(deletePreflight.headers["access-control-allow-methods"]).toContain("DELETE");
  });

  it("allows admins to update model configs", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-2.0",
        displayName: "Video DS 2.0",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/video",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/admin/model-configs/${created.json().id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        displayName: "Video DS Fast",
        costCredits: 45,
        enabled: false
      }
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      displayName: "Video DS Fast",
      costCredits: 45,
      enabled: false,
      apiKeyLast4: "cret"
    });
    expect(updated.json().apiKeyCiphertext).toBeUndefined();
  });

  it("encrypts new model config keys with the current keyring version", async () => {
    const keyring = parseModelConfigEncryptionKeyring({
      MODEL_CONFIG_ENCRYPTION_KEYS: [
        `1:base64:${Buffer.alloc(32, 1).toString("base64")}`,
        `2:base64:${Buffer.alloc(32, 2).toString("base64")}`
      ].join(","),
      MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION: "2"
    });
    const store = new InMemoryStore();
    const options = { store, jwtSecret: "test", redemptionHashSecret: "hash", encryptionKeyring: keyring };
    const app = await createApp(options);
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-2.0",
        displayName: "Video DS 2.0",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/video",
        authType: "BEARER",
        apiKey: "sk-current-secret",
        costCredits: 80,
        enabled: true
      }
    });

    expect(created.statusCode).toBe(201);
    expect(store.modelConfigs[0]).toMatchObject({
      apiKeyLast4: "cret",
      keyVersion: 2
    });
    expect(decryptSecret(store.modelConfigs[0].apiKeyCiphertext, keyring.keyForVersion(2))).toBe(
      "sk-current-secret"
    );
    expect(() => decryptSecret(store.modelConfigs[0].apiKeyCiphertext, keyring.keyForVersion(1))).toThrow();
    expect(created.json().apiKeyCiphertext).toBeUndefined();
  });

  it("decrypts legacy model config keys using the stored key version", async () => {
    const keyring = parseModelConfigEncryptionKeyring({
      MODEL_CONFIG_ENCRYPTION_KEYS: [
        `1:base64:${Buffer.alloc(32, 1).toString("base64")}`,
        `2:base64:${Buffer.alloc(32, 2).toString("base64")}`
      ].join(","),
      MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION: "2"
    });
    const store = new InMemoryStore();
    store.modelConfigs.push({
      id: createId(),
      modelName: "video-ds-2.0",
      displayName: "Video DS 2.0",
      providerBaseUrl: "https://provider.example.com",
      submitPath: "/v1/videos",
      statusPath: "/v1/videos/{id}",
      resultPath: "/v1/videos/{id}/content",
      authType: "BEARER",
      apiKeyCiphertext: encryptSecret("sk-legacy-secret", keyring.keyForVersion(1)),
      apiKeyLast4: "cret",
      keyVersion: 1,
      costCredits: 80,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    } as (typeof store.modelConfigs)[number]);
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      encryptionKeyring: keyring,
      videoProviderFactory: ({ baseUrl, apiKey }) => {
        expect(baseUrl).toBe("https://provider.example.com");
        expect(apiKey).toBe("sk-legacy-secret");
        return new OpenAiVideoProvider({
          baseUrl,
          apiKey,
          fetch: async () =>
            new Response(
              JSON.stringify({
                object: "list",
                data: [{ id: "video-ds-2.0", supported_endpoint_types: ["openai-video"] }]
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
        });
      }
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const tested = await app.inject({
      method: "POST",
      url: `/api/admin/model-configs/${store.modelConfigs[0].id}/test-provider`,
      headers: { authorization: `Bearer ${admin.token}` }
    });

    expect(tested.statusCode).toBe(200);
    expect(tested.json()).toEqual({
      ok: true,
      models: [{ id: "video-ds-2.0", supportedEndpointTypes: ["openai-video"] }]
    });
  });

  it("allows admins to test a model provider by listing video-capable models", async () => {
    const store = new InMemoryStore();
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      videoProviderFactory: ({ baseUrl, apiKey }) =>
        new OpenAiVideoProvider({
          baseUrl,
          apiKey,
          fetch: async () =>
            new Response(
              JSON.stringify({
                object: "list",
                data: [
                  { id: "video-ds-2.0", supported_endpoint_types: ["openai-video"] },
                  { id: "text-model", supported_endpoint_types: ["chat"] }
                ]
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
        })
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-2.0",
        displayName: "Video DS 2.0",
        providerBaseUrl: "https://zz1cc.cc.cd",
        submitPath: "/v1/videos",
        statusPath: "/v1/videos/{id}",
        resultPath: "/v1/videos/{id}/content",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const tested = await app.inject({
      method: "POST",
      url: `/api/admin/model-configs/${created.json().id}/test-provider`,
      headers: { authorization: `Bearer ${admin.token}` }
    });

    expect(tested.statusCode).toBe(200);
    expect(tested.json()).toEqual({
      ok: true,
      models: [{ id: "video-ds-2.0", supportedEndpointTypes: ["openai-video"] }]
    });
  });

  it("allows admins to list supplier video models before creating a model config", async () => {
    const store = new InMemoryStore();
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      defaultVideoProviderConfig: {
        baseUrl: "https://zz1cc.cc.cd",
        apiKey: "sk-test-secret"
      },
      videoProviderFactory: ({ baseUrl, apiKey }) =>
        new OpenAiVideoProvider({
          baseUrl,
          apiKey,
          fetch: async () =>
            new Response(
              JSON.stringify({
                object: "list",
                data: [
                  { id: "video-ds-2.0", supported_endpoint_types: ["openai-video"] },
                  { id: "video-ds-2.0-fast", supported_endpoint_types: ["openai-video"] },
                  { id: "chat-only", supported_endpoint_types: ["chat"] }
                ]
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
        })
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/provider-models",
      headers: { authorization: `Bearer ${admin.token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      baseUrl: "https://zz1cc.cc.cd",
      models: [
        { id: "video-ds-2.0", supportedEndpointTypes: ["openai-video"] },
        { id: "video-ds-2.0-fast", supportedEndpointTypes: ["openai-video"] }
      ]
    });
  });

  it("allows admins to delete unused model configs", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-delete",
        displayName: "Video DS Delete",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/video",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/admin/model-configs/${created.json().id}`,
      headers: { authorization: `Bearer ${admin.token}` }
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` }
    });

    expect(deleted.statusCode).toBe(204);
    expect(list.json()).toEqual([]);
  });

  it("hides referenced model configs after admin deletion while preserving video jobs", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-referenced-delete",
        displayName: "Video DS Referenced Delete",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/video",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const job = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "video-ds-referenced-delete",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8
      }
    });
    expect(job.statusCode).toBe(201);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/admin/model-configs/${created.json().id}`,
      headers: { authorization: `Bearer ${admin.token}` }
    });

    const adminList = await app.inject({
      method: "GET",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` }
    });
    const publicList = await app.inject({ method: "GET", url: "/api/models" });
    const jobs = await app.inject({
      method: "GET",
      url: "/api/admin/video-jobs",
      headers: { authorization: `Bearer ${admin.token}` }
    });

    expect(deleted.statusCode).toBe(204);
    expect(adminList.json()).toEqual([]);
    expect(publicList.json()).toEqual([]);
    expect(jobs.json()).toHaveLength(1);
    expect(jobs.json()[0].id).toBe(job.json().id);
  });

  it("allows admins to update credit packages", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/credit-packages",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Weekly",
        priceCents: 1990,
        credits: 100,
        validDays: 7,
        enabled: true,
        sortOrder: 1,
        purchaseUrl: "https://pay.example.com/weekly"
      }
    });

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/admin/credit-packages/${created.json().id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Monthly",
        priceCents: 6990,
        credits: 500,
        validDays: 30,
        enabled: false,
        sortOrder: 2,
        purchaseUrl: "https://pay.example.com/monthly"
      }
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      name: "Monthly",
      priceCents: 6990,
      credits: 500,
      validDays: 30,
      enabled: false,
      sortOrder: 2,
      purchaseUrl: "https://pay.example.com/monthly"
    });
  });

  it("returns purchase URLs on enabled public credit packages", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/credit-packages",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Annual",
        priceCents: 19900,
        credits: 2000,
        validDays: 365,
        enabled: true,
        sortOrder: 1,
        purchaseUrl: "https://pay.example.com/annual"
      }
    });

    const publicList = await app.inject({ method: "GET", url: "/api/credit-packages" });

    expect(created.statusCode).toBe(201);
    expect(publicList.statusCode).toBe(200);
    expect(publicList.json()).toEqual([
      expect.objectContaining({
        name: "Annual",
        purchaseUrl: "https://pay.example.com/annual"
      })
    ]);
  });

  it("rejects unsafe credit package purchase URLs", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/credit-packages",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Unsafe",
        priceCents: 100,
        credits: 10,
        validDays: 1,
        enabled: true,
        sortOrder: 1,
        purchaseUrl: "javascript:alert(1)"
      }
    });

    expect(created.statusCode).toBe(400);
    expect(created.json().code).toBe("PURCHASE_URL_INVALID");
  });

  it("allows admins to delete credit packages", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/credit-packages",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: "Temporary package",
        priceCents: 100,
        credits: 10,
        validDays: 1,
        enabled: true,
        sortOrder: 99
      }
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/admin/credit-packages/${created.json().id}`,
      headers: { authorization: `Bearer ${admin.token}` }
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/credit-packages",
      headers: { authorization: `Bearer ${admin.token}` }
    });

    expect(deleted.statusCode).toBe(204);
    expect(list.json()).toEqual([]);
  });

  it("creates a video job by deducting configured model credits", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-2.0",
        displayName: "Video DS 2.0",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/video",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const job = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "video-ds-2.0",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8
      }
    });

    expect(job.statusCode).toBe(201);
    expect(job.json().status).toBe("PENDING");
    expect(store.findUserById(user.user.id)!.creditBalance).toBe(120);
  });

  it("uses the supplier model id for generation instead of the editable display name", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-2.0-fast",
        displayName: "快速生成",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/videos",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 25,
        enabled: true
      }
    });

    const publicModels = await app.inject({ method: "GET", url: "/api/models" });
    const createdWithSupplierId = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "video-ds-2.0-fast",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8
      }
    });
    const createdWithDisplayName = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "快速生成",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8
      }
    });

    expect(publicModels.json()).toEqual([
      {
        modelName: "video-ds-2.0-fast",
        displayName: "快速生成",
        costCredits: 25
      }
    ]);
    expect(createdWithSupplierId.statusCode).toBe(201);
    expect(createdWithDisplayName.statusCode).toBe(404);
  });

  it("submits and enqueues user video jobs through the configured provider without syncing in the request", async () => {
    const store = new InMemoryStore();
    const providerCalls: Array<{
      method: string;
      url: string;
      model?: string;
      prompt?: string;
      seconds?: number;
      aspectRatio?: string;
      images?: string[];
      videos?: string[];
      audios?: string[];
    }> = [];
    const enqueuedJobIds: string[] = [];
    tmpRootDir = mkdtempSync(join(tmpdir(), "video-reference-route-"));
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      realVideoJobsEnabled: true,
      publicApiBaseUrl: "https://cdn.example.test",
      videoStorage: new VideoFileStorage({ rootDir: tmpRootDir, signingSecret: "test" }),
      referenceMediaFetch: async (url) => referenceProbeResponse(url),
      videoStatusSyncScheduler: {
        enqueueJobSync: async (jobId) => {
          enqueuedJobIds.push(jobId);
        }
      },
      videoProviderFactory: ({ baseUrl, apiKey }) =>
        new OpenAiVideoProvider({
          baseUrl,
          apiKey,
          fetch: async (url, init) => {
            if (init?.method === "POST") {
              const body = JSON.parse(String(init.body));
              providerCalls.push({
                method: "POST",
                url: String(url),
                model: body.model,
                prompt: body.prompt,
                seconds: body.seconds,
                aspectRatio: body.aspect_ratio,
                images: body.images,
                videos: body.videos,
                audios: body.audios
              });
              return jsonResponse({ id: "video_123", status: "processing" });
            }
            providerCalls.push({ method: init?.method ?? "GET", url: String(url) });
            return jsonResponse({
              id: "video_123",
              status: "succeeded",
              progress: 100
            });
          }
        })
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-2.0",
        displayName: "后台可编辑别名",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/videos",
        statusPath: "/v1/videos/{id}",
        resultPath: "/v1/videos/{id}/content",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "video-ds-2.0",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8,
        aspectRatio: "9:16",
        images: [
          `data:image/png;base64,${Buffer.from("image1").toString("base64")}`,
          `data:image/png;base64,${Buffer.from("image2").toString("base64")}`,
          `data:image/png;base64,${Buffer.from("image3").toString("base64")}`,
          `data:image/png;base64,${Buffer.from("image4").toString("base64")}`
        ],
        videos: [
          `data:video/mp4;base64,${Buffer.from("video1").toString("base64")}`,
          `data:video/mp4;base64,${Buffer.from("video2").toString("base64")}`,
          `data:video/mp4;base64,${Buffer.from("video3").toString("base64")}`
        ],
        audios: [`data:audio/mpeg;base64,${Buffer.from("audio1").toString("base64")}`]
      }
    });
    const synced = await app.inject({
      method: "POST",
      url: `/api/video/jobs/${created.json().id}/sync`,
      headers: { authorization: `Bearer ${user.token}` }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: "RUNNING", providerTaskId: "video_123" });
    expect(synced.statusCode).toBe(202);
    expect(synced.json()).toEqual({ queued: true, jobId: created.json().id });
    expect(providerCalls).toEqual([
      {
        method: "POST",
        url: "https://provider.example.com/v1/videos",
        model: "video-ds-2.0",
        prompt: "A cinematic skyline",
        seconds: 8,
        aspectRatio: "9:16",
        images: [
          `https://cdn.example.test/api/video/reference-assets/${created.json().id}/image-1.png`,
          `https://cdn.example.test/api/video/reference-assets/${created.json().id}/image-2.png`,
          `https://cdn.example.test/api/video/reference-assets/${created.json().id}/image-3.png`,
          `https://cdn.example.test/api/video/reference-assets/${created.json().id}/image-4.png`
        ],
        videos: [
          `https://cdn.example.test/api/video/reference-assets/${created.json().id}/video-1.mp4`,
          `https://cdn.example.test/api/video/reference-assets/${created.json().id}/video-2.mp4`,
          `https://cdn.example.test/api/video/reference-assets/${created.json().id}/video-3.mp4`
        ],
        audios: [`https://cdn.example.test/api/video/reference-assets/${created.json().id}/audio-1.mp3`]
      }
    ]);
    expect(enqueuedJobIds).toEqual([created.json().id, created.json().id]);
    expect(existsSync(join(tmpRootDir!, "references", created.json().id, "image-1.png"))).toBe(true);
  });

  it("fails uploaded provider references before supplier submission when the public URL returns 404", async () => {
    const store = new InMemoryStore();
    let providerCalled = false;
    tmpRootDir = mkdtempSync(join(tmpdir(), "video-reference-404-"));
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      realVideoJobsEnabled: true,
      publicApiBaseUrl: "https://cdn.example.test",
      videoStorage: new VideoFileStorage({ rootDir: tmpRootDir, signingSecret: "test" }),
      referenceMediaFetch: async () => new Response("", { status: 404 }),
      videoProviderFactory: ({ baseUrl, apiKey }) =>
        new OpenAiVideoProvider({
          baseUrl,
          apiKey,
          fetch: async () => {
            providerCalled = true;
            return jsonResponse({ id: "video_123", status: "processing" });
          }
        })
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-reference-404",
        displayName: "Video DS Reference 404",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/videos",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "video-ds-reference-404",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8,
        images: [`data:image/png;base64,${Buffer.from("image1").toString("base64")}`]
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: "FAILED",
      errorMessage: expect.stringContaining("Public API reference media URL is not reachable")
    });
    expect(created.json().errorMessage).toContain("HTTP 404");
    expect(providerCalled).toBe(false);
    expect(store.findUserById(user.user.id)!.creditBalance).toBe(200);
    expect(store.creditLedger.map((entry) => entry.type)).toEqual(["VIDEO_COST", "REFUND"]);
    expect(existsSync(join(tmpRootDir!, "references", created.json().id, "image-1.png"))).toBe(true);
  });

  it("uses the admin-configured public API base URL for uploaded provider references", async () => {
    const store = new InMemoryStore();
    const submittedImages: string[][] = [];
    tmpRootDir = mkdtempSync(join(tmpdir(), "video-reference-admin-url-"));
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      realVideoJobsEnabled: true,
      publicApiBaseUrl: "https://env.example.test",
      videoStorage: new VideoFileStorage({ rootDir: tmpRootDir, signingSecret: "test" }),
      referenceMediaFetch: async (url) => referenceProbeResponse(url),
      videoProviderFactory: ({ baseUrl, apiKey }) =>
        new OpenAiVideoProvider({
          baseUrl,
          apiKey,
          fetch: async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            submittedImages.push(body.images);
            return jsonResponse({ id: "video_123", status: "processing" });
          }
        })
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    await app.inject({
      method: "PATCH",
      url: "/api/admin/system-settings",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { publicApiBaseUrl: "https://admin-configured.example/" }
    });

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-admin-public-url",
        displayName: "Video DS Admin Public URL",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/videos",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "video-ds-admin-public-url",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8,
        images: [`data:image/png;base64,${Buffer.from("image1").toString("base64")}`]
      }
    });

    expect(created.statusCode).toBe(201);
    expect(submittedImages).toEqual([
      [`https://admin-configured.example/api/video/reference-assets/${created.json().id}/image-1.png`]
    ]);
  });

  it("rejects private fallback public API base URLs during uploaded reference submission", async () => {
    const store = new InMemoryStore();
    let providerCalled = false;
    tmpRootDir = mkdtempSync(join(tmpdir(), "video-reference-private-url-"));
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      realVideoJobsEnabled: true,
      publicApiBaseUrl: "http://localhost:4000",
      videoStorage: new VideoFileStorage({ rootDir: tmpRootDir, signingSecret: "test" }),
      videoProviderFactory: ({ baseUrl, apiKey }) =>
        new OpenAiVideoProvider({
          baseUrl,
          apiKey,
          fetch: async () => {
            providerCalled = true;
            return jsonResponse({ id: "video_123", status: "processing" });
          }
        })
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-private-public-url",
        displayName: "Video DS Private Public URL",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/videos",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "video-ds-private-public-url",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8,
        images: [`data:image/png;base64,${Buffer.from("image1").toString("base64")}`]
      }
    });

    expect(created.statusCode).toBe(400);
    expect(created.json()).toMatchObject({
      code: "PUBLIC_API_BASE_URL_INVALID"
    });
    expect(providerCalled).toBe(false);
    expect(store.findUserById(user.user.id)!.creditBalance).toBe(200);
  });

  it("accepts large base64 reference image payloads for user video jobs", async () => {
    const store = new InMemoryStore();
    const submittedImages: string[][] = [];
    tmpRootDir = mkdtempSync(join(tmpdir(), "video-reference-large-"));
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      realVideoJobsEnabled: true,
      publicApiBaseUrl: "https://cdn.example.test",
      videoStorage: new VideoFileStorage({ rootDir: tmpRootDir, signingSecret: "test" }),
      referenceMediaFetch: async (url) => referenceProbeResponse(url),
      videoProviderFactory: ({ baseUrl, apiKey }) =>
        new OpenAiVideoProvider({
          baseUrl,
          apiKey,
          fetch: async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            submittedImages.push(body.images);
            return jsonResponse({ id: "video_123", status: "processing" });
          }
        })
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-large-image",
        displayName: "Video DS Large Image",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/videos",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const largeImage = `data:image/png;base64,${"a".repeat(2 * 1024 * 1024)}`;
    const response = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: {
        authorization: `Bearer ${user.token}`,
        "content-type": "application/json"
      },
      payload: JSON.stringify({
        model: "video-ds-large-image",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8,
        images: [largeImage]
      })
    });

    expect(response.statusCode).toBe(201);
    expect(submittedImages).toEqual([[`https://cdn.example.test/api/video/reference-assets/${response.json().id}/image-1.png`]]);
    expect(existsSync(join(tmpRootDir!, "references", response.json().id, "image-1.png"))).toBe(true);
  });

  it("rejects oversized reference image data URLs before provider submission", async () => {
    const store = new InMemoryStore();
    let providerCalled = false;
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      realVideoJobsEnabled: true,
      videoProviderFactory: ({ baseUrl, apiKey }) =>
        new OpenAiVideoProvider({
          baseUrl,
          apiKey,
          fetch: async () => {
            providerCalled = true;
            return jsonResponse({ id: "video_123", status: "processing" });
          }
        })
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-oversized-image",
        displayName: "Video DS Oversized Image",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/videos",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const oversizedImage = `data:image/png;base64,${"a".repeat(3 * 1024 * 1024)}`;
    const response = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: {
        authorization: `Bearer ${user.token}`,
        "content-type": "application/json"
      },
      payload: JSON.stringify({
        model: "video-ds-oversized-image",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8,
        images: [oversizedImage]
      })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "REFERENCE_IMAGE_TOO_LARGE",
      message: "参考图片过大，请压缩图片后重试"
    });
    expect(providerCalled).toBe(false);
  });

  it("returns a structured error when the request body is too large", async () => {
    const app = await createApp({
      store: new InMemoryStore(),
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      bodyLimitBytes: 1024
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: {
        authorization: "Bearer invalid-token",
        "content-type": "application/json"
      },
      payload: JSON.stringify({ images: [`data:image/png;base64,${"a".repeat(2048)}`] })
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
      message: "上传素材过大，请压缩后重试或减少参考素材数量",
      statusCode: 413
    });
  });

  it("rejects more than one audio reference on user video job creation", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-audio-limit",
        displayName: "Video DS Audio Limit",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/videos",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "video-ds-audio-limit",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8,
        audios: ["data:audio/mpeg;base64,audio1", "data:audio/mpeg;base64,audio2"]
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("processes a video job through the local mock provider route", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-2.0",
        displayName: "Video DS 2.0",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/video",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "video-ds-2.0",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline",
        resolution: "720P",
        durationSeconds: 8
      }
    });

    const processed = await app.inject({
      method: "POST",
      url: `/api/video/jobs/${created.json().id}/process`,
      headers: { authorization: `Bearer ${user.token}` },
      payload: { outcome: "SUCCEEDED" }
    });

    expect(processed.statusCode).toBe(200);
    expect(processed.json().status).toBe("SUCCEEDED");
    expect(processed.json().providerTaskId).toMatch(/^mock-task-/);
    expect(store.videoAssets).toHaveLength(1);
    expect(store.videoAssets[0].jobId).toBe(created.json().id);
  });

  it("returns lightweight user video generation records without video links", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-records",
        displayName: "Video DS Records",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/video",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "video-ds-records",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "A cinematic skyline with a glass tower",
        resolution: "720P",
        aspectRatio: "16:9",
        durationSeconds: 8,
        images: ["data:image/png;base64,abc", "data:image/png;base64,def"],
        videos: ["data:video/mp4;base64,video"],
        audios: ["data:audio/mpeg;base64,audio"]
      }
    });

    await app.inject({
      method: "POST",
      url: `/api/video/jobs/${created.json().id}/process`,
      headers: { authorization: `Bearer ${user.token}` },
      payload: { outcome: "SUCCEEDED" }
    });

    const records = await app.inject({
      method: "GET",
      url: "/api/video/job-records",
      headers: { authorization: `Bearer ${user.token}` }
    });

    expect(records.statusCode).toBe(200);
    expect(records.json()).toEqual([
      {
        id: created.json().id,
        createdAt: expect.any(String),
        generatedAt: expect.any(String),
        modelName: "Video DS Records",
        modelProviderName: "video-ds-records",
        prompt: "A cinematic skyline with a glass tower",
        resolution: "720P",
        aspectRatio: "16:9",
        size: "16:9",
        durationSeconds: 8,
        imageCount: 2,
        videoCount: 1,
        audioCount: 1,
        costCredits: 80,
        status: "SUCCEEDED",
        generationDurationSeconds: expect.any(Number)
      }
    ]);
    expect(records.json()[0].generationDurationSeconds).toBeGreaterThanOrEqual(0);
    expect(records.json()[0]).not.toHaveProperty("completedAt");
    expect(JSON.stringify(records.json())).not.toContain("providerTaskId");
    expect(JSON.stringify(records.json())).not.toContain("downloadUrl");
    expect(JSON.stringify(records.json())).not.toContain("storageKey");
  });

  it("returns admin video jobs with readable model, prompt, media counts, and generation duration", async () => {
    const store = new InMemoryStore();
    const app = await createApp({ store, jwtSecret: "test", redemptionHashSecret: "hash" });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const admin = await auth.register({ email: "admin@example.com", password: "password123", role: "ADMIN" });
    const user = await auth.register({ email: "creator@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 200;

    await app.inject({
      method: "POST",
      url: "/api/admin/model-configs",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        modelName: "video-ds-admin-records",
        displayName: "后台展示模型",
        providerBaseUrl: "https://provider.example.com",
        submitPath: "/v1/video",
        authType: "BEARER",
        apiKey: "sk-test-secret",
        costCredits: 80,
        enabled: true
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/video/jobs",
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        model: "video-ds-admin-records",
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "Admin can inspect this prompt",
        resolution: "1080P",
        aspectRatio: "9:16",
        durationSeconds: 9,
        images: ["data:image/png;base64,abc"]
      }
    });

    await app.inject({
      method: "POST",
      url: `/api/video/jobs/${created.json().id}/process`,
      headers: { authorization: `Bearer ${user.token}` },
      payload: { outcome: "SUCCEEDED" }
    });

    const jobs = await app.inject({
      method: "GET",
      url: "/api/admin/video-jobs",
      headers: { authorization: `Bearer ${admin.token}` }
    });

    expect(jobs.statusCode).toBe(200);
    expect(jobs.json()[0]).toMatchObject({
      id: created.json().id,
      userId: user.user.id,
      userEmail: "creator@example.com",
      modelName: "后台展示模型",
      modelProviderName: "video-ds-admin-records",
      prompt: "Admin can inspect this prompt",
      resolution: "1080P",
      aspectRatio: "9:16",
      size: "9:16",
      durationSeconds: 9,
      imageCount: 1,
      videoCount: 0,
      audioCount: 0,
      status: "SUCCEEDED",
      generationDurationSeconds: expect.any(Number)
    });
    expect(jobs.json()[0].modelName).not.toBe(jobs.json()[0].modelConfigId);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function referenceProbeResponse(url: string | URL | Request): Response {
  const value = String(url);
  const contentType = value.includes("/video-")
    ? "video/mp4"
    : value.includes("/audio-")
      ? "audio/mpeg"
      : "image/png";
  return new Response("", {
    status: 200,
    headers: { "content-type": contentType }
  });
}
