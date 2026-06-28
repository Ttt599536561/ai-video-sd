import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VideoAsset } from "../domain/types.js";
import { VideoFileStorage } from "../services/video-file-storage.js";

describe("VideoFileStorage", () => {
  let rootDir: string | undefined;

  afterEach(() => {
    if (rootDir) {
      rmSync(rootDir, { recursive: true, force: true });
      rootDir = undefined;
    }
  });

  it("stores provider video content under the configured root", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "video-storage-"));
    const storage = new VideoFileStorage({ rootDir, signingSecret: "secret" });

    const stored = await storage.saveOutputVideo(
      { id: "job-1" },
      { content: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" }
    );

    expect(stored).toEqual({
      storageKey: "outputs/job-1.mp4",
      mimeType: "video/mp4",
      sizeBytes: 3
    });
    expect(readFileSync(join(rootDir, "outputs", "job-1.mp4"))).toEqual(Buffer.from([1, 2, 3]));
  });

  it("creates and verifies signed download paths", () => {
    rootDir = mkdtempSync(join(tmpdir(), "video-storage-"));
    const storage = new VideoFileStorage({ rootDir, signingSecret: "secret", downloadTtlMs: 60_000 });
    const now = new Date("2026-01-01T00:00:00.000Z");

    const downloadPath = storage.createSignedDownloadPath("asset-1", now);
    const parsed = new URL(`http://127.0.0.1${downloadPath}`);

    expect(parsed.pathname).toBe("/api/video/assets/asset-1/download");
    expect(storage.verifySignedDownload("asset-1", parsed.searchParams, now)).toBe(true);
    expect(storage.verifySignedDownload("asset-2", parsed.searchParams, now)).toBe(false);
    expect(storage.verifySignedDownload("asset-1", parsed.searchParams, new Date(now.getTime() + 61_000))).toBe(false);
  });

  it("deletes expired files and marks assets as deleted", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "video-storage-"));
    const storage = new VideoFileStorage({ rootDir, signingSecret: "secret" });
    const stored = await storage.saveOutputVideo(
      { id: "job-1" },
      { content: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" }
    );
    const now = new Date("2026-01-04T00:00:00.000Z");
    const asset: VideoAsset = {
      id: "asset-1",
      jobId: "job-1",
      type: "OUTPUT_VIDEO",
      storageKey: stored.storageKey,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      expiresAt: new Date("2026-01-03T23:59:59.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    };

    const deletedCount = await storage.cleanupExpiredAssets([asset], now);
    const secondPassCount = await storage.cleanupExpiredAssets([asset], now);

    expect(deletedCount).toBe(1);
    expect(secondPassCount).toBe(0);
    expect(asset.deletedAt).toEqual(now);
    expect(existsSync(join(rootDir, "outputs", "job-1.mp4"))).toBe(false);
  });
});
