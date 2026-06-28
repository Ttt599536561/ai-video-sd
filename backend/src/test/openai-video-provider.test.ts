import { describe, expect, it } from "vitest";
import { OpenAiVideoProvider } from "../services/openai-video-provider.js";

describe("OpenAiVideoProvider", () => {
  it("lists OpenAI-compatible video models with bearer auth", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new OpenAiVideoProvider({
      baseUrl: "https://provider.example.com",
      apiKey: "sk-test",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          object: "list",
          data: [
            { id: "video-ds-2.0", supported_endpoint_types: ["openai-video"] },
            { id: "text-model", supported_endpoint_types: ["chat"] }
          ]
        });
      }
    });

    const models = await provider.listVideoModels();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://provider.example.com/v1/models",
      init: {
        method: "GET",
        headers: {
          Authorization: "Bearer sk-test"
        }
      }
    });
    expect(models).toEqual([{ id: "video-ds-2.0", supportedEndpointTypes: ["openai-video"] }]);
  });

  it("submits video jobs as JSON with aspect ratio and reference media", async () => {
    let submittedBody: Record<string, unknown> | undefined;
    let submittedHeaders: HeadersInit | undefined;
    const provider = new OpenAiVideoProvider({
      baseUrl: "https://provider.example.com/",
      apiKey: "sk-test",
      fetch: async (_url, init) => {
        submittedHeaders = init?.headers;
        submittedBody = JSON.parse(String(init?.body));
        return jsonResponse({
          id: "video_123",
          status: "processing",
          progress: 0
        });
      }
    });

    const result = await provider.submitVideo({
      model: "video-ds-2.0",
      prompt: "A small film scene",
      seconds: 8,
      aspectRatio: "9:16",
      images: ["https://example.com/input.png"],
      videos: ["https://example.com/input.mp4"],
      audios: ["https://example.com/input.mp3"]
    });

    expect(result).toEqual({ providerTaskId: "video_123", status: "RUNNING" });
    expect(submittedHeaders).toMatchObject({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json"
    });
    expect(submittedBody).toEqual({
      model: "video-ds-2.0",
      prompt: "A small film scene",
      seconds: 8,
      aspect_ratio: "9:16",
      images: ["https://example.com/input.png"],
      videos: ["https://example.com/input.mp4"],
      audios: ["https://example.com/input.mp3"]
    });
  });

  it("preserves supplier status_code/task_id error text from JSON failures", async () => {
    const provider = new OpenAiVideoProvider({
      baseUrl: "https://provider.example.com",
      apiKey: "sk-test",
      fetch: async () =>
        jsonResponse(
          {
            status_code: 500,
            message: "task_id is empty"
          },
          500
        )
    });

    await expect(
      provider.submitVideo({
        model: "video-ds-2.0",
        prompt: "A small film scene",
        seconds: 5,
        aspectRatio: "9:16",
        images: ["https://example.com/input.png"]
      })
    ).rejects.toThrow("Provider request failed with HTTP 500: status_code=500 - task_id is empty");
  });

  it("maps provider task status responses into local job statuses", async () => {
    const provider = new OpenAiVideoProvider({
      baseUrl: "https://provider.example.com",
      apiKey: "sk-test",
      fetch: async () =>
        jsonResponse({
          id: "video_123",
          status: "succeeded",
          progress: 100,
          size: "1280x720",
          seconds: "8"
        })
    });

    const status = await provider.getVideoStatus("video_123");

    expect(status).toEqual({
      providerTaskId: "video_123",
      status: "SUCCEEDED",
      progress: 100,
      contentPath: "/v1/videos/video_123/content"
    });
  });

  it("downloads generated video content with bearer auth", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new OpenAiVideoProvider({
      baseUrl: "https://provider.example.com",
      apiKey: "sk-test",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "video/mp4" }
        });
      }
    });

    const content = await provider.downloadVideoContent("video_123");

    expect(calls).toEqual([
      {
        url: "https://provider.example.com/v1/videos/video_123/content",
        init: {
          method: "GET",
          headers: {
            Authorization: "Bearer sk-test"
          }
        }
      }
    ]);
    expect(content.mimeType).toBe("video/mp4");
    expect(Buffer.from(content.content)).toEqual(Buffer.from([1, 2, 3]));
  });

  it("includes provider error details from failed JSON responses without leaking the API key", async () => {
    const provider = new OpenAiVideoProvider({
      baseUrl: "https://provider.example.com",
      apiKey: "sk-secret-test",
      fetch: async () =>
        jsonResponse(
          {
            error: {
              code: "permission_denied",
              message: "Video generation is not enabled for this key"
            }
          },
          403
        )
    });

    await expect(
      provider.submitVideo({
        model: "video-ds-2.0",
        prompt: "A small film scene",
        seconds: 5,
        aspectRatio: "9:16"
      })
    ).rejects.toThrow(
      "Provider request failed with HTTP 403: permission_denied - Video generation is not enabled for this key"
    );

    await expect(
      provider.submitVideo({
        model: "video-ds-2.0",
        prompt: "A small film scene",
        seconds: 5,
        aspectRatio: "9:16"
      })
    ).rejects.not.toThrow("sk-secret-test");
  });

  it("includes provider error_code and error_msg fields from failed JSON responses", async () => {
    const provider = new OpenAiVideoProvider({
      baseUrl: "https://provider.example.com",
      apiKey: "sk-test",
      fetch: async () =>
        jsonResponse(
          {
            error_code: "insufficient_quota",
            error_msg: "Account balance is too low"
          },
          403
        )
    });

    await expect(
      provider.submitVideo({
        model: "video-ds-2.0",
        prompt: "A small film scene",
        seconds: 5,
        aspectRatio: "9:16"
      })
    ).rejects.toThrow("Provider request failed with HTTP 403: insufficient_quota - Account balance is too low");
  });

  it("preserves insufficient user quota details from provider failures", async () => {
    const provider = new OpenAiVideoProvider({
      baseUrl: "https://provider.example.com",
      apiKey: "sk-test",
      fetch: async () =>
        jsonResponse(
          {
            error: {
              code: "insufficient_user_quota",
              message: "用户额度不足, 剩余额度: ＄35.000000, 最低保留额度: ＄9.000000"
            }
          },
          403
        )
    });

    await expect(
      provider.submitVideo({
        model: "video-ds-2.0",
        prompt: "A small film scene",
        seconds: 5,
        aspectRatio: "9:16"
      })
    ).rejects.toThrow(
      "Provider request failed with HTTP 403: insufficient_user_quota - 用户额度不足, 剩余额度: ＄35.000000, 最低保留额度: ＄9.000000"
    );
  });

  it("redacts the configured API key if the provider echoes it in an error response", async () => {
    const provider = new OpenAiVideoProvider({
      baseUrl: "https://provider.example.com",
      apiKey: "sk-secret-test",
      fetch: async () =>
        jsonResponse(
          {
            error: {
              code: "permission_denied",
              message: "Bearer sk-secret-test is not allowed to create videos"
            }
          },
          403
        )
    });

    await expect(
      provider.submitVideo({
        model: "video-ds-2.0",
        prompt: "A small film scene",
        seconds: 5,
        aspectRatio: "9:16"
      })
    ).rejects.toThrow("Provider request failed with HTTP 403: permission_denied - Bearer [redacted] is not allowed to create videos");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
