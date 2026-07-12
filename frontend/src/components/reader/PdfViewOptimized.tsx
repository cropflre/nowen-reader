"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReaderTheme } from "./ReaderToolbar";
import { PDF_PAGE_PREVIEW_EVENT } from "./ReaderToolbarOptimized";

type PDFDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;
type PDFDocumentLoadingTask = import("pdfjs-dist").PDFDocumentLoadingTask;
type PDFPageProxy = import("pdfjs-dist").PDFPageProxy;
type RenderTask = import("pdfjs-dist").RenderTask;

interface PdfViewProps {
  comicId: string;
  totalPages: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onTotalPagesChange?: (total: number) => void;
  onTapCenter: () => void;
  readerTheme: ReaderTheme;
}

const LARGE_PDF_THRESHOLD = 64 * 1024 * 1024;
const RANGE_CHUNK_SIZE = 1024 * 1024;
const MAX_PREFETCHED_PAGES = 2;

function ensureTypedArrayPolyfills() {
  const proto = Uint8Array.prototype as Uint8Array & {
    toHex?: () => string;
    setFromHex?: (value: string) => { read: number; written: number };
    toBase64?: () => string;
    setFromBase64?: (value: string) => { read: number; written: number };
  };
  const ctor = Uint8Array as typeof Uint8Array & {
    fromHex?: (value: string) => Uint8Array;
    fromBase64?: (value: string) => Uint8Array;
  };

  if (!proto.toHex) {
    proto.toHex = function () {
      let result = "";
      for (let i = 0; i < this.length; i += 1) {
        result += this[i].toString(16).padStart(2, "0");
      }
      return result;
    };
  }
  if (!ctor.fromHex) {
    ctor.fromHex = (value: string) => {
      if (value.length % 2 !== 0) throw new SyntaxError("Invalid hex string");
      const result = new Uint8Array(value.length / 2);
      for (let i = 0; i < value.length; i += 2) {
        const byte = Number.parseInt(value.slice(i, i + 2), 16);
        if (Number.isNaN(byte)) throw new SyntaxError("Invalid hex string");
        result[i / 2] = byte;
      }
      return result;
    };
  }
  if (!proto.setFromHex) {
    proto.setFromHex = function (value: string) {
      const source = ctor.fromHex!(value);
      const written = Math.min(source.length, this.length);
      this.set(source.subarray(0, written));
      return { read: written * 2, written };
    };
  }
  if (!proto.toBase64) {
    proto.toBase64 = function () {
      let binary = "";
      for (let i = 0; i < this.length; i += 1) binary += String.fromCharCode(this[i]);
      return btoa(binary);
    };
  }
  if (!ctor.fromBase64) {
    ctor.fromBase64 = (value: string) => {
      const binary = atob(value);
      const result = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) result[i] = binary.charCodeAt(i);
      return result;
    };
  }
  if (!proto.setFromBase64) {
    proto.setFromBase64 = function (value: string) {
      const source = ctor.fromBase64!(value);
      const written = Math.min(source.length, this.length);
      this.set(source.subarray(0, written));
      return { read: Math.ceil((written * 4) / 3), written };
    };
  }
}

async function detectPdfSize(url: string, signal: AbortSignal): Promise<number> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (!response.ok) return 0;
    const size = Number(response.headers.get("content-length") || 0);
    return Number.isFinite(size) && size > 0 ? size : 0;
  } catch {
    return 0;
  }
}

