import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../repositories/memory-store.js";
import { AuthService } from "../services/auth.service.js";
import { createId, encryptSecret } from "../services/crypto.service.js";
import { parseRedisConnectionOptions, VideoStatusSynchronizer } from "../services/video-status-sync.service.js";
import { VideoService, type VideoProviderClient } from "../services/video.service.js";

describe("VideoStatusSynchronizer", () => {
  it("parses Redis URLs for BullMQ connections", () => {
    expect(parseRedisConnectionOptions("redis://redis:6379/2")).toMatchObject({
      host: "redis",
      port: 6379,
      db: 2,
      maxRetriesPerRequest: null
    });
  });

  it("syncs only active provider-backed jobs and ignores mock or completed jobs", async () => {
    const store = new InMemoryStore();
    const auth = new AuthService(store, { jwtSecret: "test" });
    const user = await auth.register({ email: "user@example.com", password: "password123" });
    store.findUserById(user.user.id)!.creditBalance = 400;
    store.modelConfigs.push({
      id: createId(),
      modelName: "video-ds-2.0",
      displayName: "Video DS 2.0",
      providerBaseUrl: "https://provider.example.com",
      submitPath: "/v1/videos",
      authType: "BEARER",
      apiKeyCiphertext: encryptSecret("sk-test", Buffer.alloc(32, 1)),
      apiKeyLast4: "test",
      costCredits: 80,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const statusCalls: string[] = [];
    const provider: VideoProviderClient = {
      submitVideo: async () => ({ providerTaskId: "video_active", status: "RUNNING" }),
      getVideoStatus: async (providerTaskId) => {
        statusCalls.push(providerTaskId);
        return { providerTaskId, status: "SUCCEEDED" };
      }
    };
    const video = new VideoService(store, { providerFactory: () => provider });
    const activeProviderJob = await video.createJob({
      userId: user.user.id,
      model: "video-ds-2.0",
      mode: "TEXT_IMAGE_TO_VIDEO",
      prompt: "Active provider job",
      resolution: "720P",
      durationSeconds: 8
    });
    store.videoJobs.push(
      {
        ...activeProviderJob,
        id: createId(),
        status: "RUNNING",
        providerTaskId: `mock-task-${createId()}`,
        createdAt: new Date()
      },
      {
        ...activeProviderJob,
        id: createId(),
        status: "SUCCEEDED",
        providerTaskId: "video_done",
        completedAt: new Date(),
        createdAt: new Date()
      },
      {
        ...activeProviderJob,
        id: createId(),
        status: "RUNNING",
        providerTaskId: undefined,
        createdAt: new Date()
      }
    );

    const result = await new VideoStatusSynchronizer(store, video).syncActiveProviderJobs();

    expect(result).toEqual({
      scanned: 1,
      succeeded: 1,
      failed: 0,
      errors: []
    });
    expect(statusCalls).toEqual(["video_active"]);
    expect(store.videoJobs.find((job) => job.id === activeProviderJob.id)?.status).toBe("SUCCEEDED");
    expect(store.videoAssets).toHaveLength(1);
  });
});
