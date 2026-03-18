"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { MessageCircle, Send, X, Loader2, Trash2, Brain } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AIChatPanelProps {
  comicId: string;
  locale: string;
  /** 小说：当前章节文本 */
  contextText?: string;
  /** 漫画：当前页图片 URL (会自动 fetch 为 base64) */
  contextImageUrl?: string;
  /** 当前页/章节标识（变化时提示"上下文已更新"） */
  contextLabel?: string;
  /** 阅读主题 */
  readerTheme?: "day" | "night";
}

export default function AIChatPanel({
  comicId,
  locale,
  contextText,
  contextImageUrl,
  contextLabel,
  readerTheme = "night",
}: AIChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 拖拽状态
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  // 检测移动端
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // 拖拽处理 - 鼠标
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  }, [position, isMobile]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // 拖拽处理 - 触摸
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isMobile) return; // 移动端用全屏模式，不需要拖拽
    const touch = e.touches[0];
    setIsDragging(true);
    dragStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      posX: position.x,
      posY: position.y,
    };
  }, [position, isMobile]);

  useEffect(() => {
    if (!isDragging) return;

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const dx = touch.clientX - dragStartRef.current.x;
      const dy = touch.clientY - dragStartRef.current.y;
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy,
      });
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleTouchEnd);
    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isDragging]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // 打开时聚焦输入框
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // 发送消息
  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || isLoading) return;

    setInput("");
    const userMsg: ChatMessage = { role: "user", content: question };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setStreamingContent("");

    try {
      // 构建请求体
      const body: Record<string, unknown> = {
        comicId,
        targetLang: locale,
        question,
        history: messages.slice(-12), // 最近 12 条对话
      };

      // 小说上下文
      if (contextText) {
        body.contextText = contextText.length > 3000
          ? contextText.slice(0, 3000) + "\n...[truncated]..."
          : contextText;
      }

      // 漫画图片上下文 — 将图片 URL 转为 base64
      if (contextImageUrl && !contextText) {
        try {
          const imgRes = await fetch(contextImageUrl);
          if (imgRes.ok) {
            const blob = await imgRes.blob();
            const base64 = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                resolve(result.split(",")[1] || "");
              };
              reader.readAsDataURL(blob);
            });
            if (base64) {
              body.contextImage = {
                base64,
                mimeType: blob.type || "image/jpeg",
              };
            }
          }
        } catch {
          // 图片获取失败不影响对话
        }
      }

      // SSE 流式请求
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Request failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          try {
            const chunk = JSON.parse(data);
            if (chunk.error) {
              throw new Error(chunk.error);
            }
            if (chunk.content) {
              fullContent += chunk.content;
              setStreamingContent(fullContent);
            }
            if (chunk.done) {
              break;
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      // 流结束，添加 assistant 消息
      if (fullContent) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: fullContent },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `❌ ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ]);
    } finally {
      setIsLoading(false);
      setStreamingContent("");
    }
  }, [input, isLoading, comicId, locale, messages, contextText, contextImageUrl]);

  const handleClear = () => {
    setMessages([]);
    setStreamingContent("");
  };

  const isDark = readerTheme === "night";

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/80 shadow-lg backdrop-blur-sm transition-all hover:bg-purple-500 hover:scale-110"
        title="AI 阅读助手"
      >
        <Brain className="h-5 w-5 text-white" />
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      className={`fixed z-50 flex flex-col overflow-hidden shadow-2xl backdrop-blur-xl transition-colors ${
        isMobile
          ? "inset-0 rounded-none"
          : "bottom-4 right-4 h-[500px] w-[360px] rounded-2xl"
      } ${
        isDark
          ? "border border-white/10 bg-zinc-900/95 text-white"
          : "border border-gray-200 bg-white/95 text-gray-900"
      }`}
      style={
        !isMobile
          ? {
              transform: `translate(${position.x}px, ${position.y}px)`,
              transition: isDragging ? "none" : undefined,
            }
          : undefined
      }
    >
      {/* Header - 可拖拽区域 */}
      <div
        className={`flex items-center justify-between border-b px-4 py-3 ${
          isDark ? "border-white/10" : "border-gray-200"
        } ${!isMobile ? "cursor-move select-none" : ""}`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-medium">
            {locale === "zh" ? "AI 阅读助手" : "AI Reading Assistant"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            className={`rounded-lg p-1.5 transition-colors ${
              isDark ? "hover:bg-white/10" : "hover:bg-gray-100"
            }`}
            title={locale === "zh" ? "清空对话" : "Clear chat"}
          >
            <Trash2 className="h-3.5 w-3.5 opacity-50" />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className={`rounded-lg p-1.5 transition-colors ${
              isDark ? "hover:bg-white/10" : "hover:bg-gray-100"
            }`}
          >
            <X className="h-4 w-4 opacity-50" />
          </button>
        </div>
      </div>

      {/* Context indicator */}
      {contextLabel && (
        <div
          className={`border-b px-4 py-1.5 text-[10px] ${
            isDark
              ? "border-white/5 bg-purple-500/5 text-purple-400/60"
              : "border-gray-100 bg-purple-50 text-purple-500/60"
          }`}
        >
          📖 {contextLabel}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streamingContent && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <MessageCircle
                className={`mx-auto h-8 w-8 ${isDark ? "text-white/10" : "text-gray-200"}`}
              />
              <p
                className={`mt-2 text-xs ${isDark ? "text-white/30" : "text-gray-400"}`}
              >
                {locale === "zh"
                  ? "问任何关于当前阅读内容的问题"
                  : "Ask anything about what you're reading"}
              </p>
              <div
                className={`mt-3 space-y-1 text-[10px] ${
                  isDark ? "text-white/20" : "text-gray-300"
                }`}
              >
                <p>💡 {locale === "zh" ? "这个角色是谁？" : "Who is this character?"}</p>
                <p>💡 {locale === "zh" ? "这段文字什么意思？" : "What does this part mean?"}</p>
                <p>💡 {locale === "zh" ? "帮我翻译这一页" : "Translate this page for me"}</p>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                msg.role === "user"
                  ? "bg-purple-500 text-white"
                  : isDark
                    ? "bg-white/5 text-white/80"
                    : "bg-gray-100 text-gray-700"
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {/* Streaming content */}
        {streamingContent && (
          <div className="flex justify-start">
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                isDark ? "bg-white/5 text-white/80" : "bg-gray-100 text-gray-700"
              }`}
            >
              <p className="whitespace-pre-wrap">{streamingContent}</p>
              <span className="inline-block h-3 w-1 animate-pulse bg-purple-400 ml-0.5" />
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && !streamingContent && (
          <div className="flex justify-start">
            <div
              className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-xs ${
                isDark ? "bg-white/5 text-white/40" : "bg-gray-100 text-gray-400"
              }`}
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              {locale === "zh" ? "思考中..." : "Thinking..."}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className={`border-t p-3 ${isDark ? "border-white/10" : "border-gray-200"}`}
      >
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                handleSend();
              }
            }}
            placeholder={
              locale === "zh" ? "输入你的问题..." : "Ask a question..."
            }
            disabled={isLoading}
            className={`flex-1 rounded-xl border px-3 py-2 text-xs outline-none transition-colors ${
              isDark
                ? "border-white/10 bg-white/5 text-white placeholder-white/20 focus:border-purple-500/50"
                : "border-gray-200 bg-gray-50 text-gray-900 placeholder-gray-400 focus:border-purple-400"
            } disabled:opacity-50`}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500 text-white transition-all hover:bg-purple-600 disabled:opacity-30 disabled:pointer-events-none"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
