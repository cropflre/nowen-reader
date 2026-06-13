"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ReaderTheme } from "./ReaderToolbar";

// PDF.js 类型
type PDFDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;

interface PdfViewProps {
  comicId: string;
  totalPages: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onTotalPagesChange?: (total: number) => void;
  onTapCenter: () => void;
  readerTheme: ReaderTheme;
}

export default function PdfView({
  comicId,
  totalPages,
  currentPage,
  onPageChange,
  onTotalPagesChange,
  onTapCenter,
  readerTheme,
}: PdfViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [scale, setScale] = useState(1);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  // 检测微信浏览器
  const isWeChatBrowser = useCallback(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes("micromessenger") || ua.includes("wechat");
  }, []);

  // 检测受限浏览器（夸克、UC、百度等低版本内核）
  const isRestrictedBrowser = useCallback(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes("quark") || ua.includes("ucbrowser") || ua.includes("baiduboxapp");
  }, []);

  // 触摸手势状态
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);
  const lastTapRef = useRef<number>(0);
  // 标记touch事件已处理翻页，防止后续合成click再次触发
  const touchHandledRef = useRef(false);

  // 加载 PDF 文档
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);

      try {
        // ============================================================
        // Polyfill: Uint8Array.prototype.toHex / fromHex / setFromHex
        // pdfjs-dist 5.x 使用了 ES2024 的 Uint8Array hex 方法，
        // 夸克浏览器、UC 浏览器等低版本 Chromium 内核不支持，需要 polyfill
        // ============================================================
        if (typeof Uint8Array.prototype.toHex !== "function") {
          Uint8Array.prototype.toHex = function () {
            const hex: string[] = [];
            for (let i = 0; i < this.length; i++) {
              hex.push(this[i].toString(16).padStart(2, "0"));
            }
            return hex.join("");
          };
        }

        if (typeof Uint8Array.fromHex !== "function") {
          Uint8Array.fromHex = function (hexString: string) {
            if (hexString.length % 2 !== 0) {
              throw new SyntaxError("Invalid hex string");
            }
            const bytes = new Uint8Array(hexString.length / 2);
            for (let i = 0; i < hexString.length; i += 2) {
              const byte = parseInt(hexString.substring(i, i + 2), 16);
              if (isNaN(byte)) {
                throw new SyntaxError("Invalid hex string");
              }
              bytes[i / 2] = byte;
            }
            return bytes;
          };
        }

        if (typeof Uint8Array.prototype.setFromHex !== "function") {
          Uint8Array.prototype.setFromHex = function (hexString: string) {
            if (hexString.length % 2 !== 0) {
              throw new SyntaxError("Invalid hex string");
            }
            const byteLength = hexString.length / 2;
            const written = Math.min(byteLength, this.length);
            for (let i = 0; i < written; i++) {
              const byte = parseInt(hexString.substring(i * 2, i * 2 + 2), 16);
              if (isNaN(byte)) {
                throw new SyntaxError("Invalid hex string");
              }
              this[i] = byte;
            }
            return { read: written * 2, written };
          };
        }

        // Polyfill: Uint8Array Base64 方法（部分低版本浏览器同样缺失）
        if (typeof Uint8Array.prototype.toBase64 !== "function") {
          Uint8Array.prototype.toBase64 = function () {
            let binary = "";
            for (let i = 0; i < this.length; i++) {
              binary += String.fromCharCode(this[i]);
            }
            return btoa(binary);
          };
        }

        if (typeof Uint8Array.fromBase64 !== "function") {
          Uint8Array.fromBase64 = function (base64String: string) {
            const binary = atob(base64String);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
          };
        }

        if (typeof Uint8Array.prototype.setFromBase64 !== "function") {
          Uint8Array.prototype.setFromBase64 = function (base64String: string) {
            const binary = atob(base64String);
            const written = Math.min(binary.length, this.length);
            for (let i = 0; i < written; i++) {
              this[i] = binary.charCodeAt(i);
            }
            return { read: Math.ceil((written * 4) / 3), written };
          };
        }

        // 动态导入 pdfjs-dist
        const pdfjsLib = await import("pdfjs-dist");

        // 设置 worker — 优先使用本地文件，回退到 CDN，最终降级到无 Worker 模式
        // 微信浏览器等不支持 ESM Worker 的环境会走降级路径
        let workerReady = false;
        try {
          const workerModule = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
          pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;
          workerReady = true;
        } catch {
          // 本地 worker 加载失败，尝试 CDN
          try {
            const cdnUrl = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
            // 先测试 CDN 是否可达（微信浏览器中可能被拦截）
            const resp = await fetch(cdnUrl, { method: "HEAD", mode: "no-cors" }).catch(() => null);
            if (resp) {
              pdfjsLib.GlobalWorkerOptions.workerSrc = cdnUrl;
              workerReady = true;
            }
          } catch {
            // CDN 也不可用
          }
        }

        // 最终降级：禁用 Worker，在主线程运行（兼容微信浏览器等受限环境）
        if (!workerReady) {
          console.warn("[PdfView] Worker 不可用，降级为主线程模式（兼容微信浏览器）");
          pdfjsLib.GlobalWorkerOptions.workerSrc = "";
        }

        const restricted = isWeChatBrowser() || isRestrictedBrowser();
        const loadingTask = pdfjsLib.getDocument({
          url: `/api/comics/${comicId}/pdf`,
          // 部分 WebView 不支持 Range 请求，允许禁用
          disableRange: restricted,
          disableStream: restricted,
        });
        const doc = await loadingTask.promise;

        if (!cancelled) {
          setPdfDoc(doc);
          // 使用 PDF.js 获取的真实页数同步到父组件
          if (onTotalPagesChange && doc.numPages !== totalPages) {
            onTotalPagesChange(doc.numPages);
          }
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[PdfView] Failed to load PDF:", err);
          const errMsg = err instanceof Error ? err.message : String(err);
          // 针对低版本浏览器提供更友好的错误提示
          if (errMsg.includes("toHex") || errMsg.includes("is not a function")) {
            setError("当前浏览器版本过低，PDF 渲染引擎不兼容。建议使用 Chrome 133+、Safari 18.2+ 或其他现代浏览器访问。");
          } else {
            setError(errMsg || "PDF 加载失败");
          }
          setLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      cancelled = true;
    };
  }, [comicId]);

  // 渲染当前页面
  const renderPage = useCallback(
    async (pageNum: number) => {
      if (!pdfDoc || !canvasRef.current || !containerRef.current) return;

      // 取消之前的渲染任务
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      setRendering(true);

      try {
        const page = await pdfDoc.getPage(pageNum + 1); // PDF.js 使用 1-based 页码
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const container = containerRef.current;
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        // 计算适合容器的缩放比
        const viewport = page.getViewport({ scale: 1 });
        const scaleX = containerWidth / viewport.width;
        const scaleY = containerHeight / viewport.height;
        const baseScale = Math.min(scaleX, scaleY);
        const finalScale = baseScale * scale;

        // 高分辨率渲染（devicePixelRatio）
        const dpr = window.devicePixelRatio || 1;
        const scaledViewport = page.getViewport({ scale: finalScale * dpr });

        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;
        canvas.style.width = `${scaledViewport.width / dpr}px`;
        canvas.style.height = `${scaledViewport.height / dpr}px`;

        const renderContext = {
          canvasContext: ctx,
          viewport: scaledViewport,
          canvas,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        setRendering(false);
      } catch (err: unknown) {
        // RenderingCancelledException 是正常的（翻页时取消之前的渲染）
        if (
          err &&
          typeof err === "object" &&
          "name" in err &&
          (err as { name: string }).name === "RenderingCancelledException"
        ) {
          return;
        }
        console.error("[PdfView] Render error:", err);
        setRendering(false);
      }
    },
    [pdfDoc, scale]
  );

  // 当前页面或缩放变化时重新渲染
  useEffect(() => {
    renderPage(currentPage);
  }, [currentPage, renderPage]);

  // 窗口大小变化时重新渲染
  useEffect(() => {
    const handleResize = () => renderPage(currentPage);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [currentPage, renderPage]);

  // 触摸事件处理
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.hypot(dx, dy);
      pinchStartScaleRef.current = scale;
    } else if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    }
  }, [scale]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.min(3, Math.max(0.5, pinchStartScaleRef.current * (dist / pinchStartDistRef.current)));
      setScale(newScale);
      e.preventDefault();
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (pinchStartDistRef.current !== null) {
      pinchStartDistRef.current = null;
      if (Math.abs(scale - 1) < 0.15) setScale(1);
      return;
    }

    if (!touchStartRef.current || e.changedTouches.length === 0) return;
    const start = touchStartRef.current;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - start.x;
    const dy = endY - start.y;
    const elapsed = Date.now() - start.time;
    touchStartRef.current = null;

    if (scale > 1.1) return;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const minSwipe = 50;
    const maxTime = 800;

    // 水平滑动翻页
    if (absDx > absDy && absDx > minSwipe && elapsed < maxTime) {
      if (dx < 0) onPageChange(Math.min(totalPages - 1, currentPage + 1));
      else onPageChange(Math.max(0, currentPage - 1));
      return;
    }

    // 竖向滑动翻页
    if (absDy > absDx && absDy > minSwipe && elapsed < maxTime) {
      if (dy < 0) onPageChange(Math.min(totalPages - 1, currentPage + 1));
      else onPageChange(Math.max(0, currentPage - 1));
      return;
    }

    // 轻触
    if (absDx < 10 && absDy < 10 && elapsed < 300) {
      // 标记touch已处理，防止后续合成click事件重复翻页
      touchHandledRef.current = true;
      setTimeout(() => { touchHandledRef.current = false; }, 400);

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const ratio = (start.x - rect.left) / rect.width;
      if (ratio < 0.3) onPageChange(Math.max(0, currentPage - 1));
      else if (ratio > 0.7) onPageChange(Math.min(totalPages - 1, currentPage + 1));
      else onTapCenter();
    }
  }, [currentPage, totalPages, onPageChange, onTapCenter, scale]);

  // 双击缩放 + 延迟单击防止双击冲突
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // 如果touch事件已处理过翻页，跳过合成的click事件，防止翻两页
      if (touchHandledRef.current) {
        return;
      }

      const now = Date.now();

      // 检测是否为双击（两次点击间隔 < 300ms）
      if (now - lastTapRef.current < 300) {
        // 取消前一次的延迟单击
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        // 执行双击缩放
        setScale((prev) => (prev > 1 ? 1 : 2));
        lastTapRef.current = 0;
        e.preventDefault();
        return;
      }

      // 记录本次点击时间
      lastTapRef.current = now;

      // 缩放模式下不处理点击翻页
      if (scale > 1.1) return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      const zone = x / width;

      // 延迟执行单击操作，等待双击判定
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        if (zone < 0.3) {
          onPageChange(Math.max(0, currentPage - 1));
        } else if (zone > 0.7) {
          onPageChange(Math.min(totalPages - 1, currentPage + 1));
        } else {
          onTapCenter();
        }
      }, 250);
    },
    [currentPage, totalPages, onPageChange, onTapCenter, scale]
  );

  // 鼠标滚轮缩放
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setScale((prev) => Math.max(0.5, Math.min(3, prev + delta)));
      }
    },
    []
  );

  // 加载中
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div
            className={`h-10 w-10 animate-spin rounded-full border-2 border-t-accent ${
              readerTheme === "day" ? "border-gray-300" : "border-white/10"
            }`}
          />
          <p
            className={`text-sm ${
              readerTheme === "day" ? "text-gray-500" : "text-white/50"
            }`}
          >
            PDF 加载中...
          </p>
        </div>
      </div>
    );
  }

  // 错误
  if (error) {
    const isWeChat = isWeChatBrowser();
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center px-4 mx-4 max-w-sm rounded-2xl bg-zinc-900/95 backdrop-blur-xl border border-white/[0.08] shadow-2xl shadow-black/60 p-8">
          <div className="text-4xl mb-1">⚠️</div>
          <p
            className={`text-sm font-medium ${
              readerTheme === "day" ? "text-gray-600" : "text-white/70"
            }`}
          >
            PDF 加载失败
          </p>
          <p
            className={`text-xs max-w-sm ${
              readerTheme === "day" ? "text-gray-400" : "text-white/40"
            }`}
          >
            {isWeChat
              ? "微信浏览器对 PDF 的支持有限，建议在外部浏览器中打开"
              : error}
          </p>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => { setError(null); setRetryCount(c => c + 1); }}
              className="rounded-xl bg-accent/20 px-4 py-1.5 text-xs text-accent hover:bg-accent/30 transition-all duration-150 motion-button border border-accent/20"
            >
              重试
            </button>
            {isWeChat && (
              <button
                onClick={() => {
                  // 微信内引导用户复制链接到外部浏览器
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(window.location.href).then(() => {
                      alert("链接已复制，请在浏览器中粘贴打开");
                    }).catch(() => {
                      prompt("请复制以下链接到浏览器中打开：", window.location.href);
                    });
                  } else {
                    prompt("请复制以下链接到浏览器中打开：", window.location.href);
                  }
                }}
                className="rounded-xl bg-green-600/20 px-4 py-1.5 text-xs text-green-400 hover:bg-green-600/30 transition-all duration-150 motion-button border border-green-500/20"
              >
                复制链接
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full flex items-center justify-center overflow-auto cursor-pointer select-none bg-[#080808]"
      onClick={handleClick}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* 渲染中的半透明指示器 */}
      {rendering && (
        <div className="absolute top-4 right-4 z-10">
          <div
            className={`h-5 w-5 animate-spin rounded-full border-2 border-t-accent ${
              readerTheme === "day" ? "border-gray-300" : "border-white/20"
            }`}
          />
        </div>
      )}

      {/* 缩放指示器 */}
      {scale !== 1 && (
        <div
          className={`absolute top-4 left-4 z-10 rounded-full px-3 py-1 text-xs font-medium backdrop-blur-xl border shadow-lg shadow-black/30 ${
            readerTheme === "day"
              ? "bg-white/80 text-gray-600 border-gray-200/60 shadow-md"
              : "bg-zinc-900/80 text-white/70 border-white/[0.08]"
          }`}
        >
          {Math.round(scale * 100)}%
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full shadow-2xl shadow-black/40 rounded-sm"
        style={{ imageRendering: "auto" }}
      />
    </div>
  );
}