export default function PdfViewOptimized({
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
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const currentPageProxyRef = useRef<PDFPageProxy | null>(null);
  const prefetchedPagesRef = useRef(new Map<number, PDFPageProxy>());
  const prefetchGenerationRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef(1);
  const lastTapRef = useRef(0);
  const touchHandledRef = useRef(false);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [scale, setScale] = useState(1);
  const [largeFileMode, setLargeFileMode] = useState(false);
  const [loadedBytes, setLoadedBytes] = useState(0);
  const [fileSize, setFileSize] = useState(0);

  const cleanupPrefetch = useCallback(() => {
    prefetchGenerationRef.current += 1;
    for (const page of prefetchedPagesRef.current.values()) {
      try { page.cleanup(); } catch {}
    }
    prefetchedPagesRef.current.clear();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const pdfUrl = `/api/comics/${comicId}/pdf-range`;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      setLoadedBytes(0);
      cleanupPrefetch();

      try {
        ensureTypedArrayPolyfills();
        const detectedSize = await detectPdfSize(pdfUrl, controller.signal);
        if (cancelled) return;

        const isLarge = detectedSize >= LARGE_PDF_THRESHOLD;
        setFileSize(detectedSize);
        setLargeFileMode(isLarge);

        const pdfjsLib = await import("pdfjs-dist");
        const workerModule = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;

        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          rangeChunkSize: RANGE_CHUNK_SIZE,
          disableRange: false,
          // 对超大 PDF 禁止浏览器顺序下载整本文件，只请求当前页必需的字节范围。
          disableStream: isLarge,
          disableAutoFetch: isLarge,
          withCredentials: true,
          useSystemFonts: true,
        });
        loadingTaskRef.current = loadingTask;
        loadingTask.onProgress = ({ loaded }: { loaded: number; total: number }) => {
          if (!cancelled) setLoadedBytes(loaded);
        };

        const doc = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy().catch(() => undefined);
          return;
        }

        setPdfDoc(doc);
        if (onTotalPagesChange && doc.numPages !== totalPages) {
          onTotalPagesChange(doc.numPages);
        }
        setLoading(false);
      } catch (reason) {
        if (cancelled || controller.signal.aborted) return;
        console.error("[PdfViewOptimized] Failed to load PDF:", reason);
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message || "PDF 加载失败");
        setLoading(false);
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
      controller.abort();
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      currentPageProxyRef.current?.cleanup();
      currentPageProxyRef.current = null;
      cleanupPrefetch();
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      const task = loadingTaskRef.current;
      loadingTaskRef.current = null;
      if (task) void task.destroy().catch(() => undefined);
    };
  }, [comicId, retryCount, cleanupPrefetch]);

  const prefetchPage = useCallback(async (pageIndex: number) => {
    if (!pdfDoc || pageIndex < 0 || pageIndex >= pdfDoc.numPages || pageIndex === currentPage) return;
    if (prefetchedPagesRef.current.has(pageIndex)) return;

    const generation = prefetchGenerationRef.current;
    try {
      const page = await pdfDoc.getPage(pageIndex + 1);
      await page.getOperatorList();
      if (generation !== prefetchGenerationRef.current) {
        page.cleanup();
        return;
      }

      prefetchedPagesRef.current.set(pageIndex, page);
      while (prefetchedPagesRef.current.size > MAX_PREFETCHED_PAGES) {
        const oldest = prefetchedPagesRef.current.entries().next().value as [number, PDFPageProxy] | undefined;
        if (!oldest) break;
        prefetchedPagesRef.current.delete(oldest[0]);
        oldest[1].cleanup();
      }
    } catch (reason) {
      console.debug("[PdfViewOptimized] page prefetch skipped", pageIndex, reason);
    }
  }, [currentPage, pdfDoc]);

  useEffect(() => {
    if (!pdfDoc) return;
    const listener = (event: Event) => {
      const page = (event as CustomEvent<{ page: number | null }>).detail?.page;
      if (typeof page === "number") void prefetchPage(page);
    };
    window.addEventListener(PDF_PAGE_PREVIEW_EVENT, listener);
    return () => window.removeEventListener(PDF_PAGE_PREVIEW_EVENT, listener);
  }, [pdfDoc, prefetchPage]);

  useEffect(() => {
    if (!pdfDoc) return;
    const timer = setTimeout(() => {
      void prefetchPage(currentPage + 1);
    }, largeFileMode ? 350 : 180);
    return () => clearTimeout(timer);
  }, [currentPage, largeFileMode, pdfDoc, prefetchPage]);

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current || !containerRef.current) return;

    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    setRendering(true);

    try {
      const prefetched = prefetchedPagesRef.current.get(currentPage);
      if (prefetched) prefetchedPagesRef.current.delete(currentPage);
      const page = prefetched || await pdfDoc.getPage(currentPage + 1);

      if (currentPageProxyRef.current && currentPageProxyRef.current !== page) {
        currentPageProxyRef.current.cleanup();
      }
      currentPageProxyRef.current = page;

      const canvas = canvasRef.current;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;

      const container = containerRef.current;
      const containerWidth = Math.max(container.clientWidth, 1);
      const containerHeight = Math.max(container.clientHeight, 1);
      const viewport = page.getViewport({ scale: 1 });
      const baseScale = Math.min(containerWidth / viewport.width, containerHeight / viewport.height);
      const displayScale = Math.max(0.05, baseScale * scale);

      let renderDpr = Math.min(window.devicePixelRatio || 1, 2);
      const maxDimension = 4096;
      const maxPixels = 16_000_000;
      let width = viewport.width * displayScale * renderDpr;
      let height = viewport.height * displayScale * renderDpr;
      const dimensionRatio = maxDimension / Math.max(width, height);
      const pixelRatio = Math.sqrt(maxPixels / Math.max(width * height, 1));
      const reduction = Math.min(1, dimensionRatio, pixelRatio);
      renderDpr = Math.max(0.25, renderDpr * reduction);

      const renderViewport = page.getViewport({ scale: displayScale * renderDpr });
      canvas.width = Math.max(1, Math.floor(renderViewport.width));
      canvas.height = Math.max(1, Math.floor(renderViewport.height));
      canvas.style.width = `${Math.max(1, viewport.width * displayScale)}px`;
      canvas.style.height = `${Math.max(1, viewport.height * displayScale)}px`;

      const task = page.render({
        canvas,
        canvasContext: context,
        viewport: renderViewport,
      });
      renderTaskRef.current = task;
      await task.promise;
      if (renderTaskRef.current === task) renderTaskRef.current = null;
      setRendering(false);
    } catch (reason) {
      if (reason && typeof reason === "object" && "name" in reason && reason.name === "RenderingCancelledException") return;
      console.error("[PdfViewOptimized] Render error:", reason);
      setRendering(false);
    }
  }, [currentPage, pdfDoc, scale]);

  useEffect(() => {
    void renderPage();
  }, [renderPage]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void renderPage(), 120);
    });
    observer.observe(container);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [renderPage]);

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    if (event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      pinchStartDistRef.current = Math.hypot(dx, dy);
      pinchStartScaleRef.current = scale;
    } else if (event.touches.length === 1) {
      touchStartRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, time: Date.now() };
    }
  }, [scale]);

  const handleTouchMove = useCallback((event: React.TouchEvent) => {
    if (event.touches.length !== 2 || pinchStartDistRef.current === null) return;
    const dx = event.touches[0].clientX - event.touches[1].clientX;
    const dy = event.touches[0].clientY - event.touches[1].clientY;
    const distance = Math.hypot(dx, dy);
    setScale(Math.min(3, Math.max(0.5, pinchStartScaleRef.current * (distance / pinchStartDistRef.current))));
    event.preventDefault();
  }, []);

  const handleTouchEnd = useCallback((event: React.TouchEvent) => {
    if (pinchStartDistRef.current !== null) {
      pinchStartDistRef.current = null;
      return;
    }
    const start = touchStartRef.current;
    if (!start || event.changedTouches.length === 0) return;
    touchStartRef.current = null;

    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    const elapsed = Date.now() - start.time;
    if (scale > 1.1) return;

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (elapsed < 800 && Math.max(absX, absY) > 50) {
      const forward = absX > absY ? dx < 0 : dy < 0;
      onPageChange(Math.max(0, Math.min(totalPages - 1, currentPage + (forward ? 1 : -1))));
      return;
    }
    if (elapsed < 300 && absX < 10 && absY < 10) {
      touchHandledRef.current = true;
      setTimeout(() => { touchHandledRef.current = false; }, 400);
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = (start.x - rect.left) / rect.width;
      if (ratio < 0.3) onPageChange(Math.max(0, currentPage - 1));
      else if (ratio > 0.7) onPageChange(Math.min(totalPages - 1, currentPage + 1));
      else onTapCenter();
    }
  }, [currentPage, onPageChange, onTapCenter, scale, totalPages]);

  const handleClick = useCallback((event: React.MouseEvent) => {
    if (touchHandledRef.current) return;
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      setScale((value) => value > 1 ? 1 : 2);
      lastTapRef.current = 0;
      return;
    }
    lastTapRef.current = now;
    if (scale > 1.1) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      if (ratio < 0.3) onPageChange(Math.max(0, currentPage - 1));
      else if (ratio > 0.7) onPageChange(Math.min(totalPages - 1, currentPage + 1));
      else onTapCenter();
    }, 250);
  }, [currentPage, onPageChange, onTapCenter, scale, totalPages]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setScale((value) => Math.max(0.5, Math.min(3, value + (event.deltaY > 0 ? -0.1 : 0.1))));
  }, []);

  if (loading) {
    const progress = fileSize > 0 ? Math.min(100, Math.round((loadedBytes / fileSize) * 100)) : 0;
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className={`h-10 w-10 animate-spin rounded-full border-2 border-t-accent ${readerTheme === "day" ? "border-gray-300" : "border-white/10"}`} />
          <p className={`text-sm ${readerTheme === "day" ? "text-gray-500" : "text-white/60"}`}>PDF 快速打开中...</p>
          <p className={`max-w-xs text-xs ${readerTheme === "day" ? "text-gray-400" : "text-white/35"}`}>
            {largeFileMode ? `超大文件按需读取${progress > 0 ? ` · ${progress}% 必要数据` : ""}` : "正在初始化 PDF 引擎"}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="mx-4 flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-white/[0.08] bg-zinc-900/95 p-8 text-center shadow-2xl shadow-black/60">
          <div className="text-4xl">⚠️</div>
          <p className="text-sm font-medium text-white/70">PDF 加载失败</p>
          <p className="break-all text-xs text-white/40">{error}</p>
          <button onClick={() => setRetryCount((value) => value + 1)} className="rounded-xl border border-accent/20 bg-accent/20 px-4 py-1.5 text-xs text-accent hover:bg-accent/30">重试</button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full cursor-pointer select-none items-center justify-center overflow-auto bg-[#080808]"
      onClick={handleClick}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {rendering && <div className="absolute right-4 top-4 z-10 h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-accent" />}
      {largeFileMode && (
        <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-full border border-white/[0.08] bg-zinc-900/80 px-3 py-1 text-[10px] text-white/45 backdrop-blur-xl">
          超大 PDF · 按需加载
        </div>
      )}
      {scale !== 1 && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-full border border-white/[0.08] bg-zinc-900/80 px-3 py-1 text-xs text-white/70 backdrop-blur-xl">
          {Math.round(scale * 100)}%
        </div>
      )}
      <canvas ref={canvasRef} className="max-h-full max-w-full rounded-sm shadow-2xl shadow-black/40" />
    </div>
  );
}
