"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  X,
  User,
  Layers,
  CheckCircle,
  AlertCircle,
  Clock,
  Sparkles,
  BookOpen,
  Loader2,
  Pencil,
  Save,
} from "lucide-react";
import { updateGroupMetadata } from "@/api/groups";
import { loadScraperGroups } from "@/lib/scraper-store";
import type { ScraperGroup } from "@/lib/scraper-store";
import { GroupMetadataSearch } from "./GroupMetadataSearch";

/* ── 可编辑字段定义 ── */
interface EditableField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number";
  placeholder?: string;
}

const EDITABLE_FIELDS: EditableField[] = [
  { key: "author", label: "作者", type: "text", placeholder: "输入作者名" },
  { key: "genre", label: "类型", type: "text", placeholder: "如：科幻, 冒险, 幽默" },
  { key: "year", label: "年份", type: "number", placeholder: "如：2002" },
  { key: "publisher", label: "出版社", type: "text", placeholder: "输入出版社" },
  { key: "language", label: "语言", type: "text", placeholder: "如：zh, ja, en" },
  { key: "status", label: "状态", type: "text", placeholder: "如：连载中, 已完结" },
  { key: "description", label: "简介", type: "textarea", placeholder: "输入简介..." },
];

/* ── 内联编辑字段组件 ── */
function InlineEditField({
  label,
  value,
  type,
  placeholder,
  saving,
  onSave,
}: {
  label: string;
  value: string;
  type: "text" | "textarea" | "number";
  placeholder?: string;
  saving: boolean;
  onSave: (newValue: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      // 对于 textarea，自动调整高度
      if (inputRef.current instanceof HTMLTextAreaElement) {
        inputRef.current.style.height = "auto";
        inputRef.current.style.height = inputRef.current.scrollHeight + "px";
      }
    }
  }, [editing]);

  const handleSave = async () => {
    const trimmed = inputValue.trim();
    if (trimmed === value) {
      setEditing(false);
      return;
    }
    await onSave(trimmed);
    setEditing(false);
  };

  const handleCancel = () => {
    setInputValue(value);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && type !== "textarea") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      handleCancel();
    }
  };

  if (editing) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-muted/50 text-[11px] font-medium">{label}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}
              保存
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted hover:text-foreground bg-card-hover hover:bg-card-hover/80 transition-colors disabled:opacity-50"
            >
              <X className="h-2.5 w-2.5" />
              取消
            </button>
          </div>
        </div>
        {type === "textarea" ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              // 自动调整高度
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCancel();
            }}
            placeholder={placeholder}
            disabled={saving}
            rows={3}
            className="w-full rounded-lg bg-card-hover/60 px-2.5 py-1.5 text-xs text-foreground outline-none border border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all disabled:opacity-50 resize-none leading-relaxed"
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={type}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={saving}
            className="w-full rounded-lg bg-card-hover/60 px-2.5 py-1.5 text-xs text-foreground outline-none border border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all disabled:opacity-50"
          />
        )}
      </div>
    );
  }

  // 显示模式
  const hasValue = value !== "" && value !== undefined && value !== null;
  return (
    <div
      className="group/field flex items-start gap-2 text-xs cursor-pointer rounded-lg px-1 py-0.5 -mx-1 hover:bg-card-hover/40 transition-colors"
      onClick={() => setEditing(true)}
      title="点击编辑"
    >
      <span className="text-muted/50 w-12 flex-shrink-0 pt-0.5">{label}</span>
      <span className={`flex-1 min-w-0 ${hasValue ? "text-foreground/70" : "text-muted/30 italic"}`}>
        {hasValue ? (type === "textarea" ? <span className="line-clamp-3">{value}</span> : value) : `未设置`}
      </span>
      <Pencil className="h-3 w-3 text-muted/30 opacity-0 group-hover/field:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
    </div>
  );
}

