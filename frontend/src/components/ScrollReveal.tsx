"use client";

import { useInView } from "@/hooks/useInView";
import type { ReactNode } from "react";

interface ScrollRevealProps {
  children: ReactNode;
  /** 延迟（ms），用于交错效果 */
  delay?: number;
  /** 额外 class */
  className?: string;
  /** 是否禁用（比如已有入场动画时） */
  disabled?: boolean;
}

/**
 * 滚动渐入包装器 — 子元素进入视口时播放渐入动画
 */
export default function ScrollReveal({
  children,
  delay = 0,
  className = "",
  disabled = false,
}: ScrollRevealProps) {
  const [ref, isInView] = useInView<HTMLDivElement>({ threshold: 0.05, once: true });

  if (disabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={ref}
      className={`${className} ${isInView ? "animate-scroll-in" : "scroll-reveal"}`}
      style={delay > 0 ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
