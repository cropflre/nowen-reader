"use client";

import { useMemo, useState } from "react";
import BookFlipPrototype from "@/components/reader/BookFlipPrototype";

function createDemoPages(count: number) {
  return Array.from({ length: count }, (_, i) => `/api/__dev/book-flip/page/${i + 1}`);
}

export default function BookFlipDevPage() {
  const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
  const [pageCount, setPageCount] = useState(6);
  const pages = useMemo(() => createDemoPages(pageCount), [pageCount]);

  return (
    <div className="min-h-dvh bg-zinc-950 text-white/90">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">BookFlipPrototype Dev Preview</h1>
            <p className="text-xs text-white/60">Isolated realistic page-flip canvas prototype. No reader, progress, or settings changes.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/15"
              onClick={() => setDirection((d) => (d === "ltr" ? "rtl" : "ltr"))}
            >
              Direction: {direction.toUpperCase()}
            </button>
            <button
              className="rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/15"
              onClick={() => setPageCount((c) => Math.min(12, c + 1))}
            >
              Pages +
            </button>
            <button
              className="rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/15"
              onClick={() => setPageCount((c) => Math.max(2, c - 1))}
            >
              Pages -
            </button>
          </div>
        </div>
        <BookFlipPrototype pages={pages} direction={direction} />
      </div>
    </div>
  );
}

