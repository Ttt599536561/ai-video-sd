import type { VideoJobStatus } from "../domain/types.js";

type FetchLike = typeof fetch;

export interface OpenAiVideoProviderOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: FetchLike;
}

export interface ProviderVideoModel {
  id: string;
  supportedEndpointTypes: string[];
}

export interface SubmitVideoInput {
  model: string;
  prompt: string;
  seconds: number;
  aspectRatio?: string;
  images?: string[];
  videos?: string[];
  audios?: string[];
}

export interface SubmitVideoResult {
  providerTaskId: string;
  status: VideoJobStatus;
}

export interface ProviderVideoStatus extends SubmitVideoResult {
  progress?: number;
  contentPath?: string;
  errorMessage?: string;
}

export interface DownloadVideoContentResult {
  content: ArrayBuffer;
  mimeType: string;
}

export class OpenAiVideoProvider {
  private readonly baseUrl: URL;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: OpenAiVideoProviderOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.fetchImpl = options.fetch ?? fetch;
  }

  async listVideoModels(): Promise<ProviderVideoModel[]> {
    const body = await this.getJson<{ data?: Array<{ id?: unknown; supported_endpoint_types?: unknown }> }>("/v1/models");
    return (body.data ?? [])
      .map((model) => ({
        id: typeof model.id === "string" ? model.id : "",
        supportedEndpointTypes: Array.isArray(model.supported_endpoint_types)
          ? model.supported_endpoint_types.filter((type): type is string => typeof type === "string")
          : []
      }))
      .filter((model) => model.id && model.supportedEndpointTypes.includes("openai-video"));
  }

  async submitVideo(input: SubmitVideoInput): Promise<SubmitVideoResult> {
    const payload = {
      model: input.model,
      prompt: input.prompt,
      seconds: input.seconds,
      aspect_ratio: input.aspectRatio ?? "9:16",
      ...(input.images?.length ? { images: input.images } : {}),
      ...(input.videos?.length ? { videos: input.videos } : {}),
      ...(input.audios?.length ? { audios: input.audios } : {})
    };

    const body = await this.requestJson<{ id?: unknown; status?: unknown }>("/v1/videos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const providerTaskId = parseProviderTaskId(body);
    return {
      providerTaskId,
      status: mapProviderStatus(body.status)
    };
  }

  async getVideoStatus(providerTaskId: string): Promise<ProviderVideoStatus> {
    const path = `/v1/videos/${encodeURIComponent(providerTaskId)}`;
    const body = await this.getJson<{
      id?: unknown;
      status?: unknown;
      progress?: unknown;
      error?: unknown;
      error_message?: unknown;
    }>(path);
    const id = typeof body.id === "string" ? body.id : providerTaskId;
    const status = mapProviderStatus(body.status);
    return {
      providerTaskId: id,
      status,
      progress: typeof body.progress === "number" ? body.progress : undefined,
      contentPath: status === "SUCCEEDED" ? `${path}/content` : undefined,
      errorMessage: parseProviderError(body)
    };
  }

  async downloadVideoContent(providerTaskId: string): Promise<DownloadVideoContentResult> {
    const response = await this.request(`/v1/videos/${encodeURIComponent(providerTaskId)}/content`, {
      method: "GET"
    });
    return {
      content: await response.arrayBuffer(),
      mimeType: response.headers.get("content-type") ?? "application/octet-stream"
    };
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.requestJson<T>(path, { method: "GET" });
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    return (await response.json()) as T;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await this.fetchImpl(this.urlFor(path), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        ...init.headers
      }
    });

    if (!response.ok) {
      throw new Error(await providerRequestErrorMessage(response, this.options.apiKey));
    }
    return response;
  }

  private urlFor(path: string): string {
    return new URL(path, this.baseUrl).toString();
  }
}

function parseProviderTaskId(body: { id?: unknown }): string {
  if (typeof body.id === "string" && body.id) return body.id;
  throw new Error("Provider response did not include a video id");
}

function mapProviderStatus(rawStatus: unknown): VideoJobStatus {
  const status = typeof rawStatus === "string" ? rawStatus.toLowerCase() : "";
  if (["succeeded", "completed", "complete", "success"].includes(status)) return "SUCCEEDED";
  if (["failed", "error", "cancelled", "canceled"].includes(status)) return "FAILED";
  if (["processing", "running", "in_progress", "queued", "pending"].includes(status)) return "RUNNING";
  return "RUNNING";
}

function parseProviderError(body: { error?: unknown; error_message?: unknown }): string | undefined {
  if (typeof body.error_message === "string") return body.error_message;
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && "message" in body.error) {
    const message = (body.error as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
  }
  return undefined;
}

async function providerRequestErrorMessage(response: Response, apiKey: string): Promise<string> {
  const detail = await parseProviderErrorDetail(response);
  return detail
    ? `Provider request failed with HTTP ${response.status}: ${redactErrorDetail(detail, apiKey)}`
    : `Provider request failed with HTTP ${response.status}`;
}

async function parseProviderErrorDetail(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      return summarizeProviderErrorBody(await response.json());
    }
    const text = (await response.text()).trim();
    return text ? truncateErrorDetail(text) : undefined;
  } catch {
    return undefined;
  }
}

function summarizeProviderErrorBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return truncateErrorDetail(error);
  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>;
    return joinErrorParts(firstString(errorRecord.code, errorRecord.error_code, errorRecord.type), firstString(errorRecord.message, errorRecord.error_message, errorRecord.error_msg));
  }
  return joinErrorParts(
    firstErrorCode(record.code, record.error_code, record.status_code, record.type),
    firstString(record.message, record.error_message, record.error_msg)
  );
}

function joinErrorParts(rawCode: unknown, rawMessage: unknown): string | undefined {
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
  if (code && message) return truncateErrorDetail(`${code} - ${message}`);
  if (code) return truncateErrorDetail(code);
  if (message) return truncateErrorDetail(message);
  return undefined;
}

function truncateErrorDetail(detail: string): string {
  return detail.length > 500 ? `${detail.slice(0, 500)}...` : detail;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function firstErrorCode(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return `status_code=${value}`;
  }
  return undefined;
}

function redactErrorDetail(detail: string, apiKey: string): string {
  if (!apiKey) return detail;
  return detail.split(apiKey).join("[redacted]");
}
