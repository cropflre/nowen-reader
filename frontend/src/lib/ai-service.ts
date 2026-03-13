/**
 * NowenReader AI Service (Hybrid: Local + Cloud)
 *
 * Local capabilities:
 *   - Perceptual hash (pHash) for duplicate detection
 *   - Cover image classification (via @huggingface/transformers)
 *   - Text embedding for semantic search
 *
 * Cloud capabilities (optional):
 *   - LLM metadata completion (OpenAI / compatible API)
 */

import path from "path";
import fs from "fs";

// ============================================================
// AI Configuration
// ============================================================

// Supported cloud AI providers
export type CloudProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "zhipu"
  | "qwen"
  | "doubao"
  | "moonshot"
  | "baichuan"
  | "minimax"
  | "stepfun"
  | "yi"
  | "groq"
  | "mistral"
  | "cohere"
  | "compatible";

export interface ProviderPreset {
  name: string;
  apiUrl: string;
  defaultModel: string;
  models: string[];
  supportsVision: boolean;
  region: "international" | "china";
}

/**
 * Provider presets with default API URLs and recommended models.
 * All providers use OpenAI-compatible chat/completions format unless noted.
 */
export const PROVIDER_PRESETS: Record<CloudProvider, ProviderPreset> = {
  // === International Providers ===
  openai: {
    name: "OpenAI",
    apiUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.5-preview", "o1", "o1-mini", "o3-mini"],
    supportsVision: true,
    region: "international",
  },
  anthropic: {
    name: "Anthropic (Claude)",
    apiUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-20250514",
    models: ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022", "claude-3-5-sonnet-20241022"],
    supportsVision: true,
    region: "international",
  },
  google: {
    name: "Google Gemini",
    apiUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"],
    supportsVision: true,
    region: "international",
  },
  groq: {
    name: "Groq",
    apiUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
    supportsVision: false,
    region: "international",
  },
  mistral: {
    name: "Mistral AI",
    apiUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    models: ["mistral-large-latest", "mistral-small-latest", "pixtral-large-latest", "codestral-latest"],
    supportsVision: true,
    region: "international",
  },
  cohere: {
    name: "Cohere",
    apiUrl: "https://api.cohere.com/v2",
    defaultModel: "command-r-plus",
    models: ["command-r-plus", "command-r", "command-light"],
    supportsVision: false,
    region: "international",
  },

  // === China Providers ===
  deepseek: {
    name: "DeepSeek (深度求索)",
    apiUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    supportsVision: false,
    region: "china",
  },
  zhipu: {
    name: "Zhipu AI (智谱清言)",
    apiUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4v-flash",
    models: ["glm-4v-flash", "glm-4-flash", "glm-4-plus", "glm-4-long", "glm-4v-plus"],
    supportsVision: true,
    region: "china",
  },
  qwen: {
    name: "Alibaba Qwen (通义千问)",
    apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-vl-plus",
    models: ["qwen-turbo", "qwen-plus", "qwen-max", "qwen-vl-plus", "qwen-vl-max"],
    supportsVision: true,
    region: "china",
  },
  doubao: {
    name: "Doubao (豆包/字节跳动)",
    apiUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-1.5-pro-32k",
    models: ["doubao-1.5-pro-32k", "doubao-1.5-lite-32k", "doubao-1.5-vision-pro-32k"],
    supportsVision: true,
    region: "china",
  },
  moonshot: {
    name: "Moonshot AI (月之暗面)",
    apiUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    supportsVision: false,
    region: "china",
  },
  baichuan: {
    name: "Baichuan (百川智能)",
    apiUrl: "https://api.baichuan-ai.com/v1",
    defaultModel: "Baichuan4",
    models: ["Baichuan4", "Baichuan3-Turbo", "Baichuan3-Turbo-128k"],
    supportsVision: false,
    region: "china",
  },
  minimax: {
    name: "MiniMax",
    apiUrl: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-Text-01",
    models: ["MiniMax-Text-01", "abab6.5s-chat"],
    supportsVision: false,
    region: "china",
  },
  stepfun: {
    name: "StepFun (阶跃星辰)",
    apiUrl: "https://api.stepfun.com/v1",
    defaultModel: "step-1v-8k",
    models: ["step-2-16k", "step-1-8k", "step-1v-8k", "step-1v-32k"],
    supportsVision: true,
    region: "china",
  },
  yi: {
    name: "Yi (零一万物)",
    apiUrl: "https://api.lingyiwanwu.com/v1",
    defaultModel: "yi-vision",
    models: ["yi-large", "yi-medium", "yi-vision", "yi-large-turbo"],
    supportsVision: true,
    region: "china",
  },

  // === Custom ===
  compatible: {
    name: "Custom (OpenAI Compatible)",
    apiUrl: "",
    defaultModel: "",
    models: [],
    supportsVision: true,
    region: "international",
  },
};

