"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Cloud,
  Eye,
  Loader2,
  ChevronDown,
  RefreshCw,
  Edit3,
  Settings2,
  BarChart3,
  Trash2,
  Zap,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

type CloudProvider =
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

interface ProviderPreset {
  name: string;
  apiUrl: string;
  defaultModel: string;
  models: string[];
  supportsVision: boolean;
  region: "international" | "china";
}

// Must match PROVIDER_PRESETS in ai-service.ts
const PROVIDER_PRESETS: Record<CloudProvider, ProviderPreset> = {
  openai: { name: "OpenAI", apiUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", models: ["gpt-4o", "gpt-4o-mini", "gpt-4.5-preview", "o1", "o1-mini", "o3-mini"], supportsVision: true, region: "international" },
  anthropic: { name: "Anthropic (Claude)", apiUrl: "https://api.anthropic.com", defaultModel: "claude-sonnet-4-20250514", models: ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022", "claude-3-5-sonnet-20241022"], supportsVision: true, region: "international" },
  google: { name: "Google Gemini", apiUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.0-flash", models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"], supportsVision: true, region: "international" },
  groq: { name: "Groq", apiUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"], supportsVision: false, region: "international" },
  mistral: { name: "Mistral AI", apiUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-small-latest", models: ["mistral-large-latest", "mistral-small-latest", "pixtral-large-latest", "codestral-latest"], supportsVision: true, region: "international" },
  cohere: { name: "Cohere", apiUrl: "https://api.cohere.com/v2", defaultModel: "command-r-plus", models: ["command-r-plus", "command-r", "command-light"], supportsVision: false, region: "international" },
  deepseek: { name: "DeepSeek (深度求索)", apiUrl: "https://api.deepseek.com", defaultModel: "deepseek-chat", models: ["deepseek-chat", "deepseek-reasoner"], supportsVision: false, region: "china" },
  zhipu: { name: "Zhipu AI (智谱清言)", apiUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4v-flash", models: ["glm-4v-flash", "glm-4-flash", "glm-4-plus", "glm-4-long", "glm-4v-plus"], supportsVision: true, region: "china" },
  qwen: { name: "Alibaba Qwen (通义千问)", apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-vl-plus", models: ["qwen-turbo", "qwen-plus", "qwen-max", "qwen-vl-plus", "qwen-vl-max"], supportsVision: true, region: "china" },
  doubao: { name: "Doubao (豆包/字节跳动)", apiUrl: "https://ark.cn-beijing.volces.com/api/v3", defaultModel: "doubao-1.5-pro-32k", models: ["doubao-1.5-pro-32k", "doubao-1.5-lite-32k", "doubao-1.5-vision-pro-32k"], supportsVision: true, region: "china" },
  moonshot: { name: "Moonshot AI (月之暗面)", apiUrl: "https://api.moonshot.cn/v1", defaultModel: "moonshot-v1-8k", models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"], supportsVision: false, region: "china" },
  baichuan: { name: "Baichuan (百川智能)", apiUrl: "https://api.baichuan-ai.com/v1", defaultModel: "Baichuan4", models: ["Baichuan4", "Baichuan3-Turbo", "Baichuan3-Turbo-128k"], supportsVision: false, region: "china" },
  minimax: { name: "MiniMax", apiUrl: "https://api.minimax.chat/v1", defaultModel: "MiniMax-Text-01", models: ["MiniMax-Text-01", "abab6.5s-chat"], supportsVision: false, region: "china" },
  stepfun: { name: "StepFun (阶跃星辰)", apiUrl: "https://api.stepfun.com/v1", defaultModel: "step-1v-8k", models: ["step-2-16k", "step-1-8k", "step-1v-8k", "step-1v-32k"], supportsVision: true, region: "china" },
  yi: { name: "Yi (零一万物)", apiUrl: "https://api.lingyiwanwu.com/v1", defaultModel: "yi-vision", models: ["yi-large", "yi-medium", "yi-vision", "yi-large-turbo"], supportsVision: true, region: "china" },
  compatible: { name: "Custom (OpenAI Compatible)", apiUrl: "", defaultModel: "", models: [], supportsVision: true, region: "international" },
};

const INTERNATIONAL_PROVIDERS: CloudProvider[] = ["openai", "anthropic", "google", "groq", "mistral", "cohere"];
const CHINA_PROVIDERS: CloudProvider[] = ["deepseek", "zhipu", "qwen", "doubao", "moonshot", "baichuan", "minimax", "stepfun", "yi"];

interface AIConfig {
  enableCloudAI: boolean;
  cloudProvider: CloudProvider;
  cloudApiKey: string;
  cloudApiUrl: string;
  cloudModel: string;
  maxTokens: number;
  maxRetries: number;
}

interface AIStatus {
  cloudAI: {
    configured: boolean;
    provider: string;
    model: string;
  };
}

interface AIUsageStats {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalPromptTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  avgDurationMs: number;
  byScenario: Record<string, number>;
  byProvider: Record<string, number>;
  records: Array<{
    timestamp: string;
    provider: string;
    model: string;
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
    scenario: string;
    success: boolean;
    durationMs: number;
  }>;
}

export function AISettingsPanel() {
  const t = useTranslation();
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<{ id: string; name?: string }[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [modelMode, setModelMode] = useState<"preset" | "fetch" | "manual">("preset");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [usageStats, setUsageStats] = useState<AIUsageStats | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const aiT = t.ai || {} as Record<string, string>;

  useEffect(() => {
    Promise.all([
      fetch("/api/ai/settings").then((r) => r.json()),
      fetch("/api/ai/status").then((r) => r.json()),
    ]).then(([cfg, st]) => {
      setConfig({
        ...cfg,
        maxTokens: cfg.maxTokens || 2000,
        maxRetries: cfg.maxRetries ?? 2,
      });
      setStatus(st);
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      await fetch("/api/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      // Refresh status
      const st = await fetch("/api/ai/status").then((r) => r.json());
      setStatus(st);
    } finally {
      setSaving(false);
    }
  }, [config]);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // 先保存配置
      if (config) {
        await fetch("/api/ai/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
      }
      const res = await fetch("/api/ai/test", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTestResult({ success: true, message: aiT.connectionSuccess || "Connection OK" });
      } else {
        setTestResult({ success: false, message: data.error || (aiT.connectionFailed || "Connection Failed") });
      }
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : "Error" });
    } finally {
      setTesting(false);
    }
  }, [config, aiT]);

  const handleLoadUsage = useCallback(async () => {
    setLoadingUsage(true);
    try {
      const res = await fetch("/api/ai/usage");
      const data = await res.json();
      setUsageStats(data);
    } finally {
      setLoadingUsage(false);
    }
  }, []);

  const handleResetUsage = useCallback(async () => {
    if (!confirm(aiT.resetUsageConfirm || "Are you sure you want to reset AI usage statistics?")) return;
    await fetch("/api/ai/usage", { method: "DELETE" });
    setUsageStats(null);
    handleLoadUsage();
  }, [aiT, handleLoadUsage]);

  const handleFetchModels = useCallback(async () => {
    if (!config) return;
    setFetchingModels(true);
    setFetchError(null);
    try {
      // Save config first to ensure server has the latest API key
      await fetch("/api/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      const params = new URLSearchParams({
        provider: config.cloudProvider,
        apiUrl: config.cloudApiUrl,
      });
      const res = await fetch(`/api/ai/models?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (Array.isArray(data.models) && data.models.length > 0) {
        setFetchedModels(data.models);
        setModelMode("fetch");
        // Auto-select current model if in list, otherwise select first
        const found = data.models.find(
          (m: { id: string }) => m.id === config.cloudModel
        );
        if (!found) {
          setConfig({ ...config, cloudModel: data.models[0].id });
        }
      } else {
        setFetchError(aiT.noModelsFound || "No models found");
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setFetchingModels(false);
    }
  }, [config, aiT]);

  if (!config) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Brain className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-medium text-foreground">
          {aiT.title || "AI Features"}
        </h3>
      </div>

      {/* Cloud AI Section */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-medium text-foreground">
              {aiT.cloudAI || "Cloud AI"}
            </span>
          </div>
          <ToggleSwitch
            checked={config.enableCloudAI}
            onChange={(v) => setConfig({ ...config, enableCloudAI: v })}
          />
        </div>

        {config.enableCloudAI && (
          <div className="space-y-3 border-t border-border/30 pt-3">
            {/* Provider */}
            <div className="space-y-1.5">
              <span className="text-xs text-muted">
                {aiT.provider || "Provider"}
              </span>
              <div className="relative">
                <select
                  value={config.cloudProvider}
                  onChange={(e) => {
                    const provider = e.target.value as CloudProvider;
                    const preset = PROVIDER_PRESETS[provider];
                    setConfig({
                      ...config,
                      cloudProvider: provider,
                      cloudApiUrl: preset.apiUrl,
                      cloudModel: preset.defaultModel,
                    });
                    // Reset model mode & fetched list on provider change
                    setModelMode("preset");
                    setFetchedModels([]);
                    setFetchError(null);
                  }}
                  className="w-full appearance-none rounded-lg border border-border bg-card px-3 py-2 pr-8 text-xs text-foreground outline-none"
                >
                  <optgroup label={aiT.internationalProviders || "International"}>
                    {INTERNATIONAL_PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_PRESETS[p].name}
                        {PROVIDER_PRESETS[p].supportsVision ? " 👁" : ""}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={aiT.chinaProviders || "China (国内)"}>
                    {CHINA_PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_PRESETS[p].name}
                        {PROVIDER_PRESETS[p].supportsVision ? " 👁" : ""}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={aiT.customProvider || "Custom"}>
                    <option value="compatible">
                      {PROVIDER_PRESETS.compatible.name}
                    </option>
                  </optgroup>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              </div>
            </div>

            {/* API URL */}
            <div className="space-y-1.5 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
              <span className="block text-xs text-muted sm:w-20 sm:shrink-0">API URL</span>
              <input
                type="text"
                value={config.cloudApiUrl}
                onChange={(e) => setConfig({ ...config, cloudApiUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
                className="w-full sm:flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted/50"
              />
            </div>

            {/* API Key */}
            <div className="space-y-1.5 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
              <span className="block text-xs text-muted sm:w-20 sm:shrink-0">API Key</span>
              <div className="relative w-full sm:flex-1">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={config.cloudApiKey}
                  onChange={(e) => setConfig({ ...config, cloudApiKey: e.target.value })}
                  placeholder={config.cloudProvider === "google" ? "AIza..." : "sk-..."}
                  className="w-full rounded-lg border border-border bg-card px-2 py-1.5 pr-14 text-xs text-foreground outline-none placeholder:text-muted/50"
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground"
                >
                  <Eye className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* Model selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">
                  {aiT.model || "Model"}
                </span>
                <div className="flex items-center gap-1">
                  {/* Mode toggle buttons */}
                  <button
                    onClick={() => setModelMode("preset")}
                    title={aiT.presetModels || "Preset models"}
                    className={`rounded p-1 text-[10px] transition-colors ${
                      modelMode === "preset"
                        ? "bg-accent/20 text-accent"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  <button
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !config.cloudApiKey}
                    title={aiT.fetchModels || "Fetch models from API"}
                    className={`rounded p-1 text-[10px] transition-colors disabled:opacity-40 ${
                      modelMode === "fetch"
                        ? "bg-accent/20 text-accent"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {fetchingModels ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    onClick={() => setModelMode("manual")}
                    title={aiT.manualInput || "Manual input"}
                    className={`rounded p-1 text-[10px] transition-colors ${
                      modelMode === "manual"
                        ? "bg-accent/20 text-accent"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    <Edit3 className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {/* Preset mode: dropdown of hardcoded models */}
              {modelMode === "preset" && PROVIDER_PRESETS[config.cloudProvider]?.models.length > 0 && (
                <div className="relative">
                  <select
                    value={config.cloudModel}
                    onChange={(e) => setConfig({ ...config, cloudModel: e.target.value })}
                    className="w-full appearance-none rounded-lg border border-border bg-card px-2 py-1.5 pr-8 text-xs text-foreground outline-none"
                  >
                    {PROVIDER_PRESETS[config.cloudProvider].models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
                </div>
              )}

              {/* Preset mode fallback: no preset models → show text input */}
              {modelMode === "preset" && (!PROVIDER_PRESETS[config.cloudProvider]?.models.length) && (
                <input
                  type="text"
                  value={config.cloudModel}
                  onChange={(e) => setConfig({ ...config, cloudModel: e.target.value })}
                  placeholder="model-name"
                  className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted/50"
                />
              )}

              {/* Fetch mode: dropdown of dynamically fetched models */}
              {modelMode === "fetch" && fetchedModels.length > 0 && (
                <div className="relative">
                  <select
                    value={config.cloudModel}
                    onChange={(e) => setConfig({ ...config, cloudModel: e.target.value })}
                    className="w-full appearance-none rounded-lg border border-border bg-card px-2 py-1.5 pr-8 text-xs text-foreground outline-none"
                  >
                    {fetchedModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
                </div>
              )}

              {/* Fetch mode: no fetched models yet */}
              {modelMode === "fetch" && fetchedModels.length === 0 && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={config.cloudModel}
                    onChange={(e) => setConfig({ ...config, cloudModel: e.target.value })}
                    placeholder="model-name"
                    className="flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted/50"
                  />
                  <button
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !config.cloudApiKey}
                    className="shrink-0 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-card-hover disabled:opacity-50"
                  >
                    {fetchingModels ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <span>{aiT.fetchModels || "Fetch"}</span>
                    )}
                  </button>
                </div>
              )}

              {/* Manual mode: free text input */}
              {modelMode === "manual" && (
                <input
                  type="text"
                  value={config.cloudModel}
                  onChange={(e) => setConfig({ ...config, cloudModel: e.target.value })}
                  placeholder={aiT.manualModelPlaceholder || "Enter model name, e.g. gpt-4o"}
                  className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted/50"
                />
              )}

              {/* Fetch error message */}
              {fetchError && (
                <p className="text-[10px] text-red-400">{fetchError}</p>
              )}

              {/* Fetch mode: model count hint */}
              {modelMode === "fetch" && fetchedModels.length > 0 && (
                <p className="text-[10px] text-muted">
                  {(aiT.modelsFetched || "{count} models fetched").replace("{count}", String(fetchedModels.length))}
                </p>
              )}
            </div>

            {/* Test Connection Button */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleTestConnection}
                disabled={testing || !config.cloudApiKey}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-card-hover disabled:opacity-50"
              >
                {testing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                {testing ? (aiT.testing || "Testing...") : (aiT.testConnection || "Test Connection")}
              </button>
              {testResult && (
                <span className={`flex items-center gap-1 text-[10px] ${testResult.success ? "text-green-400" : "text-red-400"}`}>
                  {testResult.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  {testResult.message}
                </span>
              )}
            </div>

            {/* Advanced Settings */}
            <div className="border-t border-border/30 pt-3">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {aiT.advancedSettings || "Advanced Settings"}
                <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-3">
                  {/* Max Tokens */}
                  <div className="space-y-1.5 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
                    <span className="block text-xs text-muted sm:w-28 sm:shrink-0">
                      {aiT.maxTokens || "Max Output Tokens"}
                    </span>
                    <input
                      type="number"
                      min={100}
                      max={32000}
                      step={100}
                      value={config.maxTokens}
                      onChange={(e) => setConfig({ ...config, maxTokens: Math.max(100, Math.min(32000, parseInt(e.target.value) || 2000)) })}
                      className="w-full sm:flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-muted/70 pl-0 sm:pl-[7.5rem]">
                    {aiT.maxTokensHint || "Maximum tokens per AI response (default 2000)"}
                  </p>

                  {/* Max Retries */}
                  <div className="space-y-1.5 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
                    <span className="block text-xs text-muted sm:w-28 sm:shrink-0">
                      {aiT.maxRetries || "Retry Count"}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={5}
                      value={config.maxRetries}
                      onChange={(e) => setConfig({ ...config, maxRetries: Math.max(0, Math.min(5, parseInt(e.target.value) || 0)) })}
                      className="w-full sm:flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-muted/70 pl-0 sm:pl-[7.5rem]">
                    {aiT.maxRetriesHint || "Auto-retry count on API failure (0-5)"}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Usage Stats Section */}
      {config.enableCloudAI && (
        <div className="space-y-3 rounded-xl bg-background p-4">
          <button
            onClick={() => {
              setShowUsage(!showUsage);
              if (!showUsage && !usageStats) handleLoadUsage();
            }}
            className="flex w-full items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-green-400" />
              <span className="text-sm font-medium text-foreground">
                {aiT.usage || "Usage Stats"}
              </span>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted transition-transform ${showUsage ? "rotate-180" : ""}`} />
          </button>

          {showUsage && (
            <div className="border-t border-border/30 pt-3 space-y-3">
              {loadingUsage ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted" />
                </div>
              ) : usageStats && usageStats.totalCalls > 0 ? (
                <>
                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-lg bg-card p-2.5">
                      <div className="text-[10px] text-muted">{aiT.totalCalls || "Total Calls"}</div>
                      <div className="text-lg font-semibold text-foreground">{usageStats.totalCalls}</div>
                      <div className="flex gap-2 text-[10px]">
                        <span className="text-green-400">✓ {usageStats.successCalls}</span>
                        <span className="text-red-400">✗ {usageStats.failedCalls}</span>
                      </div>
                    </div>
                    <div className="rounded-lg bg-card p-2.5">
                      <div className="text-[10px] text-muted">{aiT.totalTokens || "Total Tokens"}</div>
                      <div className="text-lg font-semibold text-foreground">{usageStats.totalTokens.toLocaleString()}</div>
                      <div className="flex gap-2 text-[10px] text-muted">
                        <span>↑{usageStats.totalPromptTokens.toLocaleString()}</span>
                        <span>↓{usageStats.totalOutputTokens.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="rounded-lg bg-card p-2.5">
                      <div className="text-[10px] text-muted">{aiT.avgDuration || "Avg Duration"}</div>
                      <div className="text-lg font-semibold text-foreground">{usageStats.avgDurationMs}ms</div>
                    </div>
                    <div className="rounded-lg bg-card p-2.5">
                      <div className="text-[10px] text-muted">{aiT.scenario || "Scenario"}</div>
                      <div className="mt-1 space-y-0.5">
                        {Object.entries(usageStats.byScenario).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-[10px]">
                            <span className="text-muted">{k || "unknown"}</span>
                            <span className="text-foreground">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Recent Records */}
                  {usageStats.records.length > 0 && (
                    <div>
                      <div className="text-xs text-muted mb-2">{aiT.recentCalls || "Recent Calls"}</div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {usageStats.records.slice().reverse().slice(0, 20).map((r, i) => (
                          <div key={i} className="flex items-center justify-between rounded bg-card px-2 py-1 text-[10px]">
                            <div className="flex items-center gap-2">
                              <span className={r.success ? "text-green-400" : "text-red-400"}>
                                {r.success ? "✓" : "✗"}
                              </span>
                              <span className="text-muted">{r.scenario || "-"}</span>
                              <span className="text-foreground">{r.model}</span>
                            </div>
                            <div className="flex items-center gap-3 text-muted">
                              <span>{r.totalTokens > 0 ? `${r.totalTokens} tok` : "-"}</span>
                              <span>{r.durationMs}ms</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reset Button */}
                  <button
                    onClick={handleResetUsage}
                    className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3 w-3" />
                    {aiT.resetUsage || "Reset Stats"}
                  </button>
                </>
              ) : (
                <p className="text-xs text-muted py-2">{aiT.noUsageData || "No usage data yet"}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {aiT.saving || "Saving..."}
          </span>
        ) : (
          aiT.saveSettings || t.common.save || "Save"
        )}
      </button>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-border"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
