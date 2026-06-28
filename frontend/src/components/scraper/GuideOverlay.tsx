"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Lightbulb } from "lucide-react";
import { GUIDE_STEPS, nextGuideStep, prevGuideStep, skipGuide, finishGuide } from "@/lib/scraper-store";

/** 获取安全视口尺寸（兼容 iOS visualViewport + safe-area） */
function getSafeViewport() {
  const vv = window.visualViewport;
  return {
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
    offsetTop: vv?.offsetTop ?? 0,
    offsetLeft: vv?.offsetLeft ?? 0,
  };
}

/** 获取移动端底部避让高度（BottomNav h-14 + safe-area） */
function getBottomOffset(): number {
  const isMobile = window.innerWidth < 640;
  if (!isMobile) return 0;
  // 尝试读取实际 BottomNav 高度（包含 safe-area padding）
  const bottomNav = document.querySelector("nav.fixed.bottom-0");
  if (bottomNav) {
    const navRect = bottomNav.getBoundingClientRect();
    // navRect.height 已包含 padding-bottom (safe-area-inset-bottom)
    return navRect.height + 12;
  }
  // 兜底：h-14 = 56px + 预估 safe-area 20px + 间距 12px
  return 88;
}

export function GuideOverlay({
  scraperT,
  currentStep,
}: {
  scraperT: Record<string, string>;
  currentStep: number;
}) {
  const step = GUIDE_STEPS[currentStep];
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const totalSteps = GUIDE_STEPS.length;
  const maskId = useRef(`guide-mask-${Math.random().toString(36).slice(2, 8)}`).current;
  const tooltipRef = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  // 计算目标元素位置的函数
  const updateTargetRect = useCallback(() => {
    if (!step) { setTargetRect(null); return; }
    const el = document.querySelector(step.targetSelector);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setTargetRect(rect);
      } else {
        setTargetRect(null);
      }
    } else {
      setTargetRect(null);
    }
  }, [step]);

  // 当步骤切换时：滚动目标元素到可见区域并计算位置
  useEffect(() => {
    if (!step) return;
    const el = document.querySelector(step.targetSelector);
    if (el) {
      // 滚动到可见区域，block: "center" 确保上下都有空间放 tooltip
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      });
      // 延迟计算位置（等待 scroll + 动画完成）
      const timer = setTimeout(updateTargetRect, 400);
      return () => clearTimeout(timer);
    } else {
      // 目标元素不存在 → 自动跳过该步骤
      setTargetRect(null);
      const skipTimer = setTimeout(() => {
        if (currentStep < totalSteps - 1) {
          nextGuideStep();
        } else {
          finishGuide();
        }
      }, 100);
      return () => clearTimeout(skipTimer);
    }
  }, [currentStep, step, totalSteps, updateTargetRect]);

  // 监听窗口 resize、scroll 和 visualViewport 变化
  useEffect(() => {
    if (!step) return;

    const handleUpdate = () => { updateTargetRect(); };
    window.addEventListener("resize", handleUpdate);
    window.addEventListener("scroll", handleUpdate, true);
    // iOS 缩放/键盘弹出时 visualViewport 会变化
    window.visualViewport?.addEventListener("resize", handleUpdate);
    window.visualViewport?.addEventListener("scroll", handleUpdate);

    return () => {
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("scroll", handleUpdate, true);
      window.visualViewport?.removeEventListener("resize", handleUpdate);
      window.visualViewport?.removeEventListener("scroll", handleUpdate);
    };
  }, [step, updateTargetRect]);

  if (!step) return null;

  const stepLabel = (scraperT.guideStepOf || "步骤 {current}/{total}")
    .replace("{current}", String(currentStep + 1))
    .replace("{total}", String(totalSteps));

  // 计算弹窗位置（移动端安全区适配 + 视口 clamp）
  const getTooltipStyle = (): React.CSSProperties => {
    const { width: vw, height: vh, offsetTop: vTop, offsetLeft: vLeft } = getSafeViewport();
    const bottomOffset = getBottomOffset();
    const margin = isMobile ? 10 : 16;
    // 移动端 tooltip 宽度自适应：不超过视口宽度减去两侧间距
    const tooltipW = isMobile ? Math.min(340, vw - margin * 2) : 360;
    const tooltipH = 260; // 预估高度
    const safeBottom = Math.max(margin, bottomOffset); // 底部安全距离

    if (!targetRect) {
      // 无目标元素时居中显示，但底部要避开 BottomNav
      return {
        position: "fixed",
        zIndex: 10002,
        top: vTop + Math.max(margin, (vh - tooltipH) / 3),
        left: vLeft + (vw - tooltipW) / 2,
        width: tooltipW,
      };
    }

    const gap = isMobile ? 10 : 16;
    const style: React.CSSProperties = { position: "fixed", zIndex: 10002, width: tooltipW };

    // 移动端：left/right placement 强制改为 bottom（水平空间不足）
    const effectivePlacement = isMobile && (step.placement === "left" || step.placement === "right")
      ? "bottom"
      : step.placement;

    switch (effectivePlacement) {
      case "bottom": {
        let top = targetRect.bottom + gap;
        // 如果底部超出视口（含 BottomNav 避让），改到目标上方
        if (top + tooltipH > vTop + vh - safeBottom) {
          top = targetRect.top - tooltipH - gap;
        }
        // 如果上方也超出，贴底部安全区上方
        if (top < vTop + margin) {
          top = vTop + vh - safeBottom - tooltipH;
        }
        style.top = Math.max(vTop + margin, top);
        style.left = vLeft + Math.max(margin, Math.min(targetRect.left, vw - tooltipW - margin));
        break;
      }
      case "top": {
        let bottom = vh - targetRect.top + gap;
        // 如果上方超出视口，改到目标下方
        if (targetRect.top - gap - tooltipH < vTop + margin) {
          style.top = targetRect.bottom + gap;
        } else {
          style.bottom = bottom;
        }
        style.left = vLeft + Math.max(margin, Math.min(targetRect.left, vw - tooltipW - margin));
        break;
      }
      case "left": {
        style.top = vTop + Math.max(margin, Math.min(targetRect.top, vh - tooltipH - margin));
        const right = vw - targetRect.left + gap;
        if (targetRect.left - gap - tooltipW < margin) {
          style.left = targetRect.right + gap;
        } else {
          style.right = right;
        }
        break;
      }
      case "right": {
        style.top = vTop + Math.max(margin, Math.min(targetRect.top, vh - tooltipH - margin));
        const left = targetRect.right + gap;
        if (left + tooltipW > vw - margin) {
          style.right = vw - targetRect.left + gap;
        } else {
          style.left = left;
        }
        break;
      }
    }
    return style;
  };

  return (
    <div className="fixed inset-0 z-[10000]" style={{ pointerEvents: "auto" }}>
      {/* 暗色遮罩（排除高亮区域）— 点击遮罩区域不做任何操作 */}
      <svg
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 10000, pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - 6}
                y={targetRect.top - 6}
                width={targetRect.width + 12}
                height={targetRect.height + 12}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask={`url(#${maskId})`}
        />
      </svg>

      {/* 高亮区域的透明交互层 — 允许用户点击高亮区域 */}
      {targetRect && (
        <div
          className="fixed"
          style={{
            zIndex: 10001,
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            pointerEvents: "auto",
          }}
        />
      )}

      {/* 高亮边框 */}
      {targetRect && (
        <div
          className="fixed border-2 border-accent rounded-xl pointer-events-none"
          style={{
            zIndex: 10001,
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            boxShadow: "0 0 0 4px rgba(var(--accent-rgb, 99 102 241) / 0.3), 0 0 20px rgba(var(--accent-rgb, 99 102 241) / 0.2)",
            animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          }}
        />
      )}

      {/* 提示卡片 — 移动端使用 bottom sheet 风格 */}
      <div
        ref={tooltipRef}
        style={getTooltipStyle()}
        className={`rounded-2xl bg-card border border-border/60 shadow-2xl p-4 sm:p-5 space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-300 ${
          isMobile ? "max-h-[45vh] overflow-y-auto" : ""
        }`}
      >
        {/* 步骤指示器 */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-accent bg-accent/10 rounded-full px-2.5 py-0.5">
            {stepLabel}
          </span>
          <div className="flex gap-1">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === currentStep ? "w-4 bg-accent" : i < currentStep ? "w-1.5 bg-accent/40" : "w-1.5 bg-border/60"
                }`}
              />
            ))}
          </div>
        </div>

        {/* 标题 + 描述 */}
        <div className="space-y-1.5">
          <h4 className="text-sm font-bold text-foreground leading-tight">
            {scraperT[step.titleKey] || step.titleKey}
          </h4>
          <p className="text-xs text-muted leading-relaxed">
            {scraperT[step.descKey] || step.descKey}
          </p>
        </div>

        {/* 操作提示（可选） */}
        {step.actionKey && (
          <div className="flex items-start gap-2 rounded-lg bg-accent/5 border border-accent/20 p-2.5">
            <Lightbulb className="h-3.5 w-3.5 text-accent flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-accent/80 leading-relaxed">
              {scraperT[step.actionKey] || step.actionKey}
            </p>
          </div>
        )}

        {/* 导航按钮 — 移动端按钮更大更易点击 */}
        <div className="flex items-center justify-between pt-1 gap-2">
          <button
            onClick={skipGuide}
            className="text-[11px] sm:text-[11px] text-muted hover:text-foreground transition-colors py-1.5 sm:py-0"
          >
            {scraperT.guideSkip || "跳过教程"}
          </button>
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                onClick={prevGuideStep}
                className="flex items-center gap-1 rounded-lg border border-border/40 px-3 py-2 sm:py-1.5 text-[12px] sm:text-[11px] font-medium text-muted hover:text-foreground hover:bg-card-hover transition-all"
              >
                <ChevronLeft className="h-3 w-3" />
                {scraperT.guidePrev || "上一步"}
              </button>
            )}
            <button
              onClick={currentStep < totalSteps - 1 ? nextGuideStep : finishGuide}
              className="flex items-center gap-1 rounded-lg bg-accent px-3.5 py-2 sm:py-1.5 text-[12px] sm:text-[11px] font-medium text-white shadow-sm hover:bg-accent-hover transition-all"
            >
              {currentStep < totalSteps - 1
                ? (scraperT.guideNext || "下一步")
                : (scraperT.guideFinish || "完成")
              }
              {currentStep < totalSteps - 1 && <ChevronRight className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

