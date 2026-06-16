"use client";

/**
 * BookFlipPrototype — Isolated prototype for realistic page-flip engine.
 * Uses stable offscreen canvas compositing to avoid read-after-write corruption.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const FLIP_THRESHOLD = 0.32;
const FINISH_DURATION = 320;
const CANCEL_DURATION = 260;
const MAX_DPR = 2;

type FlipState =
  | "idle"
  | "dragging-next"
  | "dragging-prev"
  | "animating-complete"
  | "animating-cancel";

export interface BookFlipPrototypeProps {
  pages: string[];
  direction?: "ltr" | "rtl";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function drawPagePlaceholder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  index: number,
  label: string,
) {
  const base = index % 2 === 0 ? 245 : 248;
  ctx.fillStyle = `rgb(${base}, ${base}, ${base})`;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#111827";
  ctx.font = `bold ${Math.round(Math.min(width, height) * 0.09)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, width / 2, height / 2 - Math.round(height * 0.06));

  ctx.fillStyle = "#6b7280";
  ctx.font = `${Math.round(Math.min(width, height) * 0.038)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
  ctx.fillText("BookFlip Prototype", width / 2, height / 2 + Math.round(height * 0.06));

  ctx.fillStyle = "#9ca3af";
  ctx.font = `500 ${Math.round(Math.min(width, height) * 0.032)}px ui-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.fillText("Canvas 2D stable page fold", width / 2, height / 2 + Math.round(height * 0.14));
}

function drawSpineShadow(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const grad = ctx.createLinearGradient(w * 0.46, 0, w * 0.56, 0);
  grad.addColorStop(0, "rgba(0,0,0,0.18)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.06)");
  grad.addColorStop(1, "rgba(0,0,0,0.00)");
  ctx.fillStyle = grad;
  ctx.fillRect(w * 0.46, 0, w * 0.12, h);
}

function drawPageTexture(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, w: number, h: number, label: string, index: number) {
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, 0, 0, w, h);
  } else {
    drawPagePlaceholder(ctx, w, h, index, label);
  }
}

/**
 * Draw a stable page fold using an offscreen canvas buffer.
 * Avoids read-after-write on the main canvas.
 */
function drawPageFold(
  ctx: CanvasRenderingContext2D,
  offscreen: HTMLCanvasElement,
  img: HTMLImageElement | null,
  fallbackIdx: number,
  fallbackLabel: string,
  w: number,
  h: number,
  foldX: number,
  progress: number,
  directionIsNext: boolean,
) {
  const foldWidth = directionIsNext
    ? Math.max(0, w - foldX)
    : Math.max(0, foldX);

  if (foldWidth < 1) return;

  // Render the source texture to offscreen buffer
  offscreen.width = Math.ceil(foldWidth);
  offscreen.height = Math.ceil(h);
  const offCtx = offscreen.getContext("2d");
  if (!offCtx) return;

  offCtx.clearRect(0, 0, foldWidth, h);

  if (img && img.complete && img.naturalWidth > 0) {
    if (directionIsNext) {
      const sx = (foldX / w) * img.naturalWidth;
      const sw = ((w - foldX) / w) * img.naturalWidth;
      offCtx.drawImage(img, sx, 0, sw, img.naturalHeight, 0, 0, foldWidth, h);
    } else {
      const sw = (foldX / w) * img.naturalWidth;
      offCtx.drawImage(img, 0, 0, sw, img.naturalHeight, 0, 0, foldWidth, h);
    }
  } else {
    drawPagePlaceholder(offCtx, foldWidth, h, fallbackIdx, fallbackLabel);
  }

  // Composite onto main canvas with fold effect
  ctx.save();
  ctx.beginPath();
  if (directionIsNext) {
    ctx.rect(0, 0, foldX, h);
  } else {
    ctx.rect(foldX, 0, w - foldX, h);
  }
  ctx.clip();

  const curlAmplitude = Math.sin(progress * Math.PI) * w * 0.03;
  const skewFactor = progress * 0.08;

  ctx.save();
  if (directionIsNext) {
    ctx.translate(foldX, 0);
    ctx.scale(-1, 1);
    ctx.transform(1, skewFactor, 0, 1, 0, curlAmplitude);
    ctx.drawImage(offscreen, 0, 0, foldWidth, h, 0, 0, foldWidth, h);
  } else {
    ctx.translate(foldX, 0);
    ctx.scale(-1, 1);
    ctx.transform(1, -skewFactor, 0, 1, 0, -curlAmplitude);
    ctx.drawImage(offscreen, 0, 0, foldWidth, h, -foldWidth, 0, foldWidth, h);
  }
  ctx.restore();

  // Fold shadow
  const shadowGrad = ctx.createLinearGradient(
    directionIsNext ? 0 : foldX, 0,
    directionIsNext ? foldX : w, 0,
  );
  shadowGrad.addColorStop(0, "rgba(0,0,0,0.25)");
  shadowGrad.addColorStop(0.3, "rgba(0,0,0,0.12)");
  shadowGrad.addColorStop(0.8, "rgba(0,0,0,0.03)");
  shadowGrad.addColorStop(1, "rgba(0,0,0,0.00)");
  ctx.fillStyle = shadowGrad;
  if (directionIsNext) {
    ctx.fillRect(0, 0, foldX, h);
  } else {
    ctx.fillRect(foldX, 0, w - foldX, h);
  }

  // Fold highlight
  const hlWidth = Math.max(4, w * 0.015);
  const hlGrad = ctx.createLinearGradient(foldX - hlWidth, 0, foldX + hlWidth, 0);
  hlGrad.addColorStop(0, "rgba(255,255,255,0.00)");
  hlGrad.addColorStop(0.4, "rgba(255,255,255,0.12)");
  hlGrad.addColorStop(0.6, "rgba(255,255,255,0.15)");
  hlGrad.addColorStop(1, "rgba(255,255,255,0.00)");
  ctx.fillStyle = hlGrad;
  ctx.fillRect(foldX - hlWidth, 0, hlWidth * 2, h);

  ctx.restore();
}

