"use client";

import { useCallback, useEffect, useRef, type ComponentProps } from "react";
import ReaderToolbarBase from "./ReaderToolbar";

export type { ReaderTheme } from "./ReaderToolbar";
export const PDF_PAGE_PREVIEW_EVENT = "nowen-reader:pdf-page-preview";

type ReaderToolbarProps = ComponentProps<typeof ReaderToolbarBase>;

/**
 * ReaderToolbar 的性能适配层。
 *
 * 原进度条在拖动期间每个 animation frame 都会调用 onPageChange。对于超大 PDF，
 * 这会连续触发大量随机页解析和网络 Range 请求。这里在工具栏处于 interacting
 * 状态时仅记录最后一个目标页，松手后只提交一次；停留一小段时间则广播预取事件，
 * 让 PDF.js 提前读取目标页对象。
 */
export default function ReaderToolbarOptimized({
  onPageChange,
  onInteracting,
  ...props
}: ReaderToolbarProps) {
  const interactingRef = useRef(false);
  const pendingPageRef = useRef<number | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);

  const emitPreview = useCallback((page: number | null) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(PDF_PAGE_PREVIEW_EVENT, { detail: { page } }));
  }, []);

  const finishInteraction = useCallback(() => {
    if (!interactingRef.current) return;
    interactingRef.current = false;
    onInteracting?.(false);
    clearPreviewTimer();
    emitPreview(null);

    const target = pendingPageRef.current;
    pendingPageRef.current = null;
    if (target !== null) onPageChange(target);
  }, [clearPreviewTimer, emitPreview, onInteracting, onPageChange]);

  const handlePageChange = useCallback((page: number) => {
    if (!interactingRef.current) {
      onPageChange(page);
      return;
    }

    pendingPageRef.current = page;
    clearPreviewTimer();
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      emitPreview(pendingPageRef.current);
    }, 180);
  }, [clearPreviewTimer, emitPreview, onPageChange]);

  const handleInteracting = useCallback((interacting: boolean) => {
    if (interacting) {
      interactingRef.current = true;
      onInteracting?.(true);
      return;
    }
    finishInteraction();
  }, [finishInteraction, onInteracting]);

  useEffect(() => {
    // 用户可能在滑块外释放鼠标/手指。全局收尾可避免工具栏永久停留在
    // interacting 状态，也保证最终目标页只提交一次。
    const finish = () => finishInteraction();
    window.addEventListener("mouseup", finish);
    window.addEventListener("touchend", finish);
    window.addEventListener("touchcancel", finish);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("touchend", finish);
      window.removeEventListener("touchcancel", finish);
      window.removeEventListener("blur", finish);
      clearPreviewTimer();
      emitPreview(null);
    };
  }, [clearPreviewTimer, emitPreview, finishInteraction]);

  return (
    <ReaderToolbarBase
      {...props}
      onPageChange={handlePageChange}
      onInteracting={handleInteracting}
    />
  );
}
