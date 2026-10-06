"use client";

import { useState } from "react";
import Image from "next/image";
import { readingBackdropSrc, type ShelfFocus } from "./dashboard-shelf";

export default function DashboardAmbientBackdrop({ comics, activeId, hideNSFW }: ShelfFocus & { hideNSFW: boolean }) {
  const [failedSources, setFailedSources] = useState<string[]>([]);

  return <div className="dashboard-ambient-backdrop" aria-hidden="true">
    {comics.map((comic) => {
      const src = readingBackdropSrc(comic, hideNSFW);
      if (!src || failedSources.includes(src)) return null;
      return <div key={`${comic.id}:${src}`} className={`ds-backdrop-layer${comic.id === activeId ? " ds-visible" : ""}`}>
        <Image src={src} alt="" fill unoptimized className="ds-backdrop-image" sizes="100vw" draggable={false}
          onError={() => setFailedSources((previous) => previous.includes(src) ? previous : [...previous, src])} />
      </div>;
    })}
  </div>;
}
