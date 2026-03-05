import { NextRequest, NextResponse } from "next/server";
import { loadAIConfig, saveAIConfig, PROVIDER_PRESETS, type AIConfig, type CloudProvider } from "@/lib/ai-service";

const VALID_PROVIDERS = Object.keys(PROVIDER_PRESETS) as CloudProvider[];

export async function GET() {
  try {
    const config = loadAIConfig();
    // Don't expose the full API key
    const safeConfig = {
      ...config,
      cloudApiKey: config.cloudApiKey ? "••••" + config.cloudApiKey.slice(-4) : "",
    };
    return NextResponse.json(safeConfig);
  } catch (err) {
    console.error("Failed to load AI config:", err);
    return NextResponse.json({ error: "Failed to load config" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const current = loadAIConfig();

    // Validate provider
    const provider = VALID_PROVIDERS.includes(body.cloudProvider)
      ? body.cloudProvider
      : current.cloudProvider;

    const updated: AIConfig = {
      enableLocalAI: body.enableLocalAI ?? current.enableLocalAI,
      enableAutoTag: body.enableAutoTag ?? current.enableAutoTag,
      enableSemanticSearch: body.enableSemanticSearch ?? current.enableSemanticSearch,
      enablePerceptualHash: body.enablePerceptualHash ?? current.enablePerceptualHash,
      autoTagConfidence: body.autoTagConfidence ?? current.autoTagConfidence,
      enableCloudAI: body.enableCloudAI ?? current.enableCloudAI,
      cloudProvider: provider,
      // Only update API key if it's not the masked value
      cloudApiKey: body.cloudApiKey && !body.cloudApiKey.startsWith("••••")
        ? body.cloudApiKey
        : current.cloudApiKey,
      cloudApiUrl: body.cloudApiUrl ?? current.cloudApiUrl,
      cloudModel: body.cloudModel ?? current.cloudModel,
    };

    saveAIConfig(updated);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to save AI config:", err);
    return NextResponse.json({ error: "Failed to save config" }, { status: 500 });
  }
}
