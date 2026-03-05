/**
 * NowenReader Plugin System
 * Provides a hook-based extensible architecture for plugins.
 */

// ============================================================
// Plugin Types
// ============================================================

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  minAppVersion?: string;
  permissions?: PluginPermission[];
  hooks?: string[];
}

export type PluginPermission =
  | "comics:read"
  | "comics:write"
  | "settings:read"
  | "settings:write"
  | "network"
  | "ui:toolbar"
  | "ui:sidebar"
  | "ui:reader"
  | "metadata:scrape";

export type HookName =
  | "onComicAdded"
  | "onComicDeleted"
  | "onBeforeRead"
  | "onAfterRead"
  | "onPageChange"
  | "onMetadataScrape"
  | "onSyncBefore"
  | "onSyncAfter"
  | "onSearchFilter"
  | "onToolbarRender"
  | "onReaderToolbarRender"
  | "onSidebarRender"
  | "onSettingsRender"
  | "onInit"
  | "onDestroy";

export interface HookContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HookHandler = (context: HookContext) => Promise<any> | any;

export interface PluginInstance {
  manifest: PluginManifest;
  enabled: boolean;
  hooks: Map<HookName, HookHandler>;
  settings: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api?: Record<string, (...args: any[]) => any>;
}

export interface PluginAPI {
  registerHook(hook: HookName, handler: HookHandler): void;
  getSettings(): Record<string, unknown>;
  setSetting(key: string, value: unknown): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callAPI(pluginId: string, method: string, ...args: any[]): any;
  log(message: string, level?: "info" | "warn" | "error"): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PluginFactory = (api: PluginAPI) => PluginInstance | Promise<PluginInstance>;

// ============================================================
// Plugin Manager (Singleton)
// ============================================================

class PluginManager {
  private plugins = new Map<string, PluginInstance>();
  private hookRegistry = new Map<HookName, { pluginId: string; handler: HookHandler }[]>();
  private pluginSettings = new Map<string, Record<string, unknown>>();
  private listeners = new Set<() => void>();

  /**
   * Register a built-in plugin
   */
  registerPlugin(manifest: PluginManifest, factory: PluginFactory): void {
    if (this.plugins.has(manifest.id)) {
      console.warn(`Plugin ${manifest.id} is already registered`);
      return;
    }

    const api = this.createPluginAPI(manifest.id);

    try {
      const result = factory(api);
      if (result instanceof Promise) {
        result.then((instance) => {
          this.activatePlugin(manifest.id, instance);
        });
      } else {
        this.activatePlugin(manifest.id, result);
      }
    } catch (err) {
      console.error(`Failed to initialize plugin ${manifest.id}:`, err);
    }
  }

  private activatePlugin(id: string, instance: PluginInstance): void {
    this.plugins.set(id, instance);

    // Register hooks
    for (const [hookName, handler] of instance.hooks) {
      if (!this.hookRegistry.has(hookName)) {
        this.hookRegistry.set(hookName, []);
      }
      this.hookRegistry.get(hookName)!.push({ pluginId: id, handler });
    }

    // Load saved settings
    const savedSettings = this.pluginSettings.get(id);
    if (savedSettings) {
      instance.settings = { ...instance.settings, ...savedSettings };
    }

    this.notifyListeners();

    // Call onInit hook
    this.executeHook("onInit", { pluginId: id });
  }

  /**
   * Unregister a plugin
   */
  unregisterPlugin(pluginId: string): void {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;

    // Call onDestroy
    this.executeHookForPlugin(pluginId, "onDestroy", {});

    // Remove hooks
    for (const [hookName, handlers] of this.hookRegistry) {
      this.hookRegistry.set(
        hookName,
        handlers.filter((h) => h.pluginId !== pluginId)
      );
    }

    this.plugins.delete(pluginId);
    this.notifyListeners();
  }

  /**
   * Enable/disable a plugin
   */
  setPluginEnabled(pluginId: string, enabled: boolean): void {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;
    instance.enabled = enabled;
    this.notifyListeners();
  }