export interface AIConfig {
  // Local AI
  enableLocalAI: boolean;
  enableAutoTag: boolean;
  enableSemanticSearch: boolean;
  enablePerceptualHash: boolean;
  autoTagConfidence: number; // 0-1, minimum confidence to apply tag

  // Cloud AI
  enableCloudAI: boolean;
  cloudProvider: CloudProvider;
  cloudApiKey: string;
  cloudApiUrl: string; // editable, auto-filled from preset
  cloudModel: string;
}

const DEFAULT_CONFIG: AIConfig = {
  enableLocalAI: true,
  enableAutoTag: true,
  enableSemanticSearch: true,
  enablePerceptualHash: true,
  autoTagConfidence: 0.3,

  enableCloudAI: false,
  cloudProvider: "openai",
  cloudApiKey: "",
  cloudApiUrl: "https://api.openai.com/v1",
  cloudModel: "gpt-4o-mini",
};

const CONFIG_PATH = path.join(process.cwd(), ".cache", "ai-config.json");

export function loadAIConfig(): AIConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG };
}

export function saveAIConfig(config: AIConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ============================================================
// Perceptual Hash (pHash) — No external AI dependency
// ============================================================

/**
 * Generate a perceptual hash from an image buffer using Sharp.
 * Algorithm: Resize to 32x32 grayscale → compute DCT → take top-left 8x8 → binarize by median.
 * Returns a 64-bit hex string.
 */
export async function generatePerceptualHash(imageBuffer: Buffer): Promise<string> {
  const sharp = (await import("sharp")).default;

  // Resize to 32x32 grayscale
  const pixels = await sharp(imageBuffer)
    .resize(32, 32, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  // Simple DCT-like approach: resize to 8x8 and compare to mean
  const smallPixels = await sharp(imageBuffer)
    .resize(8, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  // Calculate mean
  let sum = 0;
  for (let i = 0; i < smallPixels.length; i++) {
    sum += smallPixels[i];
  }
  const mean = sum / smallPixels.length;

  // Build hash: each bit = pixel > mean
  let hash = "";
  for (let i = 0; i < smallPixels.length; i++) {
    hash += smallPixels[i] > mean ? "1" : "0";
  }

  // Convert binary string to hex
  let hex = "";
  for (let i = 0; i < hash.length; i += 4) {
    hex += parseInt(hash.substring(i, i + 4), 2).toString(16);
  }

  // Also use the 32x32 for a more detailed hash
  let sum32 = 0;
  for (let i = 0; i < pixels.length; i++) {
    sum32 += pixels[i];
  }
  const mean32 = sum32 / pixels.length;

  // Build second hash from top-left 8x8 of 32x32
  let hash2 = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      hash2 += pixels[row * 32 + col] > mean32 ? "1" : "0";
    }
  }
  let hex2 = "";
  for (let i = 0; i < hash2.length; i += 4) {
    hex2 += parseInt(hash2.substring(i, i + 4), 2).toString(16);
  }

  return hex + hex2;
}

/**
 * Calculate Hamming distance between two hex hashes.
 * Returns number of differing bits.
 */
export function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) {
    return Math.max(hash1.length, hash2.length) * 4; // max distance
  }

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const n1 = parseInt(hash1[i], 16);
    const n2 = parseInt(hash2[i], 16);
    let xor = n1 ^ n2;
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * Compare two image buffers and return similarity (0-1).
 * 1 = identical, 0 = completely different.
 */
