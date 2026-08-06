"use client";

import type { ReactNode } from "react";
import DesktopSidebar from "@/components/DesktopSidebar";

interface AppShellProps {
  children: ReactNode;
  className?: string;
}

export default function AppShell({ children, className = "" }: AppShellProps) {
  return (
    <div className={`min-h-screen bg-background pb-16 sm:pb-0 ${className}`}>
      <DesktopSidebar />
      <div className="min-h-screen lg:ml-[220px] xl:ml-[240px]">{children}</div>
    </div>
  );
}
