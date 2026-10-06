"use client";

import { useRef } from "react";
import { useTranslation } from "@/lib/i18n";
import "./library-content-tabs.css";

export type LibraryContentType = "all" | "novel" | "comic";
const contentTypes: LibraryContentType[] = ["all", "novel", "comic"];

export default function LibraryContentTabs({ value, onChange }: {
  value: LibraryContentType;
  onChange: (value: LibraryContentType) => void;
}) {
  const t = useTranslation();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <div role="tablist" aria-label="内容分类" className="library-content-tabs" onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = contentTypes.indexOf(value);
      const next = event.key === "Home" ? 0 : event.key === "End" ? contentTypes.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + contentTypes.length) % contentTypes.length;
      onChange(contentTypes[next]);
      tabRefs.current[next]?.focus();
    }}>
      {contentTypes.map((type, index) => (
        <button key={type} ref={(element) => { tabRefs.current[index] = element; }}
          id={`library-content-tab-${type}`} type="button" role="tab"
          aria-selected={value === type} aria-controls="library-content-panel"
          tabIndex={value === type ? 0 : -1} onClick={() => onChange(type)}>
          {t.contentTab[type]}
        </button>
      ))}
    </div>
  );
}