/* ── 可编辑标题组件 ── */
function EditableTitle({
  value,
  saving,
  onSave,
}: {
  value: string;
  saving: boolean;
  onSave: (newValue: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleSave = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || trimmed === value) {
      setEditing(false);
      setInputValue(value);
      return;
    }
    await onSave(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-1.5">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") { setEditing(false); setInputValue(value); }
          }}
          autoFocus
          disabled={saving}
          className="w-full rounded-lg bg-card-hover/60 px-2.5 py-1.5 text-sm font-bold text-foreground outline-none border border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all disabled:opacity-50"
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CheckCircle className="h-2.5 w-2.5" />}
            保存
          </button>
          <button
            onClick={() => { setEditing(false); setInputValue(value); }}
            disabled={saving}
            className="flex items-center gap-1 rounded-md bg-card-hover px-2 py-0.5 text-[10px] font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            <X className="h-2.5 w-2.5" />
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex items-start gap-1 cursor-pointer"
      onClick={() => { setInputValue(value); setEditing(true); }}
      title="点击编辑系列名称"
    >
      <h4 className="text-base font-bold text-foreground leading-tight line-clamp-2 flex-1">{value}</h4>
      <span className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0">
        <Pencil className="h-3.5 w-3.5 text-muted" />
      </span>
    </div>
  );
}

