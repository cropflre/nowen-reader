"use client";

/**
 * PWA utilities: service worker registration, install prompt, update handling
 */

let deferredPrompt: BeforeInstallPromptEvent | null = null;

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  prompt(): Promise<void>;
}

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });

      // Check for updates every 30 minutes
      setInterval(() => {
        registration.update();
      }, 30 * 60 * 1000);

      // Handle updates
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            // New version available
            dispatchPwaEvent("sw-update-available");
          }
        });
      });
    } catch (err) {
      console.error("SW registration failed:", err);
    }
  });

  // Handle install prompt
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    dispatchPwaEvent("pwa-installable");
  });

  // Handle installed
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    dispatchPwaEvent("pwa-installed");
  });
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;

  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome === "accepted";
}

export function canInstall(): boolean {
  return deferredPrompt !== null;
}

export function skipWaiting() {
  navigator.serviceWorker?.controller?.postMessage({ type: "SKIP_WAITING" });
  window.location.reload();
}

export function clearServiceWorkerCache() {
  navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_CACHE" });
}

/**
 * Invalidate specific cached URLs in Service Worker by pattern.
 * Used after cover updates to ensure the new thumbnail is fetched from server.
 */
export function invalidateSwCache(urlPattern: string) {
  navigator.serviceWorker?.controller?.postMessage({
    type: "INVALIDATE_CACHE",
    urlPattern,
  });
}

function dispatchPwaEvent(type: string) {
  window.dispatchEvent(new CustomEvent(type));
}
