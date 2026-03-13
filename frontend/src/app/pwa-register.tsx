"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa";
import {
  registerReadingStatsPlugin,
  registerAutoTagPlugin,
  registerReadingGoalPlugin,
  registerAITaggerPlugin,
  pluginManager,
} from "@/lib/plugin-system";

export function PWARegister() {
  useEffect(() => {
    // Register Service Worker
    registerServiceWorker();

    // Initialize plugin system
    pluginManager.loadPluginSettings();
    registerReadingStatsPlugin();
    registerAutoTagPlugin();
    registerReadingGoalPlugin();
    registerAITaggerPlugin();
  }, []);

  return null;
}
