"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";

// ============================================================
// Toast 类型定义
// ============================================================

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);
const COMICS_LOAD_ERROR_EVENT = "nowen-comics-load-error";

// ============================================================
// Hook
// ============================================================

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // 降级：未包裹 Provider 时静默失败
    return {
      toast: () => {},
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
    };
  }
  return ctx;
}

// ============================================================
// 图标映射
// ============================================================

const iconMap: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="h-4 w-4 text-emerald-400" />,
  error: <XCircle className="h-4 w-4 text-red-400" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-400" />,
  info: <Info className="h-4 w-4 text-blue-400" />,
};

const bgMap: Record<ToastType, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10",
  error: "border-red-500/30 bg-red-500/10",
  warning: "border-amber-500/30 bg-amber-500/10",
  info: "border-blue-500/30 bg-blue-500/10",
};

// ============================================================
// 单条 Toast 项
// ============================================================

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => onRemove(toast.id), 300);
    }, toast.duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.duration, onRemove]);

  const handleClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 300);
  }, [toast.id, onRemove]);

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg surface-glass-panel transition-all duration-[var(--duration-normal)] ${
        bgMap[toast.type]
      } ${isExiting ? "translate-x-full opacity-0" : "animate-toast-in"}`}
      role="alert"
    >
      {iconMap[toast.type]}
      <p className="flex-1 text-sm text-foreground">{toast.message}</p>
      <button
        onClick={handleClose}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted transition-colors hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ============================================================
// Provider + Container
// ============================================================

let idCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = "info", duration: number = 3000) => {
    const id = `toast-${++idCounter}-${Date.now()}`;
    setToasts((prev) => [...prev.slice(-4), { id, type, message, duration }]); // 最多保留 5 条
  }, []);

  // 书库列表请求失败不能再伪装成“0 本/空书库”。useComics 在真正的网络/API
  // 错误时派发全局事件，由现有 Toast 基础设施统一呈现，不给业务页复制提示逻辑。
  useEffect(() => {
    const handleComicsLoadError = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      if (message) addToast(message, "error", 6000);
    };
    window.addEventListener(COMICS_LOAD_ERROR_EVENT, handleComicsLoadError);
    return () => window.removeEventListener(COMICS_LOAD_ERROR_EVENT, handleComicsLoadError);
  }, [addToast]);

  const contextValue: ToastContextType = {
    toast: addToast,
    success: useCallback((msg: string, dur?: number) => addToast(msg, "success", dur), [addToast]),
    error: useCallback((msg: string, dur?: number) => addToast(msg, "error", dur), [addToast]),
    warning: useCallback((msg: string, dur?: number) => addToast(msg, "warning", dur), [addToast]),
    info: useCallback((msg: string, dur?: number) => addToast(msg, "info", dur), [addToast]),
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}

      {/* Toast Container — 固定在右上角 */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[9999] flex w-80 flex-col gap-2">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onRemove={removeToast} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
