"use client";

import { GripVertical, RotateCcw } from "lucide-react";

interface ResizeDividerProps {
  /** 是否正在拖拽 */
  isDragging: boolean;
  /** 拖拽开始处理函数 */
  onMouseDown: (e: React.MouseEvent) => void;
  /** 重置宽度 */
  onReset?: () => void;
  /** 是否显示重置按钮（双击时触发） */
  showResetOnDoubleClick?: boolean;
}

/**
 * 可拖拽的面板分隔条组件
 * 提供视觉反馈（悬停变色、拖拽图标）和双击重置功能
 */
export function ResizeDivider({
  isDragging,
  onMouseDown,
  onReset,
  showResetOnDoubleClick = true,
}: ResizeDividerProps) {
  return (
    <div
      className={`
        relative flex-shrink-0 w-2 cursor-col-resize z-30
        group/divider select-none
        transition-colors duration-150
        ${isDragging ? "bg-accent/40" : "bg-border/20 hover:bg-accent/25"}
      `}
      onMouseDown={onMouseDown}
      onDoubleClick={showResetOnDoubleClick ? onReset : undefined}
      title="拖拽调整宽度 · 双击重置"
    >
      {/* 拖拽手柄图标 - 居中显示，使用 z-40 确保不被遮挡 */}
      <div
        className={`
          absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          flex items-center justify-center
          w-6 h-12 rounded-md z-40 pointer-events-none
          transition-all duration-200
          ${
            isDragging
              ? "bg-accent/30 text-accent scale-110"
              : "bg-card/80 text-muted/40 group-hover/divider:bg-accent/15 group-hover/divider:text-accent/70 shadow-sm"
          }
        `}
      >
        <GripVertical className="h-4 w-4" />
      </div>

      {/* 拖拽时的高亮线 */}
      {isDragging && (
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] bg-accent/60 rounded-full" />
      )}

      {/* 重置提示（悬停时在底部显示） */}
      {onReset && (
        <div
          className={`
            absolute bottom-4 left-1/2 -translate-x-1/2
            flex items-center justify-center
            w-6 h-6 rounded-full z-40
            bg-card border border-border/40 shadow-sm
            text-muted/50
            opacity-0 group-hover/divider:opacity-100
            transition-all duration-200
            hover:text-accent hover:border-accent/30 hover:bg-accent/5
            cursor-pointer
          `}
          onClick={(e) => {
            e.stopPropagation();
            onReset();
          }}
          title="重置为默认宽度"
        >
          <RotateCcw className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}