export async function compareImages(
  img1: Buffer,
  img2: Buffer
): Promise<{ similarity: number; hash1: string; hash2: string }> {
  const hash1 = await generatePerceptualHash(img1);
  const hash2 = await generatePerceptualHash(img2);
  const dist = hammingDistance(hash1, hash2);
  const maxBits = hash1.length * 4;
  const similarity = 1 - dist / maxBits;
  return { similarity, hash1, hash2 };
}

// ============================================================
// Cover Analysis — Cloud AI (Optional)
// ============================================================

export interface CoverAnalysis {
  tags: string[];
  description: string;
  genre: string;
  style: string;
  language: string;
}

/**
 * Analyze a comic cover using Cloud LLM (vision model).
 * Supports OpenAI-compatible, Anthropic, and Google Gemini APIs.
 */
export async function analyzeCoverWithLLM(
  imageBuffer: Buffer,
  config: AIConfig,
  existingTitle?: string,
  lang?: string
): Promise<CoverAnalysis | null> {
  if (!config.enableCloudAI || !config.cloudApiKey) return null;

  const base64 = imageBuffer.toString("base64");
  const mimeType = "image/webp";

  const isZh = lang?.startsWith("zh");
  const langInstruction = isZh
    ? `\nIMPORTANT: All tags, genre, and description MUST be in Chinese (简体中文). For example, use "动作" instead of "Action", "奇幻" instead of "Fantasy", "少年" instead of "Shounen".`
    : "";

  const systemPrompt = `You are a comic/manga metadata analyzer. Analyze the cover image and provide structured information. Respond ONLY with a valid JSON object (no markdown, no extra text).${langInstruction}`;

  const tagExample = isZh
    ? `(e.g., ["动作", "奇幻", "少年", "机甲"]), 3-8 tags`
    : `(e.g., ["action", "fantasy", "shounen", "mecha"]), 3-8 tags`;
  const genreExample = isZh
    ? `(e.g., "动作, 奇幻, 冒险")`
    : `(e.g., "Action, Fantasy, Adventure")`;

  const userPrompt = `Analyze this comic/manga cover image${existingTitle ? ` (title: "${existingTitle}")` : ""}.

Return a JSON object with these fields:
- tags: array of descriptive tags ${tagExample}
- description: a 1-2 sentence description of what the cover depicts${isZh ? " (in Chinese)" : ""}
- genre: comma-separated genres ${genreExample}
- style: the art style (e.g., "manga", "manhwa", "comic", "webtoon", "illustration")
- language: detected language if text is visible (e.g., "ja", "zh", "en", "ko"), or "unknown"`;

  try {
    const content = await callCloudLLM(config, systemPrompt, userPrompt, {
      base64,
      mimeType,
    });

    if (!content) return null;

    // Parse JSON from response (handle possible markdown code blocks)
    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const result = JSON.parse(jsonStr);

    return {
      tags: Array.isArray(result.tags) ? result.tags : [],
      description: result.description || "",
      genre: result.genre || "",
      style: result.style || "",
      language: result.language || "unknown",
    };
  } catch (err) {
    console.error("Cloud AI analysis failed:", err);
    return null;
  }
}

/**
 * Use Cloud LLM to complete missing metadata fields.
 */
