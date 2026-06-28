import type { VideoAsset, VideoJob } from "../domain/types.js";
import { createId } from "./crypto.service.js";

export type MockVideoOutcome = "SUCCEEDED" | "FAILED";

export interface MockVideoProcessOptions {
  outcome?: MockVideoOutcome;
  errorMessage?: string;
}

export class MockVideoProvider {
  submit(job: VideoJob): string {
    return `mock-task-${job.id.slice(0, 8)}`;
  }

  createOutputAsset(job: VideoJob, now = new Date()): VideoAsset {
    return {
      id: createId(),
      jobId: job.id,
      type: "OUTPUT_VIDEO",
      storageKey: `mock-output/${job.id}.mp4`,
      mimeType: "video/mp4",
      sizeBytes: 1_048_576,
      expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      createdAt: now
    };
  }
}
