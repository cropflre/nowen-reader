"use client";

import { useState, useCallback } from "react";
import { Cloud, CloudOff, Download, Upload, RefreshCw, Check, AlertCircle, Settings } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface SyncConfig {
  enabled: boolean;
  provider: "webdav" | "local";
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
}

const DEFAULT_CONFIG: SyncConfig = {
  enabled: false,
  provider: "webdav",
  webdavUrl: "",
  webdavUsername: "",
  webdavPassword: "",
  autoSync: false,
  syncIntervalMinutes: 30,
  lastSyncAt: null,
};

function loadSyncConfig(): SyncConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem("nowen-sync-config");
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveSyncConfig(config: SyncConfig) {
  try {
    localStorage.setItem("nowen-sync-config", JSON.stringify(config));
  } catch { /* ignore */ }
}

export function CloudSyncPanel() {
  const t = useTranslation();
  const [config, setConfig] = useState<SyncConfig>(loadSyncConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const updateConfig = useCallback((updates: Partial<SyncConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      saveSyncConfig(next);
      return next;
    });
  }, []);

  const handleTestConnection = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test-connection",
          url: config.webdavUrl,
          username: config.webdavUsername,
          password: config.webdavPassword,
        }),
      });
      const data = await res.json();
      setStatus({
        type: data.connected ? "success" : "error",
        message: data.connected
          ? (t.sync?.connectionSuccess || "Connection successful")
          : (t.sync?.connectionFailed || "Connection failed"),
      });
    } catch {
      setStatus({ type: "error", message: t.sync?.connectionFailed || "Connection failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setStatus(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "webdav-sync",
          config,
          deviceId: getDeviceId(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        updateConfig({ lastSyncAt: new Date().toISOString() });
        setStatus({
          type: "success",
          message: `${t.sync?.syncComplete || "Sync complete"}: ${data.updated} ${t.sync?.itemsUpdated || "items updated"}`,
        });
      } else {
        setStatus({ type: "error", message: data.message });
      }
    } catch {
      setStatus({ type: "error", message: t.sync?.syncFailed || "Sync failed" });
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async () => {
    try {
      const res = await fetch("/api/sync", {
        headers: { "x-device-id": getDeviceId() },
      });
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nowen-reader-backup-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus({ type: "success", message: t.sync?.exportSuccess || "Data exported" });
    } catch {
      setStatus({ type: "error", message: t.sync?.exportFailed || "Export failed" });
    }
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "import", data }),
        });
        const result = await res.json();
        if (result.success) {
          setStatus({
            type: "success",
            message: `${t.sync?.importSuccess || "Imported"}: ${result.updated} ${t.sync?.itemsUpdated || "updated"}`,
          });
        } else {
          setStatus({ type: "error", message: result.error });
        }
      } catch {
        setStatus({ type: "error", message: t.sync?.importFailed || "Import failed" });
      }
    };
    input.click();
  };

  return (
    <div className="space-y-4">
      {/* Sync Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {config.enabled ? (
            <Cloud className="h-5 w-5 text-accent" />
          ) : (
            <CloudOff className="h-5 w-5 text-muted" />
          )}
          <h3 className="text-sm font-medium text-foreground">
            {t.sync?.title || "Cloud Sync"}
          </h3>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-card hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* Status */}
      {status && (
        <div className={`flex items-center gap-2 rounded-lg p-3 text-xs ${
          status.type === "success"
            ? "bg-green-500/10 text-green-400"
            : "bg-red-500/10 text-red-400"
        }`}>
          {status.type === "success" ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {status.message}
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleExport}
          className="flex items-center justify-center gap-2 rounded-lg bg-card px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-card-hover"
        >
          <Download className="h-4 w-4" />
          {t.sync?.export || "Export"}
        </button>
        <button
          onClick={handleImport}
          className="flex items-center justify-center gap-2 rounded-lg bg-card px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-card-hover"
        >
          <Upload className="h-4 w-4" />
          {t.sync?.import || "Import"}
        </button>
      </div>

      {/* WebDAV Sync */}
      {config.webdavUrl && (
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? (t.sync?.syncing || "Syncing...") : (t.sync?.syncNow || "Sync Now")}
        </button>
      )}

      {config.lastSyncAt && (
        <p className="text-center text-xs text-muted">
          {t.sync?.lastSync || "Last sync"}: {new Date(config.lastSyncAt).toLocaleString()}
        </p>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <div className="space-y-3 rounded-xl bg-card p-3 sm:p-4">
          <div>
            <label className="mb-1 block text-xs text-muted">
              {t.sync?.webdavUrl || "WebDAV URL"}
            </label>
            <input
              type="url"
              value={config.webdavUrl}
              onChange={(e) => updateConfig({ webdavUrl: e.target.value })}
              placeholder="https://dav.example.com/..."
              className="h-9 w-full rounded-lg bg-background px-3 text-sm text-foreground placeholder-muted/50 outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">
              {t.sync?.username || "Username"}
            </label>
            <input
              type="text"
              value={config.webdavUsername}
              onChange={(e) => updateConfig({ webdavUsername: e.target.value })}
              className="h-9 w-full rounded-lg bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">
              {t.sync?.password || "Password"}
            </label>
            <input
              type="password"
              value={config.webdavPassword}
              onChange={(e) => updateConfig({ webdavPassword: e.target.value })}
              className="h-9 w-full rounded-lg bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
          <button
            onClick={handleTestConnection}
            disabled={!config.webdavUrl || testing}
            className="h-9 w-full rounded-lg border border-accent/30 px-3 text-xs font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
          >
            {testing ? (t.sync?.testing || "Testing...") : (t.sync?.testConnection || "Test Connection")}
          </button>
        </div>
      )}
    </div>
  );
}

function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem("nowen-device-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("nowen-device-id", id);
  }
  return id;
}