export async function completeMissingMetadata(
  config: AIConfig,
  existingData: {
    title: string;
    author?: string;
    genre?: string;
    description?: string;
    tags?: string[];
  },
  lang?: string
): Promise<{
  author?: string;
  genre?: string;
  description?: string;
  year?: number;
  language?: string;
  suggestedTags?: string[];
} | null> {
  if (!config.enableCloudAI || !config.cloudApiKey) return null;

  const isZh = lang?.startsWith("zh");
  const langInstruction = isZh
    ? `\nIMPORTANT: genre, description, and suggestedTags MUST be in Chinese (简体中文). For example, use "动作" instead of "Action", "奇幻" instead of "Fantasy".`
    : "";

  const systemPrompt = `You are a comic/manga metadata expert. Given partial information about a comic, infer the missing fields. Respond ONLY with a valid JSON object.${langInstruction}`;

  const userPrompt = `Comic information:
- Title: "${existingData.title}"
${existingData.author ? `- Author: "${existingData.author}"` : "- Author: unknown"}
${existingData.genre ? `- Genre: "${existingData.genre}"` : "- Genre: unknown"}
${existingData.description ? `- Description: "${existingData.description}"` : "- Description: none"}
${existingData.tags?.length ? `- Tags: ${existingData.tags.join(", ")}` : "- Tags: none"}

Based on the title and any available information, infer:
- author (if unknown, make your best guess or leave empty string)
- genre (comma-separated${isZh ? ", in Chinese" : ""})
- description (1-2 sentences if none provided${isZh ? ", in Chinese" : ""})
- year (estimated publication year, or null)
- language (ISO code: "ja", "zh", "en", "ko", etc.)
- suggestedTags (array of 3-6 relevant tags${isZh ? ", in Chinese" : ""})

Return a JSON object with these fields. Only include fields you're confident about.`;

  try {
    const content = await callCloudLLM(config, systemPrompt, userPrompt);
    if (!content) return null;

    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error("Metadata completion failed:", err);
    return null;
  }
}

// ============================================================
// Metadata Translation via Cloud LLM
// ============================================================

/**
 * Translate metadata fields to the target language using cloud LLM.
 * Only translates text fields that are not already in the target language.
 */
export async function translateMetadataFields(
  fields: {
    title?: string;
    author?: string;
    description?: string;
    genre?: string;
    seriesName?: string;
    publisher?: string;
  },
  targetLang: string
): Promise<{
  title?: string;
  description?: string;
  genre?: string;
  seriesName?: string;
} | null> {
  const config = loadAIConfig();
  if (!config.enableCloudAI || !config.cloudApiKey) return null;

  // Collect fields that may need translation
  const toTranslate: Record<string, string> = {};
  if (fields.title) toTranslate.title = fields.title;
  if (fields.description) toTranslate.description = fields.description;
  if (fields.genre) toTranslate.genre = fields.genre;
  if (fields.seriesName) toTranslate.seriesName = fields.seriesName;

  if (Object.keys(toTranslate).length === 0) return null;

  const langName = targetLang.startsWith("zh") ? "Chinese (简体中文)" : "English";

  const systemPrompt = `You are a professional translator specializing in manga/comic metadata. Translate the given fields to ${langName}. Keep proper nouns (character names, place names) in their commonly known form in the target language. For genre/tag terms, use standard localized terms.

IMPORTANT:
- If a field is already in the target language, keep it as-is.
- For genre tags (comma-separated), translate each tag individually.
- Respond ONLY with a valid JSON object containing the translated fields.
- Do NOT add any extra fields or explanations.`;

  const userPrompt = `Translate these metadata fields to ${langName}:

${JSON.stringify(toTranslate, null, 2)}

Return a JSON object with the same keys and translated values.`;

  try {
    const content = await callCloudLLM(config, systemPrompt, userPrompt);
    if (!content) return null;

    let jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    // Try to fix common JSON issues from LLM output
    // 1. Try direct parse first
    try {
      return JSON.parse(jsonStr);
    } catch {
      // 2. Try to extract JSON object from the response
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      // 3. Fix truncated strings: find unterminated string values and close them
      // Replace unescaped newlines inside strings
      jsonStr = jsonStr.replace(/(?<=:\s*"[^"]*)\n(?=[^"]*")/g, "\\n");

      // 4. If JSON ends abruptly (truncated), try to close it
      if (!jsonStr.endsWith("}")) {
        // Try to find the last complete key-value pair and close
        const lastCompleteComma = jsonStr.lastIndexOf('",');
        const lastCompleteEnd = jsonStr.lastIndexOf('"}');
        if (lastCompleteComma > lastCompleteEnd) {
          jsonStr = jsonStr.substring(0, lastCompleteComma + 1) + "}";
        } else if (lastCompleteEnd === -1) {
          // Completely truncated, try adding closing quote and brace
          jsonStr = jsonStr.replace(/,?\s*"[^"]*$/, "") + "}";
        }
      }

      try {
        return JSON.parse(jsonStr);
      } catch {
        console.warn("Could not parse AI translation response after fixup, extracting partial results");
        // 5. Last resort: extract individual key-value pairs with regex
        const result: Record<string, string> = {};
        const kvPattern = /"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        let match;
        while ((match = kvPattern.exec(jsonStr)) !== null) {
          result[match[1]] = match[2].replace(/\\n/g, "\n").replace(/\\"/g, '"');
        }
        return Object.keys(result).length > 0 ? result : null;
      }
    }
  } catch (err) {
    console.error("Metadata translation failed:", err);
    return null;
  }
}

