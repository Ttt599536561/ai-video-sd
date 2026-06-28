import { describe, expect, it, vi } from "vitest";
import { InMemoryStore } from "../repositories/memory-store.js";
import { AuthService } from "../services/auth.service.js";
import { createId, encryptSecret } from "../services/crypto.service.js";
import {
  VideoService,
  type VideoOutputStorage,
  type VideoProviderClient,
  type VideoProviderFactory
} from "../services/video.service.js";

describe("VideoService job processing", () => {
  it("processes a mock successful job and writes an output asset", async () => {
    const { store, video, userId } = await createVideoFixture();
    const job = await video.createJob({
      userId,
      model: "video-ds-2.0",
      mode: "TEXT_IMAGE_TO_VIDEO",
      prompt: "A small film scene",
      resolution: "720P",
      durationSeconds: 8
    });

    const processed = await video.processJob(job.id, { outcome: "SUCCEEDED" });

    expect(processed.status).toBe("SUCCEEDED");
    expect(processed.providerTaskId).toMatch(/^mock-task-/);
    expect(processed.completedAt).toBeInstanceOf(Date);
    expect(store.videoAssets).toHaveLength(1);
    expect(store.videoAssets[0]).toMatchObject({
      jobId: job.id,
      type: "OUTPUT_VIDEO",
      mimeType: "video/mp4"
    });
    expect(store.videoAssets[0].storageKey).toContain(job.id);
    expect(store.findUserById(userId)?.creditBalance).toBe(120);
  });

  it("refunds credits once when mock processing fails", async () => {
    const { store, video, userId } = await createVideoFixture();
    const job = await video.createJob({
      userId,
      model: "video-ds-2.0",
      mode: "TEXT_IMAGE_TO_VIDEO",
      prompt: "A failed scene",
      resolution: "720P",
      durationSeconds: 8
    });

    const failed = await video.processJob(job.id, { outcome: "FAILED", errorMessage: "mock provider failed" });
    const failedAgain = video.failJob(job.id, "mock provider failed again");

    expect(failed.status).toBe("FAILED");
    expect(failed.errorMessage).toBe("mock provider failed");
    expect(failedAgain.status).toBe("FAILED");
    expect(store.findUserById(userId)?.creditBalance).toBe(200);
    expect(store.creditLedger.filter((entry) => entry.type === "REFUND" && entry.refId === job.id)).toHaveLength(1);
  });

  it("submits new jobs to a real provider with the supplier model id", async () => {
    let submitted: unknown;
    const provider: VideoProviderClient = {
      submitVideo: async (input) => {
        submitted = input;
        return { providerTaskId: "video_123", status: "RUNNING" };
      },
      getVideoStatus: async () => ({ providerTaskId: "video_123", status: "RUNNING" })
    };
    const { store, video, userId } = await createVideoFixture({ providerFactory: () => provider });

    const job = await video.createJob({
      userId,
      model: "video-ds-2.0",
      mode: "TEXT_IMAGE_TO_VIDEO",
      prompt: "A real provider scene",
      resolution: "720P",
      durationSeconds: 8
    });

    expect(submitted).toEqual({
      model: "video-ds-2.0",
      prompt: "A real provider scene",
      seconds: 8,
      aspectRatio: "16:9",
      images: undefined,
      videos: undefined,
      audios: undefined
    });
    expect(job.status).toBe("RUNNING");
    expect(job.providerTaskId).toBe("video_123");
    expect(store.findUserById(userId)?.creditBalance).toBe(120);
  });

  it("syncs a succeeded provider job and writes one output asset", async () => {
    let statusCalls = 0;
    const provider: VideoProviderClient = {
      submitVideo: async () => ({ providerTaskId: "video_123", status: "RUNNING" }),
      getVideoStatus: async () => {
        statusCalls += 1;
        return {
          providerTaskId: "video_123",
          status: "SUCCEEDED",
          contentPath: "/v1/videos/video_123/content"
        };
      }
    };
    const { store, video, userId } = await createVideoFixture({ providerFactory: () => provider });
    const job = await video.createJob({
      userId,
      model: "video-ds-2.0",
      mode: "TEXT_IMAGE_TO_VIDEO",
      prompt: "A successful provider scene",
      resolution: "720P",
      durationSeconds: 8
    });

    const synced = await video.syncJob(job.id);
    const syncedAgain = await video.syncJob(job.id);

    expect(synced.status).toBe("SUCCEEDED");
    expect(syncedAgain.status).toBe("SUCCEEDED");
    expect(statusCalls).toBe(1);
    expect(store.videoAssets).toHaveLength(1);
    expect(store.videoAssets[0]).toMatchObject({
      jobId: job.id,
      type: "OUTPUT_VIDEO",
      storageKey: "provider-content/video_123.mp4",
      mimeType: "video/mp4"
    });
    expect(store.videoAssets[0].expiresAt?.getTime()).toBeGreaterThan(Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(store.findUserById(userId)?.creditBalance).toBe(120);
  });

  it("downloads and stores provider content when a provider job succeeds", async () => {
    const provider: VideoProviderClient = {
      submitVideo: async () => ({ providerTaskId: "video_123", status: "RUNNING" }),
      getVideoStatus: async () => ({
        providerTaskId: "video_123",
        status: "SUCCEEDED",
        contentPath: "/v1/videos/video_123/content"
      }),
      downloadVideoContent: vi.fn(async () => ({
        content: new Uint8Array([1, 2, 3]),
        mimeType: "video/mp4"
      }))
    };
    const outputStorage: VideoOutputStorage = {
      saveOutputVideo: vi.fn(async (_job, input) => ({
        storageKey: "outputs/stored-video.mp4",
        mimeType: input.mimeType,
        sizeBytes: input.content.byteLength
      }))
    };
    const { store, video, userId } = await createVideoFixture({
      providerFactory: () => provider,
      outputStorage
    });
    const job = await video.createJob({
      userId,
      model: "video-ds-2.0",
      mode: "TEXT_IMAGE_TO_VIDEO",
      prompt: "A stored provider scene",
      resolution: "720P",
      durationSeconds: 8
    });

    const synced = await video.syncJob(job.id);

    expect(synced.status).toBe("SUCCEEDED");
    expect(provider.downloadVideoContent).toHaveBeenCalledWith("video_123");
    expect(outputStorage.saveOutputVideo).toHaveBeenCalled();
    expect(store.videoAssets).toHaveLength(1);
    expect(store.videoAssets[0]).toMatchObject({
      storageKey: "outputs/stored-video.mp4",
      mimeType: "video/mp4",
      sizeBytes: 3
    });
  });

  it("syncs a failed provider job and refunds credits once", async () => {
    const provider: VideoProviderClient = {
      submitVideo: async () => ({ providerTaskId: "video_123", status: "RUNNING" }),
      getVideoStatus: async () => ({
        providerTaskId: "video_123",
        status: "FAILED",
        errorMessage: "provider rejected the prompt"
      })
    };
    const { store, video, userId } = await createVideoFixture({ providerFactory: () => provider });
    const job = await video.createJob({
      userId,
      model: "video-ds-2.0",
      mode: "TEXT_IMAGE_TO_VIDEO",
      prompt: "A failed provider scene",
      resolution: "720P",
      durationSeconds: 8
    });

    const failed = await video.syncJob(job.id);
    const failedAgain = await video.failJob(job.id, "provider rejected the prompt again");

    expect(failed.status).toBe("FAILED");
    expect(failed.errorMessage).toBe("provider rejected the prompt");
    expect(failedAgain.status).toBe("FAILED");
    expect(store.findUserById(userId)?.creditBalance).toBe(200);
    expect(store.creditLedger.filter((entry) => entry.type === "REFUND" && entry.refId === job.id)).toHaveLength(1);
  });
});

async function createVideoFixture(
  options: { providerFactory?: VideoProviderFactory; outputStorage?: VideoOutputStorage } = {}
) {
  const store = new InMemoryStore();
  const auth = new AuthService(store, { jwtSecret: "test" });
  const user = await auth.register({ email: "user@example.com", password: "password123" });
  const dbUser = store.findUserById(user.user.id)!;
  dbUser.creditBalance = 200;
  store.modelConfigs.push({
    id: createId(),
    modelName: "video-ds-2.0",
    displayName: "Video DS 2.0",
    providerBaseUrl: "https://provider.example.com",
    submitPath: "/v1/video",
    authType: "BEARER",
    apiKeyCiphertext: encryptSecret("sk-test", Buffer.alloc(32, 1)),
    apiKeyLast4: "test",
    costCredits: 80,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return {
    store,
    video: new VideoService(store, { providerFactory: options.providerFactory, outputStorage: options.outputStorage }),
    userId: user.user.id
  };
}
