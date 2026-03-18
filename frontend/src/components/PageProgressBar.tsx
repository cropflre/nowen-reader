"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";

/**
 * NProgress 风格的顶部页面加载进度条
 * 路由切换时自动触发，加载完成后消失
 */
export default function PageProgressBar() {
  const location = useLocation();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPath = useRef(location.pathname);

  const startProgress = useCallback(() => {
    setVisible(true);
    setProgress(0);
    // 模拟加载过程：快速到 30%，然后逐渐减慢
    let p = 0;
    timerRef.current = setInterval(() => {
      p += Math.max(1, (90 - p) * 0.1);
      if (p >= 90) p = 90;
      setProgress(p);
    }, 50);
  }, []);

  const finishProgress = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setProgress(100);
    // 完成后短暂保持再隐藏
    setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 300);
  }, []);

  useEffect(() => {
    if (location.pathname !== prevPath.current) {
      prevPath.current = location.pathname;
      startProgress();
      // 模拟加载完成（真实场景中组件渲染非常快）
      const timeout = setTimeout(() => {
        finishProgress();
      }, 250);
      return () => clearTimeout(timeout);
    }
  }, [location.pathname, startProgress, finishProgress]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (!visible && progress === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px] pointer-events-none">
      <div
        className="h-full bg-accent transition-all ease-out shadow-[0_0_8px_rgba(99,102,241,0.5)]"
        style={{
          width: `${progress}%`,
          transitionDuration: progress === 100 ? "200ms" : "100ms",
          opacity: visible ? 1 : 0,
        }}
      />
    </div>
  );
}
