"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X, Loader2, Save } from "lucide-react";

export function DetailInlineEditField({
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

  useEffect(() => {
    setInputValue(value);
  }, [value]);

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
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") handleCancel(); }}
            placeholder={placeholder}
            disabled={saving}
            autoFocus
            rows={3}
            className="w-full rounded-lg bg-card-hover/60 px-2.5 py-1.5 text-xs text-foreground outline-none border border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all disabled:opacity-50 resize-none leading-relaxed"
          />
        ) : (
          <input
            type={type}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleSave(); }
              if (e.key === "Escape") handleCancel();
            }}
            placeholder={placeholder}
            disabled={saving}
            autoFocus
            className="w-full rounded-lg bg-card-hover/60 px-2.5 py-1.5 text-xs text-foreground outline-none border border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all disabled:opacity-50"
          />
        )}
      </div>
    );
  }

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

