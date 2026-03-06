"use client";

import { useState, useEffect, useCallback } from "react";
import { Puzzle, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Info } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  permissions: string[];
  settings: Record<string, unknown>;
}

export function PluginManagerPanel() {
  const t = useTranslation();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPlugins = useCallback(async () => {
    try {
      const res = await fetch("/api/plugins");
      if (res.ok) {
        const data = await res.json();
        setPlugins(data.plugins || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  const handleToggle = async (pluginId: string, enabled: boolean) => {
    try {
      await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", pluginId, enabled }),
      });
      setPlugins((prev) =>
        prev.map((p) => (p.id === pluginId ? { ...p, enabled } : p))
      );
    } catch { /* ignore */ }
  };

  if (loading) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Puzzle className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-medium text-foreground">
          {t.plugins?.title || "Plugins"}
        </h3>
        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">
          {plugins.length}
        </span>
      </div>

      {plugins.length === 0 && (
        <p className="text-xs text-muted">{t.plugins?.noPlugins || "No plugins installed"}</p>
      )}

      <div className="space-y-2">
        {plugins.map((plugin) => (
          <div
            key={plugin.id}
            className="rounded-xl border border-border/40 bg-card overflow-hidden"
          >
            {/* Plugin Header */}
            <div className="flex items-center justify-between px-3 sm:px-4 py-3">
              <div
                className="flex-1 cursor-pointer"
                onClick={() => setExpandedId(expandedId === plugin.id ? null : plugin.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{plugin.name}</span>
                  <span className="rounded bg-muted/10 px-1.5 py-0.5 text-[10px] text-muted">
                    v{plugin.version}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted">{plugin.description}</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggle(plugin.id, !plugin.enabled)}
                  className="text-muted transition-colors"
                >
                  {plugin.enabled ? (
                    <ToggleRight className="h-6 w-6 text-accent" />
                  ) : (
                    <ToggleLeft className="h-6 w-6" />
                  )}
                </button>
                <button
                  onClick={() => setExpandedId(expandedId === plugin.id ? null : plugin.id)}
                  className="p-1 text-muted transition-colors hover:text-foreground"
                >
                  {expandedId === plugin.id ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Expanded Details */}
            {expandedId === plugin.id && (
              <div className="border-t border-border/30 px-3 sm:px-4 py-3 space-y-2">
                <div className="flex items-center gap-1 text-xs text-muted">
                  <Info className="h-3 w-3" />
                  {t.plugins?.author || "Author"}: {plugin.author}
                </div>

                {plugin.permissions.length > 0 && (
                  <div>
                    <p className="text-xs text-muted mb-1">{t.plugins?.permissions || "Permissions"}:</p>
                    <div className="flex flex-wrap gap-1">
                      {plugin.permissions.map((perm) => (
                        <span key={perm} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                          {perm}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(plugin.settings).length > 0 && (
                  <div>
                    <p className="text-xs text-muted mb-1">{t.plugins?.settings || "Settings"}:</p>
                    <div className="space-y-1">
                      {Object.entries(plugin.settings)
                        .filter(([key]) => !key.startsWith("day_"))
                        .map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between text-xs">
                            <span className="text-muted">{key}</span>
                            <span className="text-foreground/70">{String(value)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
