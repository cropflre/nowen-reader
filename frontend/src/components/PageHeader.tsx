"use client";

import type { ComponentType, ReactNode } from "react";

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
  actions?: ReactNode;
  width?: PageWidth;
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  width = "management",
}: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/90 backdrop-blur-xl">
      <div className={`mx-auto flex min-h-16 items-center gap-3 px-4 py-3 sm:px-6 lg:px-8 ${widthClasses[width]}`}>
        {Icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-foreground">{title}</h1>
          {description && <p className="mt-0.5 truncate text-xs text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
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
