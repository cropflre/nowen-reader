"use client";

import { useState, useEffect } from "react";
import { Download, RefreshCw, X, Smartphone } from "lucide-react";
import { promptInstall, canInstall, skipWaiting } from "@/lib/pwa";
import { useTranslation } from "@/lib/i18n";

export function PWAInstallBanner() {
  const [showInstall, setShowInstall] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const t = useTranslation();

  useEffect(() => {
    const handleInstallable = () => setShowInstall(true);
    const handleUpdate = () => setShowUpdate(true);
    const handleInstalled = () => setShowInstall(false);

    window.addEventListener("pwa-installable", handleInstallable);
    window.addEventListener("sw-update-available", handleUpdate);
    window.addEventListener("pwa-installed", handleInstalled);

    // Check if already installable
    if (canInstall()) setShowInstall(true);

    return () => {
      window.removeEventListener("pwa-installable", handleInstallable);
      window.removeEventListener("sw-update-available", handleUpdate);
      window.removeEventListener("pwa-installed", handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    const accepted = await promptInstall();
    if (accepted) setShowInstall(false);
  };

  const handleUpdate = () => {
    skipWaiting();
    setShowUpdate(false);
  };

  return (
    <>
      {/* Install Banner */}
      {showInstall && (
        <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md animate-slide-up">
          <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-card p-4 shadow-lg shadow-accent/10">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent/20">
              <Smartphone className="h-5 w-5 text-accent" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {t.pwa?.installTitle || "Install NowenReader"}
              </p>
              <p className="text-xs text-muted">
                {t.pwa?.installDesc || "Add to home screen for a better experience"}
              </p>
            </div>
            <button
              onClick={handleInstall}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
            >
              <Download className="h-3.5 w-3.5" />
              {t.pwa?.install || "Install"}
            </button>
            <button
              onClick={() => setShowInstall(false)}
              className="p-1 text-muted transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Update Banner */}
      {showUpdate && (
        <div className="fixed top-20 left-4 right-4 z-50 mx-auto max-w-md animate-slide-down">
          <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-card p-4 shadow-lg">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-green-500/20">
              <RefreshCw className="h-5 w-5 text-green-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {t.pwa?.updateAvailable || "Update Available"}
              </p>
              <p className="text-xs text-muted">
                {t.pwa?.updateDesc || "A new version is ready"}
              </p>
            </div>
            <button
              onClick={handleUpdate}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-green-500"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t.pwa?.update || "Update"}
            </button>
            <button
              onClick={() => setShowUpdate(false)}
              className="p-1 text-muted transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
