import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { InMemoryStore } from "../repositories/memory-store.js";
import { AuthService } from "../services/auth.service.js";
import { createId } from "../services/crypto.service.js";
import { VideoFileStorage } from "../services/video-file-storage.js";

describe("video asset routes", () => {
  let rootDir: string | undefined;

  afterEach(() => {
    if (rootDir) {
      rmSync(rootDir, { recursive: true, force: true });
      rootDir = undefined;
    }
  });

  it("returns signed download URLs that serve stored video content", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "video-assets-route-"));
    const store = new InMemoryStore();
    const storage = new VideoFileStorage({ rootDir, signingSecret: "test" });
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash",
      videoStorage: storage
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    const stored = await storage.saveOutputVideo(
      { id: "job-1" },
      { content: new TextEncoder().encode("ABC"), mimeType: "video/mp4" }
    );
    store.videoJobs.push({
      id: "job-1",
      userId: user.user.id,
      modelConfigId: createId(),
      mode: "TEXT_IMAGE_TO_VIDEO",
      prompt: "Stored output",
      resolution: "720P",
      durationSeconds: 8,
      costCredits: 80,
      status: "SUCCEEDED",
      providerTaskId: "video_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      completedAt: new Date("2026-01-01T00:05:00.000Z")
    });
    store.videoAssets.push({
      id: "asset-1",
      jobId: "job-1",
      type: "OUTPUT_VIDEO",
      storageKey: stored.storageKey,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date()
    });

    const signed = await app.inject({
      method: "GET",
      url: "/api/video/assets/asset-1/download-url",
      headers: { authorization: `Bearer ${user.token}` }
    });
    const signedByJob = await app.inject({
      method: "GET",
      url: "/api/video/jobs/job-1/download-url",
      headers: { authorization: `Bearer ${user.token}` }
    });
    const downloaded = await app.inject({
      method: "GET",
      url: signed.json().downloadUrl
    });
    const partial = await app.inject({
      method: "GET",
      url: signed.json().downloadUrl,
      headers: { range: "bytes=1-2" }
    });

    expect(signed.statusCode).toBe(200);
    expect(signed.json().downloadUrl).toContain("/api/video/assets/asset-1/download?");
    expect(signedByJob.statusCode).toBe(200);
    expect(signedByJob.json().downloadUrl).toContain("/api/video/assets/asset-1/download?");
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers["content-type"]).toContain("video/mp4");
    expect(downloaded.headers["content-disposition"]).toBe('attachment; filename="asset-1.mp4"');
    expect(downloaded.headers["accept-ranges"]).toBe("bytes");
    expect(downloaded.body).toBe("ABC");
    expect(partial.statusCode).toBe(206);
    expect(partial.headers["content-range"]).toBe("bytes 1-2/3");
    expect(partial.body).toBe("BC");
  });

  it("deletes project video assets without deleting their generation tasks", async () => {
    const store = new InMemoryStore();
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash"
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.videoJobs.push({
      id: "job-1",
      userId: user.user.id,
      modelConfigId: createId(),
      mode: "TEXT_IMAGE_TO_VIDEO",
      prompt: "Stored output",
      resolution: "720P",
      durationSeconds: 8,
      costCredits: 80,
      status: "SUCCEEDED",
      providerTaskId: "video_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      completedAt: new Date("2026-01-01T00:05:00.000Z")
    });
    store.videoAssets.push({
      id: "asset-1",
      jobId: "job-1",
      type: "OUTPUT_VIDEO",
      storageKey: "outputs/job-1.mp4",
      mimeType: "video/mp4",
      sizeBytes: 123,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date("2026-01-01T00:06:00.000Z")
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/video/assets",
      headers: { authorization: `Bearer ${user.token}` }
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/video/assets/asset-1",
      headers: { authorization: `Bearer ${user.token}` }
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([
      expect.objectContaining({
        id: "asset-1",
        jobId: "job-1",
        prompt: "Stored output",
        status: "SUCCEEDED",
        mimeType: "video/mp4"
      })
    ]);
    expect(deleted.statusCode).toBe(204);
    expect(store.videoJobs).toHaveLength(1);
    expect(store.videoJobs[0].id).toBe("job-1");
    expect(store.videoAssets).toHaveLength(0);
  });

  it("lists only the current user's project video assets", async () => {
    const store = new InMemoryStore();
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash"
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const owner = await auth.register({ email: "owner@example.com", password: "password123" });
    const other = await auth.register({ email: "other@example.com", password: "password123" });
    store.videoJobs.push(
      {
        id: "owner-job",
        userId: owner.user.id,
        modelConfigId: createId(),
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "Owner output",
        resolution: "720P",
        durationSeconds: 8,
        costCredits: 80,
        status: "SUCCEEDED",
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        id: "other-job",
        userId: other.user.id,
        modelConfigId: createId(),
        mode: "TEXT_IMAGE_TO_VIDEO",
        prompt: "Other output",
        resolution: "720P",
        durationSeconds: 8,
        costCredits: 80,
        status: "SUCCEEDED",
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      }
    );
    store.videoAssets.push(
      {
        id: "owner-asset",
        jobId: "owner-job",
        type: "OUTPUT_VIDEO",
        storageKey: "outputs/owner.mp4",
        mimeType: "video/mp4",
        sizeBytes: 123,
        createdAt: new Date("2026-01-01T00:06:00.000Z")
      },
      {
        id: "other-asset",
        jobId: "other-job",
        type: "OUTPUT_VIDEO",
        storageKey: "outputs/other.mp4",
        mimeType: "video/mp4",
        sizeBytes: 456,
        createdAt: new Date("2026-01-01T00:07:00.000Z")
      }
    );

    const listed = await app.inject({
      method: "GET",
      url: "/api/video/assets",
      headers: { authorization: `Bearer ${owner.token}` }
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({ id: "owner-asset", jobId: "owner-job", prompt: "Owner output" });
  });

  it("does not allow users to delete generation task records", async () => {
    const store = new InMemoryStore();
    const app = await createApp({
      store,
      jwtSecret: "test",
      redemptionHashSecret: "hash"
    });
    const auth = new AuthService(store, { jwtSecret: "test" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.videoJobs.push({
      id: "job-1",
      userId: user.user.id,
      modelConfigId: createId(),
      mode: "TEXT_IMAGE_TO_VIDEO",
      prompt: "Task record",
      resolution: "720P",
      durationSeconds: 8,
      costCredits: 80,
      status: "SUCCEEDED",
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/video/jobs/job-1",
      headers: { authorization: `Bearer ${user.token}` }
    });

    expect(deleted.statusCode).toBe(405);
    expect(store.videoJobs).toHaveLength(1);
    expect(store.videoJobs[0].id).toBe("job-1");
  });
});
