"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  Info,
  Heart,
  HeartOff,
  FolderInput,
  Trash2,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export interface ContextMenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  hidden?: boolean;
}

interface ComicContextMenuProps {
  x: number;
  y: number;
  comicId: string;
  comicTitle: string;
  isFavorite?: boolean;
  onClose: () => void;
  onRead: (id: string) => void;
  onDetail: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onAddToGroup: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function ComicContextMenu({
  x,
  y,
  comicId,
  comicTitle,
  isFavorite,
  onClose,
  onRead,
  onDetail,
  onToggleFavorite,
  onAddToGroup,
  onDelete,
}: ComicContextMenuProps) {
  const t = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 使用 state 管理最终位置，初始隐藏避免闪烁
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 点击外部关闭
  useEffect(() => {
    const handleClick = () => onClose();
    const handleScroll = () => onClose();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // 用 setTimeout 避免触发右键时就关闭
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClick);
      document.addEventListener("contextmenu", handleClick);
      document.addEventListener("scroll", handleScroll, true);
      document.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("contextmenu", handleClick);
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // 挂载后测量菜单尺寸，计算最终位置
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - 8) left = vw - rect.width - 8;
    if (top + rect.height > vh - 8) top = vh - rect.height - 8;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    setPos({ left, top });
  }, [x, y]);

  const menuItems: ContextMenuItem[] = [
    {
      key: "read",
      label: t.contextMenu?.read || "阅读",
      icon: <BookOpen className="h-3.5 w-3.5" />,
    },
    {
      key: "detail",
      label: t.contextMenu?.detail || "详情",
      icon: <Info className="h-3.5 w-3.5" />,
    },
    {
      key: "favorite",
      label: isFavorite
        ? (t.contextMenu?.unfavorite || "取消收藏")
        : (t.contextMenu?.favorite || "收藏"),
      icon: isFavorite
        ? <HeartOff className="h-3.5 w-3.5" />
        : <Heart className="h-3.5 w-3.5" />,
    },
    {
      key: "addToGroup",
      label: t.contextMenu?.addToGroup || "加入分组",
      icon: <FolderInput className="h-3.5 w-3.5" />,
    },
    {
      key: "delete",
      label: confirmDelete
        ? (t.contextMenu?.confirmDelete || "确认删除？")
        : (t.contextMenu?.delete || "删除"),
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
    },
  ];

  const handleAction = (key: string) => {
    switch (key) {
      case "read":
        onRead(comicId);
        onClose();
        break;
      case "detail":
        onDetail(comicId);
        onClose();
        break;
      case "favorite":
        onToggleFavorite(comicId);
        onClose();
        break;
      case "addToGroup":
        onAddToGroup(comicId);
        onClose();
        break;
      case "delete":
        if (!confirmDelete) {
          // 第一次点击，进入确认状态
          setConfirmDelete(true);
          return; // 不关闭菜单
        }
        // 第二次点击，执行删除
        onDelete(comicId);
        onClose();
        break;
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[180px] rounded-xl border border-border/60 bg-card/95 py-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
      style={{
        left: pos ? pos.left : x,
        top: pos ? pos.top : y,
        // 初次渲染时隐藏，等位置计算完成后显示，避免闪烁
        visibility: pos ? "visible" : "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 标题 */}
      <div className="mx-2 mb-1 truncate rounded-lg bg-muted/10 px-2.5 py-1.5">
        <p className="truncate text-[11px] font-medium text-muted/70">{comicTitle}</p>
      </div>

      <div className="my-1 h-px bg-border/30" />

      {menuItems.filter(item => !item.hidden).map((item, index) => (
        <div key={item.key}>
          {item.danger && index > 0 && (
            <div className="my-1 h-px bg-border/30" />
          )}
          <button
            onClick={() => handleAction(item.key)}
            className={`mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
              item.danger
                ? "text-red-400 hover:bg-red-500/10"
                : "text-foreground/80 hover:bg-accent/10 hover:text-foreground"
            }`}
          >
            <span className={item.danger ? "text-red-400/70" : "text-muted/60"}>
              {item.icon}
            </span>
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
