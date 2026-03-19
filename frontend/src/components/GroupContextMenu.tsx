"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  FolderOpen,
  Pencil,
  Trash2,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface GroupContextMenuProps {
  x: number;
  y: number;
  groupId: number;
  groupName: string;
  onClose: () => void;
  onOpen: (id: number) => void;
  onRename: (id: number, currentName: string) => void;
  onDelete: (id: number) => void;
}

export default function GroupContextMenu({
  x,
  y,
  groupId,
  groupName,
  onClose,
  onOpen,
  onRename,
  onDelete,
}: GroupContextMenuProps) {
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

  const menuItems = [
    {
      key: "open",
      label: t.contextMenu?.openGroup || "打开分组",
      icon: <FolderOpen className="h-3.5 w-3.5" />,
    },
    {
      key: "rename",
      label: t.contextMenu?.renameGroup || "重命名",
      icon: <Pencil className="h-3.5 w-3.5" />,
    },
    {
      key: "delete",
      label: confirmDelete
        ? (t.contextMenu?.confirmDelete || "确认删除？")
        : (t.contextMenu?.deleteGroup || "删除分组"),
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
    },
  ];

  const handleAction = (key: string) => {
    switch (key) {
      case "open":
        onOpen(groupId);
        onClose();
        break;
      case "rename":
        onRename(groupId, groupName);
        onClose();
        break;
      case "delete":
        if (!confirmDelete) {
          setConfirmDelete(true);
          return;
        }
        onDelete(groupId);
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
        visibility: pos ? "visible" : "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 标题 */}
      <div className="mx-2 mb-1 truncate rounded-lg bg-muted/10 px-2.5 py-1.5">
        <p className="truncate text-[11px] font-medium text-muted/70">📚 {groupName}</p>
      </div>

      <div className="my-1 h-px bg-border/30" />

      {menuItems.map((item, index) => (
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