// ============================================================
// Unified Cloud LLM Caller — Multi-provider support
// ============================================================

/**
 * Call cloud LLM with unified interface.
 * Handles API format differences between providers:
 * - OpenAI-compatible: Most providers (OpenAI, DeepSeek, Qwen, Zhipu, etc.)
 * - Anthropic: Messages API with different auth header
 * - Google Gemini: generateContent endpoint
 */
async function callCloudLLM(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string,
  image?: { base64: string; mimeType: string }
): Promise<string | null> {
  const provider = config.cloudProvider;
  const apiUrl = config.cloudApiUrl || PROVIDER_PRESETS[provider]?.apiUrl || "";

  if (provider === "anthropic") {
    return callAnthropic(config, apiUrl, systemPrompt, userPrompt, image);
  }

  if (provider === "google") {
    return callGemini(config, apiUrl, systemPrompt, userPrompt, image);
  }

  // OpenAI-compatible format (works for: OpenAI, DeepSeek, Qwen, Zhipu,
  // Doubao, Moonshot, Baichuan, MiniMax, StepFun, Yi, Groq, Mistral, Cohere, etc.)
  return callOpenAICompatible(config, apiUrl, systemPrompt, userPrompt, image);
}

/**
 * OpenAI-compatible chat/completions API.
 * Used by most providers.
 */