export default function BookFlipPrototype({ pages, direction = "ltr" }: BookFlipPrototypeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [flipState, setFlipState] = useState<FlipState>("idle");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [fps, setFps] = useState(0);
  const [touchDevice, setTouchDevice] = useState(false);

  const totalPages = pages.length;
  const textureCache = useRef(new Map<string, HTMLImageElement>());

  const metricsRef = useRef({
    width: 0,
    height: 0,
    dpr: 1,
    lastFrameTime: performance.now(),
    frameCount: 0,
    fpsAccumulator: 0,
    fpsRefreshTime: performance.now(),
  });

  const stateRef = useRef({
    flipState: "idle" as FlipState,
    currentPage: 0,
    flipProgress: 0,
    startPointerX: 0,
    startPointerY: 0,
    currentPointerX: 0,
    direction: "next" as "next" | "prev",
    animationStart: 0,
    animationFrom: 0,
    animationTo: 0,
    needsRender: true,
    active: false,
    pointerId: 0,
    locked: false,
  });

  const getOffscreen = useCallback(() => {
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement("canvas");
    }
    return offscreenRef.current;
  }, []);

  useEffect(() => {
    stateRef.current.currentPage = currentPage;
  }, [currentPage]);

  useEffect(() => {
    stateRef.current.flipState = flipState;
  }, [flipState]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReducedMotion(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    setTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  const ensureImage = useCallback((url: string) => {
    if (!url) return null;
    const cached = textureCache.current.get(url);
    if (cached) return cached;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    textureCache.current.set(url, img);
    return img;
  }, []);

  useEffect(() => {
    const indices = [currentPage - 1, currentPage, currentPage + 1, currentPage + 2];
    for (const idx of indices) {
      if (idx >= 0 && idx < totalPages) {
        const img = ensureImage(pages[idx]);
        img?.decode().catch(() => {});
      }
    }
  }, [currentPage, pages, totalPages, ensureImage]);

  const resize = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    metricsRef.current.width = width;
    metricsRef.current.height = height;
    metricsRef.current.dpr = dpr;
    stateRef.current.needsRender = true;
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = metricsRef.current;
    if (!width || !height) return;

    const local = stateRef.current;
    const pageIdx = local.currentPage;
    const currentUrl = pages[pageIdx] ?? "";
    const nextUrl = pages[pageIdx + 1] ?? "";
    const prevUrl = pages[pageIdx - 1] ?? "";

    const currentLabel = `Page ${pageIdx + 1}`;
    const nextLabel = `Page ${pageIdx + 2}`;
    const prevLabel = `Page ${Math.max(1, pageIdx)}`;

    const currentImg = ensureImage(currentUrl);
    const nextImg = ensureImage(nextUrl);
    const prevImg = ensureImage(prevUrl);

    ctx.clearRect(0, 0, width, height);
    ctx.save();

    const progress = clamp(local.flipProgress, 0, 1);
    const isDragging = local.flipState === "dragging-next" || local.flipState === "dragging-prev";
    const isActiveFlip = local.flipState === "animating-complete" || local.flipState === "animating-cancel" || isDragging;
    const directionIsNext = local.direction === "next";

    if (isActiveFlip) {
      const easedProgress = isDragging ? progress : easeInOutCubic(progress);
      const foldX = directionIsNext
        ? width * (1 - easedProgress)
        : width * easedProgress;

      if (directionIsNext) {
        // Forward flip: current page background, next page revealed
        drawPageTexture(ctx, currentImg, width, height, currentLabel, pageIdx);
        drawSpineShadow(ctx, width, height);

        ctx.save();
        ctx.beginPath();
        ctx.rect(foldX, 0, width - foldX, height);
        ctx.clip();
        drawPageTexture(ctx, nextImg, width, height, nextLabel, pageIdx + 1);
        ctx.restore();

        // Fold from current page
        const offscreen = getOffscreen();
        drawPageFold(
          ctx, offscreen, currentImg, pageIdx, currentLabel,
          width, height, foldX, progress, true,
        );

        // Drop shadow behind turning page
        const dropAlpha = 0.15 + 0.1 * Math.sin(progress * Math.PI);
        const dropGrad = ctx.createLinearGradient(foldX - width * 0.1, 0, foldX, 0);
        dropGrad.addColorStop(0, "rgba(0,0,0,0.00)");
        dropGrad.addColorStop(1, `rgba(0,0,0,${dropAlpha.toFixed(3)})`);
        ctx.fillStyle = dropGrad;
        ctx.fillRect(foldX - width * 0.1, 0, width * 0.1, height);

      } else {
        // Backward flip: previous page background, current page revealed
        drawPageTexture(ctx, prevImg, width, height, prevLabel, Math.max(0, pageIdx - 1));
        drawSpineShadow(ctx, width, height);

        ctx.save();
        ctx.beginPath();
        ctx.rect(foldX, 0, width - foldX, height);
        ctx.clip();
        drawPageTexture(ctx, currentImg, width, height, currentLabel, pageIdx);
        ctx.restore();

        // Fold from previous page
        const offscreen = getOffscreen();
        drawPageFold(
          ctx, offscreen, prevImg, Math.max(0, pageIdx - 1), prevLabel,
          width, height, foldX, progress, false,
        );

        // Drop shadow behind turning page
        const dropAlpha = 0.15 + 0.1 * Math.sin(progress * Math.PI);
        const dropGrad = ctx.createLinearGradient(foldX, 0, foldX + width * 0.1, 0);
        dropGrad.addColorStop(0, `rgba(0,0,0,${dropAlpha.toFixed(3)})`);
        dropGrad.addColorStop(1, "rgba(0,0,0,0.00)");
        ctx.fillStyle = dropGrad;
        ctx.fillRect(foldX, 0, width * 0.1, height);
      }

      // Spine shadow at fold line
      const spineAlpha = 0.22 + 0.18 * Math.sin(progress * Math.PI);
      const spineGrad = ctx.createLinearGradient(
        foldX - width * 0.06, 0, foldX + width * 0.04, 0,
      );
      spineGrad.addColorStop(0, "rgba(0,0,0,0.00)");
      spineGrad.addColorStop(0.45, `rgba(0,0,0,${(spineAlpha * 0.7).toFixed(3)})`);
      spineGrad.addColorStop(0.55, `rgba(0,0,0,${spineAlpha.toFixed(3)})`);
      spineGrad.addColorStop(1, "rgba(0,0,0,0.00)");
      ctx.fillStyle = spineGrad;
      ctx.fillRect(foldX - width * 0.06, 0, width * 0.1, height);

    } else {
      drawPageTexture(ctx, currentImg, width, height, currentLabel, pageIdx);
      drawSpineShadow(ctx, width, height);
    }

    ctx.restore();

    metricsRef.current.frameCount += 1;
    metricsRef.current.fpsAccumulator += 1;
    const now = performance.now();
    metricsRef.current.lastFrameTime = now;
    if (now - metricsRef.current.fpsRefreshTime >= 500) {
      const elapsed = (now - metricsRef.current.fpsRefreshTime) / 1000;
      setFps(Math.round(metricsRef.current.fpsAccumulator / elapsed));
      metricsRef.current.fpsAccumulator = 0;
      metricsRef.current.fpsRefreshTime = now;
    }
  }, [ensureImage, pages, getOffscreen]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const local = stateRef.current;
      if (local.flipState === "animating-complete" || local.flipState === "animating-cancel") {
        const elapsed = performance.now() - local.animationStart;
        const duration = local.flipState === "animating-complete" ? FINISH_DURATION : CANCEL_DURATION;
        const t = clamp(elapsed / duration, 0, 1);
        const eased = local.flipState === "animating-complete" ? easeOutCubic(t) : easeInOutCubic(t);
        local.flipProgress = local.animationFrom + (local.animationTo - local.animationFrom) * eased;

        if (t >= 1) {
          if (local.flipState === "animating-complete") {
            const targetPage = local.direction === "next"
              ? Math.min(pages.length - 1, local.currentPage + 1)
              : Math.max(0, local.currentPage - 1);
            setCurrentPage(targetPage);
            local.currentPage = targetPage;
          }
          local.flipState = "idle";
          local.flipProgress = 0;
          setFlipState("idle");
        }
      }

      renderFrame();
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pages.length, renderFrame]);

  const beginFlip = useCallback((clientX: number, clientY: number, pointerId: number, direction: "next" | "prev") => {
    const local = stateRef.current;
    if (local.flipState !== "idle") return;
    if (direction === "next" && local.currentPage >= pages.length - 1) return;
    if (direction === "prev" && local.currentPage <= 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(pointerId);

    local.flipState = direction === "next" ? "dragging-next" : "dragging-prev";
    local.direction = direction;
    local.startPointerX = clientX;
    local.startPointerY = clientY;
    local.currentPointerX = clientX;
    local.flipProgress = 0;
    local.locked = true;
    local.pointerId = pointerId;

    setFlipState(local.flipState);
  }, [pages.length]);

  const moveFlip = useCallback((clientX: number) => {
    const local = stateRef.current;
    if (local.flipState !== "dragging-next" && local.flipState !== "dragging-prev") return;

    local.currentPointerX = clientX;
    const dx = local.direction === "next"
      ? local.startPointerX - clientX
      : clientX - local.startPointerX;
    const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 1;
    local.flipProgress = clamp(dx / containerWidth, 0, 1);
    local.needsRender = true;
  }, []);

  const endFlip = useCallback(() => {
    const local = stateRef.current;
    if (local.flipState !== "dragging-next" && local.flipState !== "dragging-prev") return;

    const finish = local.flipProgress >= FLIP_THRESHOLD;
    local.flipState = finish ? "animating-complete" : "animating-cancel";
    local.animationStart = performance.now();
    local.animationFrom = local.flipProgress;
    local.animationTo = finish ? 1 : 0;
    setFlipState(local.flipState);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (reducedMotion) return;
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const localX = e.clientX - containerRect.left;
    const half = containerRect.width / 2;
    const isNext = direction === "ltr" ? localX > half : localX < half;
    beginFlip(e.clientX, e.clientY, e.pointerId, isNext ? "next" : "prev");
  }, [beginFlip, direction, reducedMotion]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    moveFlip(e.clientX);
  }, [moveFlip]);

  const onPointerUp = useCallback(() => {
    endFlip();
  }, [endFlip]);

  const onPointerCancel = useCallback(() => {
    endFlip();
  }, [endFlip]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        setCurrentPage((p) => Math.min(pages.length - 1, p + 1));
      } else if (e.key === "ArrowLeft") {
        setCurrentPage((p) => Math.max(0, p - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages.length]);

  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-900/60 px-4 py-3">
        <div className="text-sm font-medium text-white/90">BookFlipPrototype</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
          <span className="rounded-full bg-white/10 px-2 py-1 font-mono">{currentPage + 1} / {totalPages}</span>
          <span className="rounded-full bg-white/10 px-2 py-1 font-mono">{direction.toUpperCase()}</span>
          <span className="rounded-full bg-white/10 px-2 py-1 font-mono">{fps} fps</span>
          <span className="rounded-full bg-white/10 px-2 py-1 font-mono">reducedMotion={reducedMotion ? "true" : "false"}</span>
          <span className="rounded-full bg-white/10 px-2 py-1 font-mono">touch={touchDevice ? "true" : "false"}</span>
          <span className="rounded-full bg-white/10 px-2 py-1 font-mono">state={flipState}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/15 active:bg-white/20 disabled:opacity-40"
          onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
          disabled={currentPage <= 0 || flipState !== "idle"}
        >
          Prev
        </button>
        <button
          className="rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/15 active:bg-white/20 disabled:opacity-40"
          onClick={() => setCurrentPage((p) => Math.min(pages.length - 1, p + 1))}
          disabled={currentPage >= pages.length - 1 || flipState !== "idle"}
        >
          Next
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-black/80"
        style={{ aspectRatio: "3 / 4" }}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full cursor-grab active:cursor-grabbing"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
      </div>
    </div>
  );
}