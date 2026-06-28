import type { ModelConfig, VideoAsset, VideoJob, VideoJobStatus, VideoMode } from "../domain/types.js";
import type { InMemoryStore } from "../repositories/memory-store.js";
import { createId } from "./crypto.service.js";
import type { StoredOutputVideo, VideoContent } from "./video-file-storage.js";
import { MockVideoProvider, type MockVideoProcessOptions } from "./mock-video-provider.js";

interface CreateVideoJobInput {
  userId: string;
  model: string;
  mode: VideoMode;
  prompt: string;
  resolution: "480P" | "720P" | "1080P";
  aspectRatio?: "9:16" | "16:9" | "1:1";
  durationSeconds: number;
  images?: string[];
  videos?: string[];
  audios?: string[];
  referencePublicBaseUrl?: string;
}

export interface VideoProviderClient {
  submitVideo(input: {
    model: string;
    prompt: string;
    seconds: number;
    aspectRatio?: string;
    images?: string[];
    videos?: string[];
    audios?: string[];
  }): Promise<{
    providerTaskId: string;
    status: VideoJobStatus;
  }>;
  getVideoStatus(providerTaskId: string): Promise<{
    providerTaskId: string;
    status: VideoJobStatus;
    contentPath?: string;
    errorMessage?: string;
  }>;
  downloadVideoContent?(providerTaskId: string): Promise<VideoContent>;
}

export type VideoProviderFactory = (model: ModelConfig) => VideoProviderClient;

export interface VideoOutputStorage {
  saveOutputVideo(job: VideoJob, input: VideoContent): Promise<StoredOutputVideo>;
}

export interface VideoReferenceMediaResolver {
  resolve(
    job: VideoJob,
    input: { images?: string[]; videos?: string[]; audios?: string[] },
    context: { publicBaseUrl?: string }
  ): Promise<{
    images?: string[];
    videos?: string[];
    audios?: string[];
  }>;
}

interface VideoServiceOptions {
  mockProvider?: MockVideoProvider;
  providerFactory?: VideoProviderFactory;
  outputStorage?: VideoOutputStorage;
  referenceMediaResolver?: VideoReferenceMediaResolver;
}

interface OutputAssetInput {
  storageKey: string;
  mimeType?: string;
  sizeBytes?: number;
}

export class VideoService {
  private readonly mockProvider: MockVideoProvider;
  private readonly providerFactory?: VideoProviderFactory;
  private readonly outputStorage?: VideoOutputStorage;
  private readonly referenceMediaResolver?: VideoReferenceMediaResolver;

  constructor(
    private readonly store: InMemoryStore,
    options: VideoServiceOptions = {}
  ) {
    this.mockProvider = options.mockProvider ?? new MockVideoProvider();
    this.providerFactory = options.providerFactory;
    this.outputStorage = options.outputStorage;
    this.referenceMediaResolver = options.referenceMediaResolver;
  }

  async createJob(input: CreateVideoJobInput): Promise<VideoJob> {
    const { job, model } = this.createPendingJob(input);
    if (!this.providerFactory) return job;

    try {
      const provider = this.providerFactory(model);
      const references = this.referenceMediaResolver
        ? await this.referenceMediaResolver.resolve(
            job,
            {
              images: input.images,
              videos: input.videos,
              audios: input.audios
            },
            {
              publicBaseUrl: input.referencePublicBaseUrl
            }
          )
        : {
            images: input.images,
            videos: input.videos,
            audios: input.audios
          };
      const submission = await provider.submitVideo({
        model: model.modelName,
        prompt: input.prompt,
        seconds: input.durationSeconds,
        aspectRatio: input.aspectRatio ?? aspectRatioForResolution(input.resolution),
        images: references.images,
        videos: references.videos,
        audios: references.audios
      });
      return this.applyProviderStatus(job, submission, provider);
    } catch (error) {
      return this.failJob(job.id, providerErrorMessage(error, "Video provider submission failed"), {
        assignMockTaskId: false
      });
    }
  }

  private createPendingJob(input: CreateVideoJobInput): { job: VideoJob; model: ModelConfig } {
    const user = this.store.findUserById(input.userId);
    if (!user) throw new Error("User not found");
    if (user.status === "BANNED") throw new Error("User is banned");
    if (input.durationSeconds < 5 || input.durationSeconds > 15) {
      throw new Error("Duration must be between 5 and 15 seconds");
    }
    const model = this.store.modelConfigs.find((item) => item.modelName === input.model && item.enabled);
    if (!model) throw new Error("Model not found");
    if (user.creditBalance < model.costCredits) {
      throw new Error("Insufficient credits");
    }

    const now = new Date();
    user.creditBalance -= model.costCredits;
    user.updatedAt = now;
    this.store.creditLedger.push({
      id: createId(),
      userId: user.id,
      type: "VIDEO_COST",
      amount: -model.costCredits,
      balanceAfter: user.creditBalance,
      refType: "video_model",
      refId: model.id,
      idempotencyKey: `video:${createId()}`,
      createdAt: now
    });
    const job: VideoJob = {
      id: createId(),
      userId: user.id,
      modelConfigId: model.id,
      mode: input.mode,
      prompt: input.prompt,
      resolution: input.resolution,
      aspectRatio: input.aspectRatio ?? aspectRatioForResolution(input.resolution),
      durationSeconds: input.durationSeconds,
      imageCount: input.images?.length ?? 0,
      videoCount: input.videos?.length ?? 0,
      audioCount: input.audios?.length ?? 0,
      costCredits: model.costCredits,
      status: "PENDING",
      createdAt: now
    };
    this.store.videoJobs.push(job);
    return { job, model };
  }

