import { Queue, Worker, type JobsOptions } from "bullmq";
import type { RedisOptions } from "ioredis";
import type { InMemoryStore } from "../repositories/memory-store.js";
import { isPersistentStore } from "../repositories/prisma-store.js";
import type { VideoService } from "./video.service.js";

export interface VideoStatusSyncResult {
  scanned: number;
  succeeded: number;
  failed: number;
  errors: Array<{ jobId: string; message: string }>;
}

export interface VideoStatusSyncScheduler {
  enqueueJobSync(jobId: string): Promise<void>;
}

type VideoStatusSyncJob =
  | { kind: "scan" }
  | {
      kind: "job";
      jobId: string;
    };

export class VideoStatusSynchronizer {
  constructor(
    private readonly store: InMemoryStore,
    private readonly video: VideoService
  ) {}

  async syncActiveProviderJobs(): Promise<VideoStatusSyncResult> {
    const activeJobs = this.store.videoJobs.filter(
      (job) => ["PENDING", "RUNNING"].includes(job.status) && isProviderBackedTaskId(job.providerTaskId)
    );
    const result: VideoStatusSyncResult = {
      scanned: activeJobs.length,
      succeeded: 0,
      failed: 0,
      errors: []
    };

    for (const job of activeJobs) {
      try {
        const synced = await this.video.syncJob(job.id);
        if (synced.status === "SUCCEEDED") result.succeeded += 1;
        if (synced.status === "FAILED") result.failed += 1;
      } catch (error) {
        result.errors.push({
          jobId: job.id,
          message: errorMessage(error)
        });
      }
    }

    await flushStoreIfPersistent(this.store);
    return result;
  }

  async syncProviderJob(jobId: string): Promise<VideoStatusSyncResult> {
    const job = this.store.videoJobs.find((item) => item.id === jobId);
    if (!job || !["PENDING", "RUNNING"].includes(job.status) || !isProviderBackedTaskId(job.providerTaskId)) {
      return { scanned: 0, succeeded: 0, failed: 0, errors: [] };
    }

    const result: VideoStatusSyncResult = {
      scanned: 1,
      succeeded: 0,
      failed: 0,
      errors: []
    };

    try {
      const synced = await this.video.syncJob(job.id);
      if (synced.status === "SUCCEEDED") result.succeeded = 1;
      if (synced.status === "FAILED") result.failed = 1;
    } catch (error) {
      result.errors.push({ jobId: job.id, message: errorMessage(error) });
    }

    await flushStoreIfPersistent(this.store);
    return result;
  }
}

export interface BullMqVideoStatusSyncSchedulerOptions {
  redisUrl: string;
  synchronizer: VideoStatusSynchronizer;
  scanIntervalMs?: number;
}

export class BullMqVideoStatusSyncScheduler implements VideoStatusSyncScheduler {
  private readonly queue: Queue<VideoStatusSyncJob>;
  private readonly worker: Worker<VideoStatusSyncJob, VideoStatusSyncResult>;
  private readonly scanIntervalMs: number;

  constructor(private readonly options: BullMqVideoStatusSyncSchedulerOptions) {
    this.scanIntervalMs = options.scanIntervalMs ?? 10_000;
    const connection = parseRedisConnectionOptions(options.redisUrl);
    this.queue = new Queue<VideoStatusSyncJob>("video-status-sync", {
      connection,
      defaultJobOptions: defaultJobOptions()
    });
    this.worker = new Worker<VideoStatusSyncJob, VideoStatusSyncResult>(
      "video-status-sync",
      async (job) => {
        if (job.data.kind === "job") {
          return this.options.synchronizer.syncProviderJob(job.data.jobId);
        }
        return this.options.synchronizer.syncActiveProviderJobs();
      },
      {
        connection,
        concurrency: 1
      }
    );
  }

  async start(): Promise<void> {
    await this.queue.add("scan", { kind: "scan" }, {
      jobId: "video-status-scan",
      repeat: { every: this.scanIntervalMs },
      ...defaultJobOptions()
    });
  }

  async enqueueJobSync(jobId: string): Promise<void> {
    await this.queue.add(
      "job",
      { kind: "job", jobId },
      {
        jobId: `video-status-job-${jobId}`,
        ...defaultJobOptions()
      }
    );
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }
}

export function isProviderBackedTaskId(providerTaskId?: string): providerTaskId is string {
  return Boolean(providerTaskId && !providerTaskId.startsWith("mock-task-"));
}

export function parseRedisConnectionOptions(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  const dbPath = url.pathname.replace(/^\//, "");
  const options: RedisOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    db: dbPath ? Number(dbPath) : 0,
    maxRetriesPerRequest: null
  };
  if (url.password) options.password = decodeURIComponent(url.password);
  if (url.username) options.username = decodeURIComponent(url.username);
  if (url.protocol === "rediss:") options.tls = {};
  return options;
}

function defaultJobOptions(): JobsOptions {
  return {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000
    },
    removeOnComplete: 100,
    removeOnFail: 100
  };
}

async function flushStoreIfPersistent(store: InMemoryStore): Promise<void> {
  if (isPersistentStore(store)) {
    await store.flush();
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown video status sync error";
}
