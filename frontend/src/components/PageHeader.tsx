"use client";

import type { ComponentType, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { isManagementPath } from "@/lib/management-navigation";
import ManagementTabs from "@/components/ManagementTabs";

export type PageWidth = "form" | "management" | "wide" | "full";

const widthClasses: Record<PageWidth, string> = {
  form: "max-w-5xl",
  management: "max-w-[1400px]",
  wide: "max-w-[1760px]",
  full: "max-w-none",
};

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  controls?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  controls,
  actions,
}: PageHeaderProps) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const management = user?.role === "admin" && isManagementPath(pathname);
  return (
    <header className={`module-page-header ambient-topbar sticky top-0 z-30 border-b border-border/50${controls ? " module-header-has-controls" : ""}`}>
      <div className={`module-header-inner${management ? " management-header-inner" : ""}`}>
        {management ? <><h1 className="sr-only">{title}</h1><ManagementTabs /></> : <div className="module-header-title flex min-w-0 flex-1 items-center gap-3">
        {Icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-foreground">{title}</h1>
          {description && <p className="truncate text-xs text-muted">{description}</p>}
        </div>
        </div>}
        {controls && <div className="module-header-controls">{controls}</div>}
        {actions && <div className="module-header-actions flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

interface PageContentProps {
  children: ReactNode;
  width?: PageWidth;
  className?: string;
}

export function PageContent({
  children,
  width = "management",
  className = "",
}: PageContentProps) {
  return (
    <main className={`mx-auto w-full px-4 py-5 sm:px-6 sm:py-6 lg:px-8 ${widthClasses[width]} ${className}`}>
      {children}
    </main>
  );
}
