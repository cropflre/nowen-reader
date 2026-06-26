"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

// ============================================================
// Types
// ============================================================

type SectionLayout = "shelf" | "grid" | "row";
type CardSize = "sm" | "md" | "lg";

interface ContentShelfProps {
  title: string;
  icon?: React.ReactNode;
  href?: string;
  actionLabel?: string;
  actionHref?: string;
  children: React.ReactNode;
  className?: string;
  /** Section rendering mode: shelf (horizontal scroll), grid, or row */
  sectionLayout?: SectionLayout;
  /** Card size preset for grid/row layouts */
  cardSize?: CardSize;
}

// ============================================================
// Layout helpers
// ============================================================

const GRID_COLS: Record<CardSize, string> = {
  sm: "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7",
  md: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
  lg: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
};

// ============================================================
// Component — horizontal content shelf (Netflix/Apple Books style)
// ============================================================

export default function ContentShelf({
  title,
  icon,
  actionLabel,
  actionHref,
  children,
  className = "",
  sectionLayout = "shelf",
  cardSize = "md",
}: ContentShelfProps) {
  const containerClass =
    sectionLayout === "grid"
      ? `grid gap-3 ${GRID_COLS[cardSize] || GRID_COLS.md}`
      : sectionLayout === "row"
        ? "flex gap-3 overflow-x-auto pb-2"
        : "scrollbar-hide -mx-1 flex gap-3 overflow-x-auto px-1 pb-2";

  const containerStyle: React.CSSProperties =
    sectionLayout === "shelf" || sectionLayout === "row"
      ? { scrollbarWidth: "none", msOverflowStyle: "none" }
      : {};

  return (
    <section className={`mb-4 ${className}`}>
      {title && (
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground sm:text-base">
            {icon}
            {title}
          </h3>
          {actionLabel && actionHref && (
            <Link
              href={actionHref}
              className="flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
            >
              {actionLabel}
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
      <div className={containerClass} style={containerStyle}>
        {children}
      </div>
    </section>
  );
}

// ============================================================
// ShelfCard — a card for use inside ContentShelf
// ============================================================

interface ShelfCardProps {
  href: string;
  coverUrl: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  progress?: number;
  widthClass?: string;
  badgeType?: "completed" | "progress" | null;
  progressPercentage?: number;
}

// ============================================================
// Badge helpers
// ============================================================

/** Returns a hex color interpolated from red (0%) -> yellow (50%) -> green (100%). */
function progressColor(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  if (clamped <= 50) {
    // red (#ef4444) to yellow (#eab308)
    const t = clamped / 50;
    const r = Math.round(239 + (234 - 239) * t);
    const g = Math.round(68 + (179 - 68) * t);
    const b = Math.round(68 + (8 - 68) * t);
    return `rgb(${r},${g},${b})`;
  }
  // yellow (#eab308) to green (#22c55e)
  const t = (clamped - 50) / 50;
  const r = Math.round(234 + (34 - 234) * t);
  const g = Math.round(179 + (197 - 179) * t);
  const b = Math.round(8 + (94 - 8) * t);
  return `rgb(${r},${g},${b})`;
}

function CompletedBadge() {
  return (
    <div className="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 shadow-md">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="white"
        className="h-3.5 w-3.5"
      >
        <path
          fillRule="evenodd"
          d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}

function CircularProgressRing({ percentage }: { percentage: number }) {
  const size = 32;
  const strokeWidth = 3.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const color = progressColor(percentage);

  return (
    <div className="absolute top-1.5 right-1.5 z-10">
      <svg width={size} height={size} className="-rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(0,0,0,0.25)"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
        {percentage}
      </span>
    </div>
  );
}

export function ShelfCard({
  href,
  coverUrl,
  title,
  subtitle,
  badge,
  badgeColor = "bg-accent/10 text-accent",
  progress,
  widthClass = "w-36 sm:w-40 lg:w-44",
  badgeType,
  progressPercentage,
}: ShelfCardProps) {
  return (
    <Link
      href={href}
      className={`group flex-shrink-0 ${widthClass} transition-all duration-200 hover:-translate-y-0.5`}
    >
      <div className="relative overflow-hidden rounded-xl bg-muted">
        <div className="aspect-[5/7] relative bg-gradient-to-br from-muted/20 to-card dark:from-muted/10">
          <img
            src={coverUrl || "/api/placeholder/160/224"}
            alt={title}
            className="h-full w-full object-contain p-0.5 transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
          {/* Badge overlay */}
          {badgeType === "completed" && <CompletedBadge />}
          {badgeType === "progress" && progressPercentage !== undefined && (
            <CircularProgressRing percentage={progressPercentage} />
          )}
          {/* Progress bar */}
          {progress !== undefined && progress > 0 && progress < 100 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>
      <div className="mt-1.5 px-0.5">
        <p className="text-xs font-medium text-foreground line-clamp-2 leading-tight">
          {title}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-[10px] text-muted line-clamp-1">{subtitle}</p>
        )}
        {badge && (
          <span className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[9px] font-medium ${badgeColor}`}>
            {badge}
          </span>
        )}
      </div>
    </Link>
  );
}
