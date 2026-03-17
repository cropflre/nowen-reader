"use client";

import { useState, useCallback } from "react";
import { Languages, Loader2, X, ChevronDown, ChevronUp } from "lucide-react";

interface TranslatedBubble {
  original: string;
  translated: string;
  position: string;
  type: string;
  speaker: string;
}

interface PageTranslation {
  bubbles: TranslatedBubble[];
  rawText: string;
  summary: string;
}

interface PageTranslateOverlayProps {
  comicId: string;
  pageIndex: number;
  locale: string;
  readerTheme?: "day" | "night";
}

const TYPE_LABELS: Record<string, { zh: string; en: string; color: string }> = {
  dialog: { zh: "对话", en: "Dialog", color: "bg-blue-500/20 text-blue-300" },
  narration: { zh: "旁白", en: "Narration", color: "bg-amber-500/20 text-amber-300" },
  sfx: { zh: "音效", en: "SFX", color: "bg-red-500/20 text-red-300" },
  sign: { zh: "文字", en: "Sign", color: "bg-green-500/20 text-green-300" },
  thought: { zh: "心声", en: "Thought", color: "bg-purple-500/20 text-purple-300" },
};

export default function PageTranslateOverlay({
  comicId,
  pageIndex,
  locale,
  readerTheme = "night",
}: PageTranslateOverlayProps) {
  const [translation, setTranslation] = useState<PageTranslation | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState("");

  const isDark = readerTheme === "night";

  const handleTranslate = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    setTranslation(null);
    setShowPanel(true);
    setCollapsed(false);

    try {
      const res = await fetch(`/api/comics/${comicId}/ai-translate-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageIndex,
          targetLang: locale,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || "Request failed");
      }

      const data = await res.json();
      setTranslation(data.translation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [comicId, pageIndex, locale, loading]);

  return (
    <>
      {/* 翻译按钮 */}
      <button
        onClick={handleTranslate}
        disabled={loading}
        className={`fixed bottom-20 right-20 z-30 flex h-12 w-12 items-center justify-center rounded-full shadow-lg backdrop-blur-sm transition-all hover:scale-110 disabled:opacity-50 ${
          showPanel
            ? "bg-blue-500/80 hover:bg-blue-500"
            : "bg-blue-500/60 hover:bg-blue-500/80"
        }`}
        title={locale === "zh" ? "翻译当前页" : "Translate Page"}
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-white" />
        ) : (
          <Languages className="h-5 w-5 text-white" />
        )}
      </button>

      {/* 翻译结果面板 */}
      {showPanel && (
        <div
          className={`fixed bottom-4 left-4 z-50 flex max-h-[70vh] w-[340px] flex-col overflow-hidden rounded-2xl shadow-2xl backdrop-blur-xl transition-all ${
            isDark
              ? "border border-white/10 bg-zinc-900/95 text-white"
              : "border border-gray-200 bg-white/95 text-gray-900"
          }`}
        >
          {/* Header */}
          <div
            className={`flex items-center justify-between border-b px-4 py-3 ${
              isDark ? "border-white/10" : "border-gray-200"
            }`}
          >
            <div className="flex items-center gap-2">
              <Languages className="h-4 w-4 text-blue-400" />
              <span className="text-sm font-medium">
                {locale === "zh" ? "页面翻译" : "Page Translation"}
              </span>
              {translation?.bubbles && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  isDark ? "bg-white/10 text-white/50" : "bg-gray-100 text-gray-500"
                }`}>
                  {translation.bubbles.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCollapsed(!collapsed)}
                className={`rounded-lg p-1.5 transition-colors ${
                  isDark ? "hover:bg-white/10" : "hover:bg-gray-100"
                }`}
              >
                {collapsed ? <ChevronUp className="h-3.5 w-3.5 opacity-50" /> : <ChevronDown className="h-3.5 w-3.5 opacity-50" />}
              </button>
              <button
                onClick={() => setShowPanel(false)}
                className={`rounded-lg p-1.5 transition-colors ${
                  isDark ? "hover:bg-white/10" : "hover:bg-gray-100"
                }`}
              >
                <X className="h-4 w-4 opacity-50" />
              </button>
            </div>
          </div>

          {/* Content */}
          {!collapsed && (
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {/* Loading */}
              {loading && (
                <div className="flex flex-col items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
                  <p className={`mt-2 text-xs ${isDark ? "text-white/40" : "text-gray-400"}`}>
                    {locale === "zh" ? "正在识别并翻译页面文字..." : "Detecting and translating text..."}
                  </p>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">
                  ❌ {error}
                </div>
              )}

              {/* Summary */}
              {translation?.summary && (
                <div className={`rounded-lg p-3 text-xs ${
                  isDark ? "bg-blue-500/5 text-blue-400/70" : "bg-blue-50 text-blue-500/70"
                }`}>
                  📄 {translation.summary}
                </div>
              )}

              {/* Bubbles */}
              {translation?.bubbles && translation.bubbles.length > 0 && (
                <div className="space-y-2">
                  {translation.bubbles.map((bubble, i) => {
                    const typeInfo = TYPE_LABELS[bubble.type] || TYPE_LABELS.dialog;
                    return (
                      <div
                        key={i}
                        className={`rounded-xl p-3 ${
                          isDark ? "bg-white/5" : "bg-gray-50"
                        }`}
                      >
                        {/* Type + Speaker + Position */}
                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px]">
                          <span className={`rounded px-1.5 py-0.5 ${typeInfo.color}`}>
                            {locale === "zh" ? typeInfo.zh : typeInfo.en}
                          </span>
                          {bubble.speaker && (
                            <span className={isDark ? "text-white/40" : "text-gray-400"}>
                              {bubble.speaker}
                            </span>
                          )}
                          <span className={`ml-auto ${isDark ? "text-white/20" : "text-gray-300"}`}>
                            {bubble.position}
                          </span>
                        </div>

                        {/* Original text */}
                        <p className={`text-xs leading-relaxed ${
                          isDark ? "text-white/40" : "text-gray-400"
                        }`}>
                          {bubble.original}
                        </p>

                        {/* Translated text */}
                        <p className={`mt-1 text-xs font-medium leading-relaxed ${
                          isDark ? "text-white/90" : "text-gray-800"
                        }`}>
                          {bubble.translated}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* No text found */}
              {translation && (!translation.bubbles || translation.bubbles.length === 0) && !loading && (
                <div className={`py-8 text-center text-xs ${isDark ? "text-white/30" : "text-gray-400"}`}>
                  {locale === "zh" ? "未检测到文字内容" : "No text detected on this page"}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
