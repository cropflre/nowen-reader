"use client";

import { useState, useEffect } from "react";
import {
  Globe,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Trash2,
  Save,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export function EHentaiSettingsPanel() {
  const t = useTranslation();
  const eh = t.ehentaiSettings || {} as Record<string, string>;

  const [memberId, setMemberId] = useState("");
  const [passHash, setPassHash] = useState("");
  const [igneous, setIgneous] = useState("");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [showPassHash, setShowPassHash] = useState(false);
  const [showIgneous, setShowIgneous] = useState(false);
  const [maskedInfo, setMaskedInfo] = useState({ memberId: "", passHash: "", igneous: "" });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ehentai/settings");
      const data = await res.json();
      setConfigured(data.configured);
      setMaskedInfo({
        memberId: data.memberId || "",
        passHash: data.passHash || "",
        igneous: data.igneous || "",
      });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const body: Record<string, string> = {};
      if (memberId) body.memberId = memberId;
      if (passHash) body.passHash = passHash;
      body.igneous = igneous;

      const res = await fetch("/api/ehentai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setConfigured(data.configured);
        setMemberId("");
        setPassHash("");
        setIgneous("");
        await fetchConfig();
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await fetch("/api/ehentai/settings", { method: "DELETE" });
      setConfigured(false);
      setMaskedInfo({ memberId: "", passHash: "", igneous: "" });
      setMemberId("");
      setPassHash("");
      setIgneous("");
      setTestResult(null);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/ehentai/status");
      const data = await res.json();
      setTestResult(data.configured ? "success" : "error");
    } catch {
      setTestResult("error");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Globe className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-medium text-foreground">
          {eh.title || "E-Hentai 配置"}
        </h3>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 rounded-xl bg-background px-4 py-3">
        {configured ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-green-400" />
            <span className="text-sm text-green-400">{eh.statusConfigured || "已配置"}</span>
          </>
        ) : (
          <>
            <AlertCircle className="h-4 w-4 text-yellow-400" />
            <span className="text-sm text-yellow-400">{eh.statusNotConfigured || "未配置"}</span>
          </>
        )}
      </div>

      {/* Current config display */}
      {configured && (
        <div className="rounded-xl bg-background p-4 space-y-2">
          <p className="text-xs text-muted mb-2">{eh.currentConfig || "当前配置"}</p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">ipb_member_id</span>
            <span className="font-mono text-foreground">{maskedInfo.memberId || "—"}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">ipb_pass_hash</span>
            <span className="font-mono text-foreground">{maskedInfo.passHash || "—"}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">igneous</span>
            <span className="font-mono text-foreground">{maskedInfo.igneous || "—"}</span>
          </div>
        </div>
      )}

      {/* Description */}
      <p className="text-xs text-muted leading-relaxed">
        {eh.description || "从 E-Hentai 登录后的浏览器 Cookie 中获取以下值。打开浏览器开发者工具 → Application → Cookies 查找。"}
      </p>

      {/* Input fields */}
      <div className="space-y-3">
        {/* Member ID */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            ipb_member_id <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            placeholder={configured ? (eh.keepCurrent || "留空保持当前值") : "e.g. 1234567"}
            className="h-9 w-full rounded-lg border border-border/60 bg-background px-3 text-sm text-foreground placeholder:text-muted/50 outline-none transition-colors focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
          />
        </div>

        {/* Pass Hash */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            ipb_pass_hash <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <input
              type={showPassHash ? "text" : "password"}
              value={passHash}
              onChange={(e) => setPassHash(e.target.value)}
              placeholder={configured ? (eh.keepCurrent || "留空保持当前值") : "e.g. abc123def456..."}
              className="h-9 w-full rounded-lg border border-border/60 bg-background px-3 pr-9 text-sm text-foreground placeholder:text-muted/50 outline-none transition-colors focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
            />
            <button
              type="button"
              onClick={() => setShowPassHash(!showPassHash)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            >
              {showPassHash ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Igneous */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            igneous <span className="text-muted/50">({eh.optional || "可选，用于 ExHentai"})</span>
          </label>
          <div className="relative">
            <input
              type={showIgneous ? "text" : "password"}
              value={igneous}
              onChange={(e) => setIgneous(e.target.value)}
              placeholder={configured ? (eh.keepCurrent || "留空保持当前值") : "e.g. abcdef1234..."}
              className="h-9 w-full rounded-lg border border-border/60 bg-background px-3 pr-9 text-sm text-foreground placeholder:text-muted/50 outline-none transition-colors focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
            />
            <button
              type="button"
              onClick={() => setShowIgneous(!showIgneous)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            >
              {showIgneous ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
          testResult === "success"
            ? "bg-green-500/10 text-green-400"
            : "bg-red-500/10 text-red-400"
        }`}>
          {testResult === "success" ? (
            <><CheckCircle2 className="h-3.5 w-3.5" />{eh.testSuccess || "连接成功"}</>
          ) : (
            <><AlertCircle className="h-3.5 w-3.5" />{eh.testFailed || "连接失败，请检查 Cookie"}</>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || (!memberId && !passHash && !igneous)}
          className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {eh.save || "保存"}
        </button>

        <button
          onClick={handleTest}
          disabled={testing}
          className="flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background px-4 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {eh.test || "测试"}
        </button>

        {configured && (
          <button
            onClick={handleClear}
            disabled={saving}
            className="flex h-9 items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 text-sm text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {eh.clear || "清除"}
          </button>
        )}
      </div>
    </div>
  );
}
