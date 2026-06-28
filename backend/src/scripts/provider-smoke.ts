import "dotenv/config";
import { OpenAiVideoProvider } from "../services/openai-video-provider.js";

const baseUrl = process.env.VIDEO_PROVIDER_BASE_URL;
const apiKey = process.env.VIDEO_PROVIDER_API_KEY;

if (!baseUrl) throw new Error("VIDEO_PROVIDER_BASE_URL is required");
if (!apiKey) throw new Error("VIDEO_PROVIDER_API_KEY is required");

const provider = new OpenAiVideoProvider({ baseUrl, apiKey });
const models = await provider.listVideoModels();

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      videoModels: models.map((model) => model.id)
    },
    null,
    2
  )
);
