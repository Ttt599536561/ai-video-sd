import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, statSync, type ReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { VideoAsset } from "../domain/types.js";

export interface VideoContent {
  content: ArrayBuffer | Uint8Array;
  mimeType: string;
}

export interface StoredOutputVideo {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StoredReferenceMedia {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  filename: string;
}

interface VideoFileStorageOptions {
  rootDir: string;
  signingSecret: string;
  downloadTtlMs?: number;
}

export class VideoFileStorage {
  private readonly rootDir: string;
  private readonly downloadTtlMs: number;

  constructor(private readonly options: VideoFileStorageOptions) {
    this.rootDir = resolve(options.rootDir);
    this.downloadTtlMs = options.downloadTtlMs ?? 5 * 60 * 1000;
  }

  async saveOutputVideo(job: { id: string }, input: VideoContent): Promise<StoredOutputVideo> {
    const buffer = input.content instanceof Uint8Array ? Buffer.from(input.content) : Buffer.from(input.content);
    const storageKey = `outputs/${safePathPart(job.id)}${extensionForMimeType(input.mimeType)}`;
    const path = this.resolveStorageKey(storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
    return {
      storageKey,
      mimeType: input.mimeType,
      sizeBytes: buffer.byteLength
    };
  }

  async saveReferenceMedia(job: { id: string }, input: VideoContent & { kind: "image" | "video" | "audio"; index: number }): Promise<StoredReferenceMedia> {
    const buffer = input.content instanceof Uint8Array ? Buffer.from(input.content) : Buffer.from(input.content);
    const filename = `${input.kind}-${input.index}${extensionForMimeType(input.mimeType)}`;
    const storageKey = `references/${safePathPart(job.id)}/${filename}`;
    const path = this.resolveStorageKey(storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
    return {
      storageKey,
      mimeType: input.mimeType,
      sizeBytes: buffer.byteLength,
      filename
    };
  }

  createSignedDownloadPath(assetId: string, now = new Date()): string {
    const expiresAt = now.getTime() + this.downloadTtlMs;
    const signature = this.sign(assetId, expiresAt);
    return `/api/video/assets/${encodeURIComponent(assetId)}/download?expiresAt=${expiresAt}&signature=${encodeURIComponent(signature)}`;
  }

  verifySignedDownload(assetId: string, searchParams: URLSearchParams, now = new Date()): boolean {
    const expiresAt = Number(searchParams.get("expiresAt"));
    const signature = searchParams.get("signature");
    if (!Number.isFinite(expiresAt) || !signature || expiresAt <= now.getTime()) return false;
    const expected = this.sign(assetId, expiresAt);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  }

  openReadStream(storageKey: string, range?: { start: number; end: number }): ReadStream {
    return createReadStream(this.resolveStorageKey(storageKey), range);
  }

  sizeOf(storageKey: string): number {
    return statSync(this.resolveStorageKey(storageKey)).size;
  }

  async cleanupExpiredAssets(assets: VideoAsset[], now = new Date()): Promise<number> {
    let deletedCount = 0;
    for (const asset of assets) {
      if (!asset.expiresAt || asset.deletedAt || asset.expiresAt > now) continue;
      await rm(this.resolveStorageKey(asset.storageKey), { force: true });
      asset.deletedAt = now;
      deletedCount += 1;
    }
    return deletedCount;
  }

  resolveStorageKey(storageKey: string): string {
    const parts = storageKey.split("/").filter(Boolean);
    if (!parts.length || parts.some((part) => part === ".." || part.includes("\\") || part.includes(":"))) {
      throw new Error("Invalid storage key");
    }
    const path = resolve(this.rootDir, ...parts);
    const rootWithSeparator = this.rootDir.endsWith(sep) ? this.rootDir : `${this.rootDir}${sep}`;
    if (path !== this.rootDir && !path.startsWith(rootWithSeparator)) {
      throw new Error("Invalid storage key");
    }
    return path;
  }

  private sign(assetId: string, expiresAt: number): string {
    return createHmac("sha256", this.options.signingSecret)
      .update(`${assetId}.${expiresAt}`)
      .digest("base64url");
  }
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType === "audio/wav") return ".wav";
  if (mimeType === "audio/mp4") return ".m4a";
  if (mimeType === "video/mp4") return ".mp4";
  if (mimeType === "video/webm") return ".webm";
  if (mimeType === "video/quicktime") return ".mov";
  return ".bin";
}

function safePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}