async function callOpenAICompatible(
  config: AIConfig,
  apiUrl: string,
  systemPrompt: string,
  userPrompt: string,
  image?: { base64: string; mimeType: string }
): Promise<string | null> {
  const url = `${apiUrl}/chat/completions`;

  // Build user message content
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let userContent: any = userPrompt;
  if (image) {
    userContent = [
      { type: "text", text: userPrompt },
      {
        type: "image_url",
        image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: "low" },
      },
    ];
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.cloudApiKey}`,
    },
    body: JSON.stringify({
      model: config.cloudModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 500,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    console.error(`Cloud AI (${config.cloudProvider}) error:`, response.status, await response.text());
    return null;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || null;
}

/**
 * Anthropic Messages API.
 * Different auth header (x-api-key) and message format.
 */
async function callAnthropic(
  config: AIConfig,
  apiUrl: string,
  systemPrompt: string,
  userPrompt: string,
  image?: { base64: string; mimeType: string }
): Promise<string | null> {
  const url = `${apiUrl}/v1/messages`;

  // Build content blocks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentBlocks: any[] = [];
  if (image) {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType,
        data: image.base64,
      },
    });
  }
  contentBlocks.push({ type: "text", text: userPrompt });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.cloudApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.cloudModel,
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: contentBlocks }],
    }),
  });

  if (!response.ok) {
    console.error("Anthropic API error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  // Anthropic response format: { content: [{ type: "text", text: "..." }] }
  const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
  return textBlock?.text || null;
}

/**
 * Google Gemini generateContent API.
 * Uses API key in URL query param, different request format.
 */
async function callGemini(
  config: AIConfig,
  apiUrl: string,
  systemPrompt: string,
  userPrompt: string,
  image?: { base64: string; mimeType: string }
): Promise<string | null> {
  const model = config.cloudModel || "gemini-2.0-flash";
  const url = `${apiUrl}/models/${model}:generateContent?key=${config.cloudApiKey}`;

  // Build parts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [{ text: `${systemPrompt}\n\n${userPrompt}` }];
  if (image) {
    parts.push({
      inline_data: {
        mime_type: image.mimeType,
        data: image.base64,
      },
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 500,
      },
    }),
  });

  if (!response.ok) {
    console.error("Gemini API error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// ============================================================
// Text Embedding — Simple TF-IDF based (No external model needed)
// ============================================================

/**
 * Simple text vectorizer for semantic search.
 * Uses TF-IDF-like approach with n-grams for lightweight similarity.
 * No external model dependency — works out of the box.
 */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function buildNGrams(tokens: string[], n: number = 2): string[] {
  const grams: string[] = [...tokens]; // unigrams
  for (let i = 0; i < tokens.length - n + 1; i++) {
    grams.push(tokens.slice(i, i + n).join("_"));
  }
  return grams;
}

/**
 * Build a text vector (sparse representation) from comic metadata.
 */
export function buildTextVector(
  title: string,
  tags: string[],
  genre: string,
  author: string,
  description: string
): Map<string, number> {
  const vector = new Map<string, number>();

  // Title tokens get highest weight
  const titleTokens = buildNGrams(tokenize(title));
  for (const t of titleTokens) {
    vector.set(`t:${t}`, (vector.get(`t:${t}`) || 0) + 3);
  }

  // Tags get high weight
  for (const tag of tags) {
    const key = `tag:${tag.toLowerCase()}`;
    vector.set(key, (vector.get(key) || 0) + 5);
  }

  // Genre tokens
  const genreTokens = tokenize(genre);
  for (const g of genreTokens) {
    vector.set(`g:${g}`, (vector.get(`g:${g}`) || 0) + 4);
  }

  // Author
  if (author) {
    vector.set(`a:${author.toLowerCase()}`, 3);
  }

  // Description tokens get lower weight
  const descTokens = buildNGrams(tokenize(description));
  for (const d of descTokens) {
    vector.set(`d:${d}`, (vector.get(`d:${d}`) || 0) + 1);
  }

  return vector;
}

/**
 * Cosine similarity between two sparse vectors.
 */
export function cosineSimilarity(
  v1: Map<string, number>,
  v2: Map<string, number>
): number {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (const [key, val] of v1) {
    norm1 += val * val;
    const other = v2.get(key);
    if (other !== undefined) {
      dotProduct += val * other;
    }
  }

  for (const [, val] of v2) {
    norm2 += val * val;
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Semantic search: find comics similar to a query string.
 */
export function semanticSearch(
  query: string,
  comics: {
    id: string;
    title: string;
    tags: string[];
    genre: string;
    author: string;
    description: string;
  }[],
  limit: number = 10
): { id: string; score: number }[] {
  // Build query vector
  const queryTokens = tokenize(query);
  const queryVector = new Map<string, number>();

  for (const t of queryTokens) {
    // Search across all dimensions
    queryVector.set(`t:${t}`, 3);
    queryVector.set(`tag:${t}`, 5);
    queryVector.set(`g:${t}`, 4);
    queryVector.set(`a:${t}`, 3);
    queryVector.set(`d:${t}`, 1);
  }

  // Score each comic
  const results: { id: string; score: number }[] = [];

  for (const comic of comics) {
    const comicVector = buildTextVector(
      comic.title,
      comic.tags,
      comic.genre,
      comic.author,
      comic.description
    );

    const score = cosineSimilarity(queryVector, comicVector);
    if (score > 0.01) {
      results.push({ id: comic.id, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ============================================================
// AI-Enhanced Recommendation Score
// ============================================================

/**
 * Calculate semantic similarity score between two comics.
 * Used as an additional factor in the recommendation engine.
 */
export function calculateSemanticSimilarity(
  comic1: { title: string; tags: string[]; genre: string; author: string; description: string },
  comic2: { title: string; tags: string[]; genre: string; author: string; description: string }
): number {
  const v1 = buildTextVector(comic1.title, comic1.tags, comic1.genre, comic1.author, comic1.description);
  const v2 = buildTextVector(comic2.title, comic2.tags, comic2.genre, comic2.author, comic2.description);
  return cosineSimilarity(v1, v2);
}

// ============================================================
// Perceptual Hash Cache
// ============================================================

const PHASH_CACHE_PATH = path.join(process.cwd(), ".cache", "phash-cache.json");

interface PHashCache {
  [comicId: string]: string; // comicId -> pHash hex string
}

export function loadPHashCache(): PHashCache {
  try {
    if (fs.existsSync(PHASH_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(PHASH_CACHE_PATH, "utf-8"));
    }
  } catch {
    // ignore
  }
  return {};
}

export function savePHashCache(cache: PHashCache): void {
  const dir = path.dirname(PHASH_CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PHASH_CACHE_PATH, JSON.stringify(cache));
}

/**
 * Find visually similar covers using perceptual hashing.
 * Returns groups of comics with similar covers.
 */
export async function findVisuallySimilarCovers(
  comics: { id: string; filename: string; title: string }[],
  thumbnailDir: string,
  threshold: number = 10 // hamming distance threshold (lower = more strict)
): Promise<{ reason: string; comics: string[] }[]> {
  const cache = loadPHashCache();
  let cacheUpdated = false;

  // Generate hashes for all comics
  const hashes: { id: string; hash: string }[] = [];

  for (const comic of comics) {
    // Check cache first
    if (cache[comic.id]) {
      hashes.push({ id: comic.id, hash: cache[comic.id] });
      continue;
    }

    // Generate hash from thumbnail
    const thumbPath = path.join(thumbnailDir, `${comic.id}.webp`);
    if (!fs.existsSync(thumbPath)) continue;

    try {
      const imgBuffer = fs.readFileSync(thumbPath);
      const hash = await generatePerceptualHash(imgBuffer);
      hashes.push({ id: comic.id, hash });
      cache[comic.id] = hash;
      cacheUpdated = true;
    } catch {
      // skip unreadable thumbnails
    }
  }

  if (cacheUpdated) savePHashCache(cache);

  // Find similar pairs
  const groups: Map<string, Set<string>> = new Map();
  const used = new Set<string>();

  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      const dist = hammingDistance(hashes[i].hash, hashes[j].hash);
      if (dist <= threshold) {
        const key = hashes[i].id;
        if (!groups.has(key)) {
          groups.set(key, new Set([hashes[i].id]));
        }
        groups.get(key)!.add(hashes[j].id);
        used.add(hashes[j].id);
      }
    }
  }

  // Merge overlapping groups
  const result: { reason: string; comics: string[] }[] = [];
  for (const [, members] of groups) {
    if (members.size > 1) {
      result.push({
        reason: "similarCover",
        comics: Array.from(members),
      });
    }
  }

  return result;
}

// ============================================================
// AI Status
// ============================================================

export interface AIStatus {
  localAI: {
    available: boolean;
    perceptualHash: boolean;
    semanticSearch: boolean;
    autoTag: boolean;
  };
  cloudAI: {
    configured: boolean;
    provider: string;
    model: string;
  };
  stats: {
    pHashCacheSize: number;
  };
}

export function getAIStatus(): AIStatus {
  const config = loadAIConfig();
  const cache = loadPHashCache();

  return {
    localAI: {
      available: true,
      perceptualHash: config.enablePerceptualHash,
      semanticSearch: config.enableSemanticSearch,
      autoTag: config.enableAutoTag,
    },
    cloudAI: {
      configured: config.enableCloudAI && !!config.cloudApiKey,
      provider: config.cloudProvider,
      model: config.cloudModel,
    },
    stats: {
      pHashCacheSize: Object.keys(cache).length,
    },
  };
}
