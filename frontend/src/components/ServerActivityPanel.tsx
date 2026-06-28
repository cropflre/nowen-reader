"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, Clock } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

/**
 * 圆形仪表盘
 */
function Gauge({
  value,
  max = 100,
  size = 64,
  strokeWidth = 5,
  color,
  label,
  unit,
}: {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  label: string;
  unit?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  const offset = circ * (1 - pct);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="rotate-[-90deg]">
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} />
          <circle
            cx={size/2} cy={size/2} r={r} fill="none"
            stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset}
            className="gauge-animate"
            style={{ "--gauge-circumference": circ, "--gauge-target": offset, filter: `drop-shadow(0 0 6px ${color}40)` } as React.CSSProperties}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-bold text-foreground tabular-nums leading-none">{Math.round(value)}</span>
          {unit && <span className="text-[8px] text-muted leading-none mt-0.5">{unit}</span>}
        </div>
      </div>
      <span className="text-[10px] text-muted font-medium">{label}</span>
    </div>
  );
}

/**
 * 迷你曲线图
 */
function MiniChart({ data, color = "#3B82F6" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const h = 24;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${h - (v / max) * (h - 2)}`);
  const path = `M${pts.join(" L")}`;
  const area = `${path} L100,${h} L0,${h} Z`;

  return (
    <svg viewBox={`0 0 100 ${h}`} className="w-full h-6" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`cg-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#cg-${color.slice(1)})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 服务器状态面板 — 产品化圆形仪表盘
 */
export default function ServerActivityPanel() {
  const t = useTranslation();
  const [health, setHealth] = useState<{
    status: string;
    version: string;
    uptime: string;
    runtime: { go: string; os: string; arch: string; cpus: number; goroutines: number; memoryMB: number };
  } | null>(null);
  const [memHistory, setMemHistory] = useState<number[]>([]);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
        setMemHistory(prev => [...prev, data.runtime?.memoryMB || 0].slice(-20));
      }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    fetchHealth();
    const t = setInterval(fetchHealth, 10000);
    return () => clearInterval(t);
  }, [fetchHealth]);

  if (!health) return null;
  const rt = health.runtime;

  return (
    <div className="dashboard-glass p-4 space-y-4">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold text-foreground">{t.dashboard?.server || "服务器"}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted">
          <Clock className="h-3 w-3" />
          <span>{formatUptime(health.uptime)}</span>
        </div>
      </div>

      {/* 状态指示 */}
      <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
        <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50 pulse-dot" />
        <span className="text-xs font-medium text-emerald-400">{t.dashboard?.running || "运行中"}</span>
        <span className="text-[10px] text-emerald-400/60 ml-auto">v{health.version}</span>
      </div>

      {/* 圆形仪表盘组 */}
      <div className="flex items-center justify-around">
        <Gauge value={rt.cpus} max={32} color="#3B82F6" label="CPU" unit={t.dashboard?.cores || "核心"} />
        <Gauge value={rt.memoryMB} max={512} color="#8B5CF6" label={t.dashboard?.memory || "内存"} unit="MB" />
        <Gauge value={rt.goroutines} max={100} color="#22C55E" label={t.dashboard?.goroutines || "协程"} />
      </div>

      {/* 内存趋势曲线 */}
      {memHistory.length > 3 && (
        <div className="space-y-1">
          <span className="text-[10px] text-muted">{t.dashboard?.memory || "内存"}趋势</span>
          <div className="rounded-lg bg-background/30 px-2 py-1 border border-border/30">
            <MiniChart data={memHistory} color="#8B5CF6" />
          </div>
        </div>
      )}

      {/* 平台信息 */}
      <p className="text-[10px] text-muted/40 text-center">
        {rt.os}/{rt.arch} · {t.dashboard?.database || "SQLite"}
      </p>
    </div>
  );
}

function formatUptime(uptime: string): string {
  const m = uptime.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!m) return uptime;
  const h = parseInt(m[1] || "0");
  const min = parseInt(m[2] || "0");
  if (h > 24) return `${Math.floor(h / 24)}天${h % 24}时`;
  if (h > 0) return `${h}时${min}分`;
  return `${min}分`;
}
