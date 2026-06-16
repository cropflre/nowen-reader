"use client";

/**
 * RealisticBookView — Production-ready realistic page-flip reader view.
 *
 * Adapted from BookFlipPrototype with the following changes:
 * - Controlled currentPage prop (syncs with external state)
 * - onPageChange callback fires only after animation completes
 * - Tap-center for toolbar toggle
 * - No debug HUD
 * - Dark immersive background matching nowen-reader style
 * - Boundary protection (first/last page)
 * - Input locking during animation
 * - prefers-reduced-motion: disables drag, falls back to instant page turn
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

export interface RealisticBookViewProps {
  pages: string[];
  currentPage: number;
  totalPages: number;
  direction: "ltr" | "rtl";
  readerTheme: string;
  fitMode?: string;
  containerWidth?: string;
  onPageChange: (page: number) => void;
  onTapCenter?: () => void;
  disabled?: boolean;
}

// ── Math helpers ──

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── Canvas drawing primitives ──

function drawSpineShadow(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const grad = ctx.createLinearGradient(w * 0.46, 0, w * 0.56, 0);
  grad.addColorStop(0, "rgba(0,0,0,0.18)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.06)");
  grad.addColorStop(1, "rgba(0,0,0,0.00)");
  ctx.fillStyle = grad;
  ctx.fillRect(w * 0.46, 0, w * 0.12, h);
}

function drawPageTexture(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  w: number,
  h: number,
  fallbackIndex: number,
) {
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, 0, 0, w, h);
  } else {
    // Dark placeholder matching reader background
    ctx.fillStyle = "#07070a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.font = `bold ${Math.round(Math.min(w, h) * 0.06)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${fallbackIndex + 1}`, w / 2, h / 2);
  }
}

// ── Component ──

export default function RealisticBookView({
  pages,
  currentPage: externalPage,
  totalPages,
  direction,
  onPageChange,
  onTapCenter,
}: RealisticBookViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Internal page state: synced with external, but updated internally during animation
  const [internalPage, setInternalPage] = useState(externalPage);
  const [flipState, setFlipState] = useState<FlipState>("idle");
  const [reducedMotion, setReducedMotion] = useState(false);

  const textureCache = useRef(new Map<string, HTMLImageElement>());

  const metricsRef = useRef({
    width: 0,
    height: 0,
    dpr: 1,
  });

  const stateRef = useRef({
    flipState: "idle" as FlipState,
    internalPage: 0,
    flipProgress: 0,
    startPointerX: 0,
    startPointerY: 0,
    currentPointerX: 0,
    flipDirection: "next" as "next" | "prev",
    animationStart: 0,
    animationFrom: 0,
    animationTo: 0,
    needsRender: true,
    pointerId: 0,
    tapStartX: 0,
    tapStartY: 0,
  });

  // ── Sync external → internal ──
  useEffect(() => {
    // Only sync when not mid-animation
    if (stateRef.current.flipState === "idle") {
      setInternalPage(externalPage);
      stateRef.current.internalPage = externalPage;
    }
  }, [externalPage]);

  // Sync internal → stateRef
  useEffect(() => {
    stateRef.current.internalPage = internalPage;
  }, [internalPage]);

  // ── Reduced motion detection ──
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReducedMotion(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // ── Image cache ──
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

  // Preload adjacent pages
  useEffect(() => {
    const indices = [internalPage - 1, internalPage, internalPage + 1, internalPage + 2];
    for (const idx of indices) {
      if (idx >= 0 && idx < totalPages) {
        const img = ensureImage(pages[idx]);
        img?.decode().catch(() => {});
      }
    }
  }, [internalPage, pages, totalPages, ensureImage]);

  // ── Canvas resize ──
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

  // ── Render frame ──
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = metricsRef.current;
    if (!width || !height) return;

    const local = stateRef.current;
    const pageIdx = local.internalPage;

    const currentImg = ensureImage(pages[pageIdx] ?? "");
    const nextImg = ensureImage(pages[pageIdx + 1] ?? "");
    const prevImg = ensureImage(pages[pageIdx - 1] ?? "");

    ctx.clearRect(0, 0, width, height);
    ctx.save();

    const progress = clamp(local.flipProgress, 0, 1);
    const isDragging =
      local.flipState === "dragging-next" || local.flipState === "dragging-prev";
    const isActiveFlip =
      local.flipState === "animating-complete" ||
      local.flipState === "animating-cancel" ||
      isDragging;
    const directionIsNext = local.flipDirection === "next";

    if (isActiveFlip) {
      const easedProgress = isDragging ? progress : easeInOutCubic(progress);
      const foldX = directionIsNext
        ? width * (1 - easedProgress)
        : width * easedProgress;

      if (directionIsNext) {
        drawPageTexture(ctx, currentImg, width, height, pageIdx);
        drawSpineShadow(ctx, width, height);
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.fillRect(foldX, 0, Math.max(0, width - foldX), height);
        ctx.save();
        ctx.beginPath();
        ctx.rect(foldX, 0, width - foldX, height);
        ctx.clip();
        drawPageTexture(ctx, nextImg, width, height, pageIdx + 1);
        ctx.restore();
      } else {
        if (prevImg) {
          drawPageTexture(ctx, prevImg, width, height, Math.max(0, pageIdx - 1));
        } else {
          ctx.fillStyle = "#07070a";
          ctx.fillRect(0, 0, width, height);
        }
      }

      // Curl effect
      ctx.save();
      if (directionIsNext) {
        ctx.beginPath();
        ctx.moveTo(foldX, 0);
        ctx.lineTo(0, 0);
        ctx.lineTo(0, height);
        ctx.lineTo(foldX, height);
        ctx.closePath();
        ctx.clip();
      } else {
        ctx.beginPath();
        ctx.moveTo(foldX, 0);
        ctx.lineTo(width, 0);
        ctx.lineTo(width, height);
        ctx.lineTo(foldX, height);
        ctx.closePath();
        ctx.clip();
      }

      const curlAmplitude =
        Math.sin(progress * Math.PI) * width * 0.08;
      const foldWidth = width * (1 - easedProgress);

      ctx.save();
      ctx.translate(foldX, 0);
      if (directionIsNext) {
        ctx.transform(-1, 0, 0, 1, 0, 0);
      }

      const steps = 8;
      const sliceWidth = foldWidth / steps;
      for (let i = 0; i < steps; i += 1) {
        const t = i / steps;
        const sliceX = t * foldWidth;
        const localT = clamp(1 - t, 0, 1);
        const wave = Math.sin(localT * Math.PI);
        const curlY =
          wave * curlAmplitude * (0.85 + 0.15 * Math.sin(t * Math.PI * 2));
        const scaleX = sliceWidth * 1.03;

        ctx.save();
        ctx.transform(1, 0, 0, 1, sliceX, curlY);
        ctx.drawImage(
          canvas,
          (directionIsNext
            ? width - sliceWidth - sliceX
            : sliceX + foldX) * 1,
          0,
          sliceWidth,
          height,
          0,
          0,
          scaleX,
          height,
        );
        ctx.restore();
      }

      // Fold shadow + highlight
      const grad = ctx.createLinearGradient(0, 0, foldWidth, 0);
      grad.addColorStop(0, "rgba(0,0,0,0.22)");
      grad.addColorStop(0.45, "rgba(0,0,0,0.08)");
      grad.addColorStop(0.9, "rgba(0,0,0,0.00)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, foldWidth, height);

      const highlight = ctx.createLinearGradient(
        foldWidth * 0.7,
        0,
        foldWidth,
        0,
      );
      highlight.addColorStop(0, "rgba(255,255,255,0.00)");
      highlight.addColorStop(0.9, "rgba(255,255,255,0.10)");
      highlight.addColorStop(1, "rgba(255,255,255,0.05)");
      ctx.fillStyle = highlight;
      ctx.fillRect(foldWidth * 0.7, 0, foldWidth * 0.3, height);

      ctx.restore();
      ctx.restore();

      // Spine shadow at fold line
      const shadowAlpha = 0.22 + 0.18 * Math.sin(progress * Math.PI);
      const shadowGrad = ctx.createLinearGradient(
        foldX - width * 0.08,
        0,
        foldX + width * 0.06,
        0,
      );
      shadowGrad.addColorStop(0, `rgba(0,0,0,${(shadowAlpha * 0.2).toFixed(3)})`);
      shadowGrad.addColorStop(
        0.45,
        `rgba(0,0,0,${(shadowAlpha * 0.7).toFixed(3)})`,
      );
      shadowGrad.addColorStop(1, "rgba(0,0,0,0.00)");
      ctx.fillStyle = shadowGrad;
      ctx.fillRect(foldX - width * 0.08, 0, width * 0.14, height);

      ctx.fillStyle = `rgba(0,0,0,${(0.08 + 0.07 * Math.sin(progress * Math.PI)).toFixed(3)})`;
      ctx.fillRect(foldX - 1, 0, 2, height);
    } else {
      // Idle: draw current page
      drawPageTexture(ctx, currentImg, width, height, pageIdx);
      drawSpineShadow(ctx, width, height);
    }

    ctx.restore();
  }, [ensureImage, pages]);

  // ── Animation loop ──
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const local = stateRef.current;

      if (
        local.flipState === "animating-complete" ||
        local.flipState === "animating-cancel"
      ) {
        const elapsed = performance.now() - local.animationStart;
        const duration =
          local.flipState === "animating-complete"
            ? FINISH_DURATION
            : CANCEL_DURATION;
        const t = clamp(elapsed / duration, 0, 1);
        const eased =
          local.flipState === "animating-complete"
            ? easeOutCubic(t)
            : easeInOutCubic(t);
        local.flipProgress =
          local.animationFrom +
          (local.animationTo - local.animationFrom) * eased;

        if (t >= 1) {
          if (local.flipState === "animating-complete") {
            const targetPage =
              local.flipDirection === "next"
                ? Math.min(totalPages - 1, local.internalPage + 1)
                : Math.max(0, local.internalPage - 1);
            setInternalPage(targetPage);
            local.internalPage = targetPage;
            // Notify parent only after animation completes
            onPageChange(targetPage);
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
  }, [totalPages, renderFrame, onPageChange]);

  // ── Pointer handlers ──
  const beginFlip = useCallback(
    (
      clientX: number,
      clientY: number,
      pointerId: number,
      dir: "next" | "prev",
    ) => {
      const local = stateRef.current;
      if (local.flipState !== "idle") return;
      if (dir === "next" && local.internalPage >= totalPages - 1) return;
      if (dir === "prev" && local.internalPage <= 0) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(pointerId);

      local.flipState = dir === "next" ? "dragging-next" : "dragging-prev";
      local.flipDirection = dir;
      local.startPointerX = clientX;
      local.startPointerY = clientY;
      local.currentPointerX = clientX;
      local.flipProgress = 0;
      local.pointerId = pointerId;
      local.tapStartX = clientX;
      local.tapStartY = clientY;

      setFlipState(local.flipState);
    },
    [totalPages],
  );

  const moveFlip = useCallback((clientX: number) => {
    const local = stateRef.current;
    if (
      local.flipState !== "dragging-next" &&
      local.flipState !== "dragging-prev"
    )
      return;

    local.currentPointerX = clientX;
    const dx =
      local.flipDirection === "next"
        ? local.startPointerX - clientX
        : clientX - local.startPointerX;
    const containerWidth =
      containerRef.current?.getBoundingClientRect().width ?? 1;
    local.flipProgress = clamp(dx / containerWidth, 0, 1);
  }, []);

  const endFlip = useCallback(() => {
    const local = stateRef.current;
    if (
      local.flipState !== "dragging-next" &&
      local.flipState !== "dragging-prev"
    )
      return;

    const finish = local.flipProgress >= FLIP_THRESHOLD;
    local.flipState = finish ? "animating-complete" : "animating-cancel";
    local.animationStart = performance.now();
    local.animationFrom = local.flipProgress;
    local.animationTo = finish ? 1 : 0;
    setFlipState(local.flipState);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (reducedMotion) return;
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const localX = e.clientX - containerRect.left;
      const half = containerRect.width / 2;
      const isNext =
        direction === "ltr" ? localX > half : localX < half;
      beginFlip(e.clientX, e.clientY, e.pointerId, isNext ? "next" : "prev");
    },
    [beginFlip, direction, reducedMotion],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      moveFlip(e.clientX);
    },
    [moveFlip],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const local = stateRef.current;

      // Detect tap (very small movement) → onTapCenter
      const dx = Math.abs(e.clientX - local.tapStartX);
      const dy = Math.abs(e.clientY - local.tapStartY);
      if (dx < 6 && dy < 6 && local.flipState === "idle") {
        const containerRect =
          containerRef.current?.getBoundingClientRect();
        if (containerRect) {
          const relX = (e.clientX - containerRect.left) / containerRect.width;
          // Center third is a tap
          if (relX > 0.3 && relX < 0.7) {
            onTapCenter?.();
            return;
          }
        }
      }

      endFlip();
    },
    [endFlip, onTapCenter],
  );

  const onPointerCancel = useCallback(() => {
    endFlip();
  }, [endFlip]);

  // ── Reduced motion: fallback to instant page change ──
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!reducedMotion) return;
      const containerRect =
        containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const relX = (e.clientX - containerRect.left) / containerRect.width;
      const relY = (e.clientY - containerRect.top) / containerRect.height;

      // Center third → tap center
      if (relX > 0.3 && relX < 0.7 && relY > 0.3 && relY < 0.7) {
        onTapCenter?.();
        return;
      }

      const local = stateRef.current;
      if (local.flipState !== "idle") return;

      const isNext =
        direction === "ltr" ? relX > 0.5 : relX < 0.5;
      if (isNext) {
        const next = Math.min(totalPages - 1, local.internalPage + 1);
        setInternalPage(next);
        onPageChange(next);
      } else {
        const prev = Math.max(0, local.internalPage - 1);
        setInternalPage(prev);
        onPageChange(prev);
      }
    },
    [reducedMotion, direction, totalPages, onPageChange, onTapCenter],
  );

  // ── Keyboard navigation ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const local = stateRef.current;
      if (local.flipState !== "idle") return;

      if (e.key === "ArrowRight") {
        const next =
          direction === "ltr"
            ? Math.min(totalPages - 1, local.internalPage + 1)
            : Math.max(0, local.internalPage - 1);
        if (next !== local.internalPage) {
          setInternalPage(next);
          onPageChange(next);
        }
      } else if (e.key === "ArrowLeft") {
        const prev =
          direction === "ltr"
            ? Math.max(0, local.internalPage - 1)
            : Math.min(totalPages - 1, local.internalPage + 1);
        if (prev !== local.internalPage) {
          setInternalPage(prev);
          onPageChange(prev);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [direction, totalPages, onPageChange]);

  return (
    <div
      ref={containerRef}
      className="relative mx-auto flex h-dvh w-full items-center justify-center overflow-hidden"
      style={{ background: "transparent" }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={handleClick}
      />
    </div>
  );
}