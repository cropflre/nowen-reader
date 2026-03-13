"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa";

export function PWARegister() {
  useEffect(() => {
    // Register Service Worker
    registerServiceWorker();
  }, []);

  return null;
}
