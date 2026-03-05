import { NextRequest, NextResponse } from "next/server";
import { loadAIConfig, PROVIDER_PRESETS, type CloudProvider } from "@/lib/ai-service";

/**
 * Fetch available models from the provider's API.
 * GET /api/ai/models?provider=xxx&apiUrl=xxx&apiKey=xxx
 *
 * If apiKey is not provided, uses the saved config key.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = (searchParams.get("provider") || "openai") as CloudProvider;
    const paramApiUrl = searchParams.get("apiUrl");
    const paramApiKey = searchParams.get("apiKey");

    const config = loadAIConfig();
    const preset = PROVIDER_PRESETS[provider];

    const apiUrl = paramApiUrl || config.cloudApiUrl || preset?.apiUrl || "";
    const apiKey = paramApiKey || config.cloudApiKey || "";

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required to fetch models" },
        { status: 400 }
      );
    }

    const models = await fetchModels(provider, apiUrl, apiKey);

    return NextResponse.json({ models });
  } catch (err) {
    console.error("Failed to fetch models:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch models" },
      { status: 500 }
    );
  }
}

interface ModelInfo {
  id: string;
  name?: string;
  owned_by?: string;
}

async function fetchModels(
  provider: CloudProvider,
  apiUrl: string,
  apiKey: string
): Promise<ModelInfo[]> {
  if (provider === "google") {
    return fetchGeminiModels(apiUrl, apiKey);
  }

  if (provider === "anthropic") {
    return fetchAnthropicModels(apiUrl, apiKey);
  }

  // OpenAI-compatible /models endpoint
  return fetchOpenAICompatibleModels(apiUrl, apiKey);
}

/**
 * OpenAI-compatible /models endpoint.
 * Works for: OpenAI, DeepSeek, Qwen, Zhipu, Doubao, Moonshot,
 * Baichuan, MiniMax, StepFun, Yi, Groq, Mistral, Cohere, etc.
 */
async function fetchOpenAICompatibleModels(
  apiUrl: string,
  apiKey: string
): Promise<ModelInfo[]> {
  const url = `${apiUrl}/models`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to fetch models: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = await response.json();

  // Standard OpenAI format: { data: [{ id, owned_by, ... }] }
  if (Array.isArray(data.data)) {
    return data.data.map((m: { id: string; owned_by?: string }) => ({
      id: m.id,
      name: m.id,
      owned_by: m.owned_by,
    }));
  }

  // Some providers return { models: [...] }
  if (Array.isArray(data.models)) {
    return data.models.map((m: { id?: string; name?: string; model?: string }) => ({
      id: m.id || m.model || m.name || "",
      name: m.name || m.id || m.model || "",
    }));
  }

  // Fallback: maybe array directly
  if (Array.isArray(data)) {
    return data.map((m: { id?: string; name?: string; model?: string } | string) => {
      if (typeof m === "string") return { id: m, name: m };
      return { id: m.id || m.model || m.name || "", name: m.name || m.id || "" };
    });
  }

  throw new Error("Unexpected response format from models endpoint");
}

/**
 * Anthropic models endpoint.
 * Uses x-api-key header and different response format.
 */
async function fetchAnthropicModels(
  apiUrl: string,
  apiKey: string
): Promise<ModelInfo[]> {
  const url = `${apiUrl}/v1/models`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to fetch Anthropic models: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = await response.json();

  // Anthropic format: { data: [{ id, display_name, ... }] }
  if (Array.isArray(data.data)) {
    return data.data.map((m: { id: string; display_name?: string }) => ({
      id: m.id,
      name: m.display_name || m.id,
    }));
  }

  // Fallback
  if (Array.isArray(data)) {
    return data.map((m: { id?: string; name?: string } | string) => {
      if (typeof m === "string") return { id: m, name: m };
      return { id: m.id || m.name || "", name: m.name || m.id || "" };
    });
  }

  throw new Error("Unexpected Anthropic response format");
}

/**
 * Google Gemini models endpoint.
 * Uses API key in query param.
 */
async function fetchGeminiModels(
  apiUrl: string,
  apiKey: string
): Promise<ModelInfo[]> {
  const url = `${apiUrl}/models?key=${apiKey}`;

  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to fetch Gemini models: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = await response.json();

  // Gemini format: { models: [{ name: "models/gemini-...", displayName, ... }] }
  if (Array.isArray(data.models)) {
    return data.models
      .filter((m: { name: string; supportedGenerationMethods?: string[] }) => {
        // Only include models that support content generation
        return m.supportedGenerationMethods?.includes("generateContent") ?? true;
      })
      .map((m: { name: string; displayName?: string }) => ({
        id: m.name.replace("models/", ""),
        name: m.displayName || m.name.replace("models/", ""),
      }));
  }

  throw new Error("Unexpected Gemini response format");
}
