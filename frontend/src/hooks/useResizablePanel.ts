import { useState, useCallback, useRef, useEffect } from "react";

export interface UseResizablePanelOptions {
  /** localStorage 存储键名 */
  storageKey: string;
  /** 默认宽度（px） */
  defaultWidth: number;
  /** 最小宽度（px） */
  minWidth: number;
  /** 最大宽度（px） */
  maxWidth: number;
  /** 拖拽方向：'left' 表示拖拽调整左侧面板，'right' 表示拖拽调整右侧面板 */
  side?: "left" | "right";
}

export interface UseResizablePanelReturn {
  /** 当前面板宽度 */
  width: number;
  /** 是否正在拖拽 */
  isDragging: boolean;
  /** 拖拽开始处理函数（绑定到分隔条的 onMouseDown） */
  handleMouseDown: (e: React.MouseEvent) => void;
  /** 重置为默认宽度 */
  resetWidth: () => void;
  /** 手动设置宽度 */
  setWidth: (w: number) => void;
}

/**
 * 可拖拽调整面板宽度的 Hook
 * 支持 localStorage 持久化、最小/最大宽度约束、重置功能
 */
export function useResizablePanel(options: UseResizablePanelOptions): UseResizablePanelReturn {
  const { storageKey, defaultWidth, minWidth, maxWidth, side = "right" } = options;

  // 从 localStorage 读取初始宽度
  const [width, setWidthState] = useState<number>(() => {
    if (typeof window === "undefined") return defaultWidth;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return defaultWidth;
  });

  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // 保存到 localStorage
  const saveWidth = useCallback(
    (w: number) => {
      try {
        localStorage.setItem(storageKey, String(w));
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  // 拖拽开始
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;
    },
    [width]
  );

  // 拖拽中 & 拖拽结束（全局事件）
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const delta = e.clientX - startXRef.current;
      // 右侧面板：鼠标向左拖 → 面板变宽（delta 为负）
      // 左侧面板：鼠标向右拖 → 面板变宽（delta 为正）
      const newWidth =
        side === "right"
          ? startWidthRef.current - delta
          : startWidthRef.current + delta;
      const clamped = Math.max(minWidth, Math.min(maxWidth, newWidth));
      setWidthState(clamped);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // 拖拽结束时保存
      setWidthState((current) => {
        saveWidth(current);
        return current;
      });
    };

    // 添加全局事件监听（确保鼠标移出分隔条后仍能拖拽）
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    // 拖拽时禁止文本选择
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, minWidth, maxWidth, side, saveWidth]);

  // 重置为默认宽度
  const resetWidth = useCallback(() => {
    setWidthState(defaultWidth);
    saveWidth(defaultWidth);
  }, [defaultWidth, saveWidth]);

  // 手动设置宽度
  const setWidth = useCallback(
    (w: number) => {
      const clamped = Math.max(minWidth, Math.min(maxWidth, w));
      setWidthState(clamped);
      saveWidth(clamped);
    },
    [minWidth, maxWidth, saveWidth]
  );

  return {
    width,
    isDragging,
    handleMouseDown,
    resetWidth,
    setWidth,
  };
}