  /**
   * Execute a hook across all enabled plugins
   */
  async executeHook(hook: HookName, context: HookContext = {}): Promise<HookContext> {
    const handlers = this.hookRegistry.get(hook) || [];
    let ctx = { ...context };

    for (const { pluginId, handler } of handlers) {
      const instance = this.plugins.get(pluginId);
      if (!instance || !instance.enabled) continue;

      try {
        const result = await handler(ctx);
        if (result !== undefined && typeof result === "object") {
          ctx = { ...ctx, ...result };
        }
      } catch (err) {
        console.error(`Plugin ${pluginId} hook ${hook} error:`, err);
      }
    }

    return ctx;
  }

  /**
   * Execute hook for a specific plugin
   */
  private async executeHookForPlugin(pluginId: string, hook: HookName, context: HookContext): Promise<void> {
    const handlers = this.hookRegistry.get(hook) || [];
    for (const h of handlers) {
      if (h.pluginId === pluginId) {
        try {
          await h.handler(context);
        } catch (err) {
          console.error(`Plugin ${pluginId} hook ${hook} error:`, err);
        }
      }
    }
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a specific plugin
   */
  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Create the API object exposed to plugins
   */
  private createPluginAPI(pluginId: string): PluginAPI {
    return {
      registerHook: (hook: HookName, handler: HookHandler) => {
        if (!this.hookRegistry.has(hook)) {
          this.hookRegistry.set(hook, []);
        }
        this.hookRegistry.get(hook)!.push({ pluginId, handler });
      },
      getSettings: () => {
        const instance = this.plugins.get(pluginId);
        return instance?.settings || {};
      },
      setSetting: (key: string, value: unknown) => {
        const instance = this.plugins.get(pluginId);
        if (instance) {
          instance.settings[key] = value;
          // Persist settings
          if (!this.pluginSettings.has(pluginId)) {
            this.pluginSettings.set(pluginId, {});
          }
          this.pluginSettings.get(pluginId)![key] = value;
          this.savePluginSettings();
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callAPI: (targetPluginId: string, method: string, ...args: any[]) => {
        const targetPlugin = this.plugins.get(targetPluginId);
        if (!targetPlugin?.api?.[method]) {
          throw new Error(`Plugin ${targetPluginId} does not expose API method ${method}`);
        }
        return targetPlugin.api[method](...args);
      },
      log: (message: string, level = "info") => {
        const prefix = `[Plugin:${pluginId}]`;
        switch (level) {
          case "warn":
            console.warn(prefix, message);
            break;
          case "error":
            console.error(prefix, message);
            break;
          default:
            console.log(prefix, message);
        }
      },
    };
  }

  /**
   * Subscribe to plugin state changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach((l) => l());
  }

  /**
   * Save plugin settings to localStorage
   */
  private savePluginSettings(): void {
    if (typeof window === "undefined") return;
    try {
      const data = Object.fromEntries(this.pluginSettings);
      localStorage.setItem("nowen-plugin-settings", JSON.stringify(data));
    } catch { /* ignore */ }
  }

  /**
   * Load plugin settings from localStorage
   */
  loadPluginSettings(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("nowen-plugin-settings");
      if (raw) {
        const data = JSON.parse(raw);
        for (const [id, settings] of Object.entries(data)) {
          this.pluginSettings.set(id, settings as Record<string, unknown>);
        }
      }
    } catch { /* ignore */ }
  }
}

// Singleton instance
export const pluginManager = new PluginManager();

// ============================================================
// Built-in Plugins
// ============================================================

/**
 * Reading Stats Plugin - Enhanced reading analytics
 */
export function registerReadingStatsPlugin(): void {
  pluginManager.registerPlugin(
    {
      id: "builtin-reading-stats",
      name: "Reading Stats Enhanced",
      version: "1.0.0",
      description: "Enhanced reading statistics with streak tracking and goals",
      author: "NowenReader",
      permissions: ["comics:read"],
      hooks: ["onAfterRead", "onPageChange"],
    },
    (api) => {
      const hooks = new Map<HookName, HookHandler>();

      hooks.set("onAfterRead", async (ctx) => {
        const settings = api.getSettings();
        const streakDays = (settings.streakDays as number) || 0;
        const lastReadDate = settings.lastReadDate as string;
        const today = new Date().toISOString().split("T")[0];

        if (lastReadDate !== today) {
          const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
          if (lastReadDate === yesterday) {
            api.setSetting("streakDays", streakDays + 1);
          } else {
            api.setSetting("streakDays", 1);
          }
          api.setSetting("lastReadDate", today);
        }

        return ctx;
      });

      hooks.set("onPageChange", async (ctx) => {
        const settings = api.getSettings();
        const totalPagesRead = (settings.totalPagesRead as number) || 0;
        api.setSetting("totalPagesRead", totalPagesRead + 1);
        return ctx;
      });

      return {
        manifest: {
          id: "builtin-reading-stats",
          name: "Reading Stats Enhanced",
          version: "1.0.0",
          description: "Enhanced reading statistics with streak tracking and goals",
          author: "NowenReader",
        },
        enabled: true,
        hooks,
        settings: {
          streakDays: 0,
          lastReadDate: "",
          totalPagesRead: 0,
          dailyGoalPages: 50,
        },
        api: {
          getStreak: () => {
            const settings = api.getSettings();
            return {
              days: settings.streakDays || 0,
              totalPages: settings.totalPagesRead || 0,
              dailyGoal: settings.dailyGoalPages || 50,
            };
          },
        },
      };
    }
  );
}

/**
 * Auto-Tag Plugin - Automatically tag comics based on filename patterns
 */
export function registerAutoTagPlugin(): void {
  pluginManager.registerPlugin(
    {
      id: "builtin-auto-tag",
      name: "Auto Tagger",
      version: "1.0.0",
      description: "Automatically tag comics based on filename patterns and metadata",
      author: "NowenReader",
      permissions: ["comics:read", "comics:write"],
      hooks: ["onComicAdded"],
    },
    (api) => {
      const hooks = new Map<HookName, HookHandler>();

      hooks.set("onComicAdded", async (ctx) => {
        const { filename, genre } = ctx;
        const suggestedTags: string[] = [];

        // Extract tags from filename patterns
        const patterns: [RegExp, string][] = [
          [/\[(\w+)\]/g, ""],  // Extract [TAG] patterns
          [/manga|漫画/i, "manga"],
          [/comic/i, "comic"],
          [/webtoon/i, "webtoon"],
          [/doujin/i, "doujinshi"],
        ];

        for (const [pattern, tag] of patterns) {
          if (tag) {
            if (pattern.test(filename)) suggestedTags.push(tag);
          } else {
            const matches = filename.matchAll(pattern as RegExp);
            for (const match of matches) {
              if (match[1] && match[1].length <= 20) {
                suggestedTags.push(match[1].toLowerCase());
              }
            }
          }
        }

        // Use genre from metadata
        if (genre) {
          const genres = genre.split(",").map((g: string) => g.trim().toLowerCase());
          suggestedTags.push(...genres);
        }

        if (suggestedTags.length > 0) {
          api.log(`Auto-tagged: ${suggestedTags.join(", ")}`);
        }

        return { ...ctx, suggestedTags };
      });

      return {
        manifest: {
          id: "builtin-auto-tag",
          name: "Auto Tagger",
          version: "1.0.0",
          description: "Automatically tag comics based on filename patterns and metadata",
          author: "NowenReader",
        },
        enabled: true,
        hooks,
        settings: {
          enableAutoTag: true,
          tagPatterns: [],
        },
      };
    }
  );
}

/**
 * AI Smart Tagger Plugin - Uses AI to analyze covers and suggest tags
 */
export function registerAITaggerPlugin(): void {
  pluginManager.registerPlugin(
    {
      id: "builtin-ai-tagger",
      name: "AI Smart Tagger",
      version: "1.0.0",
      description: "AI-powered automatic tagging based on cover analysis and metadata",
      author: "NowenReader",
      permissions: ["comics:read", "comics:write", "network"],
      hooks: ["onComicAdded", "onMetadataScrape"],
    },
    (api) => {
      const hooks = new Map<HookName, HookHandler>();

      hooks.set("onComicAdded", async (ctx) => {
        try {
          // Fetch AI config from server API to avoid importing server-side modules
          let aiConfig: { enableAutoTag?: boolean; enableCloudAI?: boolean; cloudApiKey?: string } = {};
          try {
            const configRes = await fetch("/api/ai/settings");
            if (configRes.ok) aiConfig = await configRes.json();
          } catch {
            return ctx; // AI service not available
          }
          if (!aiConfig.enableAutoTag) return ctx;

          const { filename, genre, title } = ctx;
          const suggestedTags: string[] = ctx.suggestedTags || [];

          // If cloud AI is enabled, try to analyze cover for tags via server API
          if (aiConfig.enableCloudAI && aiConfig.cloudApiKey && ctx.comicId) {
            try {
              const res = await fetch("/api/ai/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ comicId: ctx.comicId, type: "cover", title }),
              });
              if (res.ok) {
                const analysis = await res.json();
                if (analysis?.tags) {
                  suggestedTags.push(...analysis.tags.filter((t: string) => !suggestedTags.includes(t)));
                  api.log(`AI cover analysis tags: ${analysis.tags.join(", ")}`);
                }
              }
            } catch (err) {
              api.log(`AI cover analysis failed: ${err}`, "warn");
            }
          }

          // Use genre from metadata as fallback
          if (genre && suggestedTags.length === 0) {
            const genres = genre.split(",").map((g: string) => g.trim().toLowerCase());
            suggestedTags.push(...genres);
          }

          // Simple pattern-based tagging from filename as additional fallback
          const patterns: [RegExp, string][] = [
            [/manga|漫画/i, "manga"],
            [/comic/i, "comic"],
            [/webtoon/i, "webtoon"],
            [/doujin|同人/i, "doujinshi"],
            [/artbook|画集/i, "artbook"],
          ];

          for (const [pattern, tag] of patterns) {
            if (pattern.test(filename || "") && !suggestedTags.includes(tag)) {
              suggestedTags.push(tag);
            }
          }

          if (suggestedTags.length > 0) {
            api.log(`AI Smart Tagger: ${suggestedTags.join(", ")}`);
          }

          return { ...ctx, suggestedTags };
        } catch {
          return ctx;
        }
      });

      return {
        manifest: {
          id: "builtin-ai-tagger",
          name: "AI Smart Tagger",
          version: "1.0.0",
          description: "AI-powered automatic tagging based on cover analysis and metadata",
          author: "NowenReader",
        },
        enabled: true,
        hooks,
        settings: {
          enableCoverAnalysis: true,
        },
      };
    }
  );
}

/**
 * Reading Goal Plugin - Track daily/weekly reading goals
 */
export function registerReadingGoalPlugin(): void {
  pluginManager.registerPlugin(
    {
      id: "builtin-reading-goal",
      name: "Reading Goals",
      version: "1.0.0",
      description: "Set and track daily and weekly reading goals",
      author: "NowenReader",
      permissions: ["comics:read", "ui:sidebar"],
      hooks: ["onAfterRead"],
    },
    (api) => {
      const hooks = new Map<HookName, HookHandler>();

      hooks.set("onAfterRead", async (ctx) => {
        const settings = api.getSettings();
        const today = new Date().toISOString().split("T")[0];
        const todayMinutes = (settings[`day_${today}`] as number) || 0;
        const sessionMinutes = Math.round((ctx.duration || 0) / 60);

        api.setSetting(`day_${today}`, todayMinutes + sessionMinutes);

        const dailyGoal = (settings.dailyGoalMinutes as number) || 30;
        if (todayMinutes + sessionMinutes >= dailyGoal) {
          api.log(`Daily reading goal of ${dailyGoal} minutes achieved!`);
        }

        return ctx;
      });

      return {
        manifest: {
          id: "builtin-reading-goal",
          name: "Reading Goals",
          version: "1.0.0",
          description: "Set and track daily and weekly reading goals",
          author: "NowenReader",
        },
        enabled: true,
        hooks,
        settings: {
          dailyGoalMinutes: 30,
          weeklyGoalMinutes: 180,
        },
        api: {
          getTodayProgress: () => {
            const settings = api.getSettings();
            const today = new Date().toISOString().split("T")[0];
            const minutes = (settings[`day_${today}`] as number) || 0;
            const goal = (settings.dailyGoalMinutes as number) || 30;
            return { minutes, goal, percentage: Math.min(100, Math.round((minutes / goal) * 100)) };
          },
          getWeekProgress: () => {
            const settings = api.getSettings();
            let totalMinutes = 0;
            for (let i = 0; i < 7; i++) {
              const d = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
              totalMinutes += (settings[`day_${d}`] as number) || 0;
            }
            const goal = (settings.weeklyGoalMinutes as number) || 180;
            return { minutes: totalMinutes, goal, percentage: Math.min(100, Math.round((totalMinutes / goal) * 100)) };
          },
        },
      };
    }
  );
}