/* ── 系列详情面板主组件 ── */
export default function GroupDetailPanel({
  group,
  onClose,
}: {
  group: ScraperGroup;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // 清除保存成功提示
  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  // 保存单个字段
  const handleSaveField = useCallback(async (fieldKey: string, newValue: string) => {
    setSaving(true);
    try {
      const metadata: Record<string, unknown> = {};
      if (fieldKey === "year") {
        const num = parseInt(newValue, 10);
        metadata[fieldKey] = isNaN(num) ? null : num;
      } else {
        metadata[fieldKey] = newValue;
      }
      const ok = await updateGroupMetadata(group.id, metadata);
      if (ok) {
        setSaveSuccess(fieldKey);
        loadScraperGroups();
      }
    } finally {
      setSaving(false);
    }
  }, [group.id]);

  // 获取字段当前值
  const getFieldValue = (key: string): string => {
    switch (key) {
      case "author": return group.author || "";
      case "genre": return group.genre || "";
      case "year": return group.year != null ? String(group.year) : "";
      case "publisher": return group.publisher || "";
      case "language": return group.language || "";
      case "status": return group.status || "";
      case "description": return group.description || "";
      default: return "";
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 flex-shrink-0">
        <h3 className="text-sm font-semibold text-foreground truncate flex-1 mr-2">
          系列详情
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditMode(!editMode)}
            className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors ${
              editMode
                ? "bg-accent/20 text-accent"
                : "text-muted hover:text-foreground hover:bg-card-hover"
            }`}
            title={editMode ? "退出编辑模式" : "进入编辑模式"}
          >
            <Pencil className="h-3 w-3" />
            {editMode ? "编辑中" : "编辑"}
          </button>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 保存成功提示 */}
        {saveSuccess && (
          <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-400 animate-in fade-in slide-in-from-top-1 duration-200">
            <CheckCircle className="h-3 w-3" />
            已保存
          </div>
        )}

        {/* 封面 + 基本信息 */}
        <div className="flex gap-4">
          <div className="relative h-36 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-border/40 bg-muted/10 shadow-lg">
            {group.coverUrl ? (
              <Image
                src={group.coverUrl}
                alt=""
                fill
                className="object-cover"
                sizes="96px"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Layers className="h-8 w-8 text-muted/40" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            {/* 可编辑标题 */}
            {editMode ? (
              <EditableTitle
                value={group.name}
                saving={saving}
                onSave={async (v) => handleSaveField("name", v)}
              />
            ) : (
              <h4 className="text-base font-bold text-foreground leading-tight line-clamp-2">{group.name}</h4>
            )}

            {/* 作者（非编辑模式下显示） */}
            {!editMode && group.author && (
              <p className="text-xs text-muted/60 flex items-center gap-1">
                <User className="h-3 w-3" />
                {group.author}
              </p>
            )}

            <div className="flex flex-wrap gap-1.5">
              {/* 内容类型标签 */}
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                group.contentType === "novel"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-blue-500/10 text-blue-400"
              }`}>
                {group.contentType === "novel" ? "📚 小说" : "📖 漫画"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 px-2 py-0.5 text-[11px] font-medium text-purple-400">
                <Layers className="h-3 w-3" />
                {group.comicCount} 卷
              </span>
              {group.hasMetadata ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                  <CheckCircle className="h-3 w-3" />
                  已有元数据
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                  <AlertCircle className="h-3 w-3" />
                  缺失元数据
                </span>
              )}
              {!editMode && group.status && (
                <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-400">
                  {group.status}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 编辑模式：所有字段可编辑 */}
        {editMode ? (
          <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Pencil className="h-3 w-3 text-accent" />
              <span className="text-[11px] font-medium text-accent">元数据编辑</span>
              <span className="text-[10px] text-muted/50 ml-auto">点击字段即可编辑</span>
            </div>
            {EDITABLE_FIELDS.map((field) => (
              <InlineEditField
                key={field.key}
                label={field.label}
                value={getFieldValue(field.key)}
                type={field.type}
                placeholder={field.placeholder}
                saving={saving}
                onSave={async (v) => handleSaveField(field.key, v)}
              />
            ))}
          </div>
        ) : (
          <>
            {/* 元数据详情（只读模式） */}
            {(group.genre || group.year || group.publisher || group.language) && (
              <div className="rounded-xl bg-card-hover/30 p-3 space-y-1.5">
                {group.genre && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted/50 w-12 flex-shrink-0">类型</span>
                    <span className="text-foreground/70">{group.genre}</span>
                  </div>
                )}
                {group.year && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted/50 w-12 flex-shrink-0">年份</span>
                    <span className="text-foreground/70">{group.year}</span>
                  </div>
                )}
                {group.publisher && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted/50 w-12 flex-shrink-0">出版社</span>
                    <span className="text-foreground/70">{group.publisher}</span>
                  </div>
                )}
                {group.language && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted/50 w-12 flex-shrink-0">语言</span>
                    <span className="text-foreground/70">{group.language}</span>
                  </div>
                )}
              </div>
            )}

            {/* 标签 */}
            {group.tags && (
              <div className="flex flex-wrap gap-1">
                {group.tags.split(",").map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                  <span key={tag} className="rounded-md bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {group.description && (
              <div className="rounded-xl bg-card-hover/30 p-3">
                <p className="text-xs text-foreground/70 leading-relaxed line-clamp-6">{group.description}</p>
              </div>
            )}
          </>
        )}

        {group.updatedAt && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted/40">
            <Clock className="h-3 w-3" />
            最后更新: {new Date(group.updatedAt).toLocaleString()}
          </div>
        )}

        {/* 系列刮削入口 */}
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-foreground">系列元数据刮削</h3>
          </div>
          <p className="text-xs text-muted">
            从 AniList、Bangumi 等在线数据库搜索系列信息，或使用 AI 智能识别。支持选择性应用字段和标签同步。
          </p>
          <GroupMetadataSearch
            key={group.id}
            groupId={group.id}
            groupName={group.name}
            contentType={group.contentType}
            onApplied={async (success) => {
              if (success) {
                loadScraperGroups();
              }
            }}
          />
        </div>

        {/* 快捷操作 */}
        <div className="flex gap-2">
          <a
            href={`/group/${group.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-card-hover/50 px-3 py-2 text-xs text-muted hover:text-foreground transition-colors"
          >
            <BookOpen className="h-3.5 w-3.5" />
            查看系列详情
          </a>
        </div>
      </div>
    </div>
  );
}
