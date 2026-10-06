"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Brain, Search, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface SearchIconButtonProps {
  query: string;
  onChange: (query: string) => void;
  onSubmit?: () => void;
  aiSearchMode?: boolean;
  onAiSearchModeChange?: (mode: boolean) => void;
  label?: string;
  inputLabel?: string;
  placeholder?: string;
}

export default function SearchIconButton({ query, onChange, onSubmit, aiSearchMode = false, onAiSearchModeChange, label = "搜索书库", inputLabel, placeholder }: SearchIconButtonProps) {
  const t = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => { setOpen(false); buttonRef.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onOutside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return <div ref={rootRef} className="library-search-control">
    <button ref={buttonRef} type="button" className="shell-icon-button" aria-label={label} title={label}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} data-active={!!query || undefined}
      onClick={() => setOpen(!open)}><Search aria-hidden="true" /></button>
    {open && <section id={id} className="library-search-popover" role="dialog" aria-label={label}>
      <form onSubmit={(event) => { event.preventDefault(); onSubmit?.(); close(); }}>
        <Search aria-hidden="true" className="library-search-leading" />
        <input ref={inputRef} type="search" aria-label={inputLabel || (aiSearchMode ? "AI 搜索书库" : "书库搜索关键词")}
          placeholder={placeholder || (aiSearchMode ? t.navbar.aiSearchPlaceholder : t.navbar.searchPlaceholder)}
          value={query} onChange={(event) => onChange(event.target.value)} />
        {query && <button type="button" className="shell-icon-button" aria-label="清除搜索" title="清除搜索"
          onClick={() => { onChange(""); inputRef.current?.focus(); }}><X aria-hidden="true" /></button>}
        <button type="button" className="shell-icon-button" aria-label="关闭搜索" title="关闭搜索" onClick={close}>
          <X aria-hidden="true" /></button>
      </form>
      {onAiSearchModeChange && <button type="button" role="switch" className="library-search-mode" aria-checked={aiSearchMode}
        onClick={() => onAiSearchModeChange(!aiSearchMode)}><Brain aria-hidden="true" />AI 语义搜索</button>}
    </section>}
  </div>;
}