  listJobs(userId?: string): VideoJob[] {
    return this.store.videoJobs
      .filter((job) => !userId || job.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getJob(jobId: string, userId?: string): VideoJob {
    const job = this.store.videoJobs.find((item) => item.id === jobId && (!userId || item.userId === userId));
    if (!job) throw new Error("Video job not found");
    return job;
  }

  async processJob(jobId: string, options: MockVideoProcessOptions = {}): Promise<VideoJob> {
    const job = this.startJob(jobId);
    if ((options.outcome ?? "SUCCEEDED") === "FAILED") {
      return this.failJob(job.id, options.errorMessage ?? "Mock video provider failed");
    }
    return this.succeedJob(job.id);
  }

  async syncJob(jobId: string): Promise<VideoJob> {
    const job = this.getJob(jobId);
    if (job.status === "SUCCEEDED" || job.status === "FAILED") return job;
    if (!this.providerFactory) throw new Error("Video provider is not configured");
    if (!job.providerTaskId) throw new Error("Provider task id is missing");

    const model = this.modelForJob(job);
    const provider = this.providerFactory(model);
    const providerStatus = await provider.getVideoStatus(job.providerTaskId);
    return this.applyProviderStatus(job, providerStatus, provider);
  }

  startJob(jobId: string): VideoJob {
    const job = this.getJob(jobId);
    if (job.status === "SUCCEEDED" || job.status === "FAILED") return job;
    job.status = "RUNNING";
    job.providerTaskId ??= this.mockProvider.submit(job);
    return job;
  }

  succeedJob(jobId: string, outputAsset?: OutputAssetInput): VideoJob {
    const job = this.getJob(jobId);
    if (job.status === "FAILED") throw new Error("Cannot succeed a failed video job");
    const now = new Date();
    job.status = "SUCCEEDED";
    job.completedAt ??= now;
    job.providerTaskId ??= this.mockProvider.submit(job);
    if (!this.store.videoAssets.some((asset) => asset.jobId === job.id && asset.type === "OUTPUT_VIDEO")) {
      this.store.videoAssets.push(outputAsset ? createOutputAsset(job, outputAsset, now) : this.mockProvider.createOutputAsset(job, now));
    }
    return job;
  }

  failJob(jobId: string, errorMessage: string, options: { assignMockTaskId?: boolean } = {}): VideoJob {
    const job = this.getJob(jobId);
    if (job.status === "SUCCEEDED") throw new Error("Cannot fail a succeeded video job");
    const now = new Date();
    job.status = "FAILED";
    job.errorMessage ??= errorMessage;
    job.completedAt ??= now;
    if (options.assignMockTaskId ?? true) {
      job.providerTaskId ??= this.mockProvider.submit(job);
    }

    const refundKey = `refund:${job.id}`;
    if (!this.store.creditLedger.some((entry) => entry.idempotencyKey === refundKey)) {
      const user = this.store.findUserById(job.userId);
      if (!user) throw new Error("User not found");
      user.creditBalance += job.costCredits;
      user.updatedAt = now;
      this.store.creditLedger.push({
        id: createId(),
        userId: user.id,
        type: "REFUND",
        amount: job.costCredits,
        balanceAfter: user.creditBalance,
        refType: "video_job",
        refId: job.id,
        idempotencyKey: refundKey,
        createdAt: now
      });
    }
    return job;
  }

  deleteJob(jobId: string, userId?: string): void {
    this.getJob(jobId, userId);
    this.store.videoJobs = this.store.videoJobs.filter((job) => job.id !== jobId);
  }

  private async applyProviderStatus(
    job: VideoJob,
    providerStatus: { providerTaskId: string; status: VideoJobStatus; errorMessage?: string },
    provider?: VideoProviderClient
  ): Promise<VideoJob> {
    job.providerTaskId = providerStatus.providerTaskId;
    if (providerStatus.status === "SUCCEEDED") {
      if (this.outputStorage && provider?.downloadVideoContent) {
        const content = await provider.downloadVideoContent(providerStatus.providerTaskId);
        return this.succeedJob(job.id, await this.outputStorage.saveOutputVideo(job, content));
      }
      return this.succeedJob(job.id, {
        storageKey: `provider-content/${providerStatus.providerTaskId}.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 0
      });
    }
    if (providerStatus.status === "FAILED") {
      return this.failJob(job.id, providerStatus.errorMessage ?? "Video provider failed", {
        assignMockTaskId: false
      });
    }
    job.status = "RUNNING";
    return job;
  }

  private modelForJob(job: VideoJob): ModelConfig {
    const model = this.store.modelConfigs.find((item) => item.id === job.modelConfigId);
    if (!model) throw new Error("Model not found");
    return model;
  }
}

function aspectRatioForResolution(resolution: CreateVideoJobInput["resolution"]): "16:9" {
  const ratios = {
    "480P": "16:9",
    "720P": "16:9",
    "1080P": "16:9"
  };
  return ratios[resolution] as "16:9";
}

function createOutputAsset(job: VideoJob, input: OutputAssetInput, now: Date): VideoAsset {
  return {
    id: createId(),
    jobId: job.id,
    type: "OUTPUT_VIDEO",
    storageKey: input.storageKey,
    mimeType: input.mimeType ?? "video/mp4",
    sizeBytes: input.sizeBytes ?? 0,
    expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    createdAt: now
  };
}

function providerErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
