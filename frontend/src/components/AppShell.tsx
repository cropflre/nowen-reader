"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import DesktopSidebar from "@/components/DesktopSidebar";
import DashboardAmbientBackdrop from "@/components/home/DashboardAmbientBackdrop";
import { selectContinueReading, type ShelfFocus } from "@/components/home/dashboard-shelf";
import { useComics, LIBRARY_ACCESS_CHANGED_EVENT } from "@/hooks/useComics";
import { usePrivacyMode } from "@/hooks/usePrivacyMode";
import { useAuth } from "@/lib/auth-context";
import { AmbientFocusContext } from "@/lib/ambient-context";
import "./home/dashboard-main.css";
import "./app-shell-material.css";

interface AppShellProps {
  children: ReactNode;
  className?: string;
}

export default function AppShell({ children, className = "" }: AppShellProps) {
  const { user } = useAuth();
  return <AmbientShell key={`${user?.id || "guest"}:${user?.role || ""}`} className={className}>{children}</AmbientShell>;
}

function AmbientShell({ children, className }: AppShellProps) {
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [focus, setFocus] = useState<ShelfFocus>({ comics: [], activeId: "" });
  const { comics, setComics } = useComics({ page: 1, pageSize: 20, sortBy: "lastReadAt", sortOrder: "desc" });
  const { enabled, blurNSFW } = usePrivacyMode();
  const publishFocus = useCallback((next: ShelfFocus) => {
    // Shelf unmount cleanup must not erase the backdrop during module navigation.
    if (!next.comics.length && pathnameRef.current !== "/") return;
    setFocus(next);
  }, []);
  useEffect(() => {
    const clear = () => {
      setFocus({ comics: [], activeId: "" });
      setComics([]);
    };
    window.addEventListener(LIBRARY_ACCESS_CHANGED_EVENT, clear);
    return () => window.removeEventListener(LIBRARY_ACCESS_CHANGED_EVENT, clear);
  }, [setComics]);
  const fallback = useMemo(() => {
    const reading = selectContinueReading(comics);
    const candidates = reading.length ? reading : comics.slice(0, 8);
    return { comics: candidates, activeId: candidates[0]?.id || "" };
  }, [comics]);
  const backdrop = pathname === "/" || focus.comics.length ? focus : fallback;
  return (
    <AmbientFocusContext.Provider value={publishFocus}>
    <div className={`app-shell min-h-screen bg-background pb-16 sm:pb-0 ${className}`}>
      <DashboardAmbientBackdrop {...backdrop} hideNSFW={enabled && blurNSFW} />
      <DesktopSidebar />
      <div className="app-shell-content relative z-10 min-h-screen">{children}</div>
    </div>
    </AmbientFocusContext.Provider>
  );
}
