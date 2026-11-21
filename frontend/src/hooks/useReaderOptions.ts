"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ReaderOptions, defaultReaderOptions } from "@/types/reader";
import { useAuth } from "@/lib/auth-context";
import {
  COMIC_LAYOUT_OVERRIDE_KEYS,
  type ComicLayoutOverrideKey,
  getReaderPreferences,
  saveReaderPreference,
  deleteReaderPreference,
} from "@/api/readerAssets";

export type ReaderOptionScope = "global" | "series" | "comic";

export interface UseReaderOptionsScopeContext {
  comicId?: string;
  seriesId?: string | null;
}

const LEGACY_STORAGE_KEY = "reader-options";
const MIGRATED_KEY_PREFIX = "nowen-reader:migrated:reader-options:";
const LAYOUT_KEY_SET = new Set<string>(COMIC_LAYOUT_OVERRIDE_KEYS);

function getUserStorageKey(uid: string): string {
  return `${LEGACY_STORAGE_KEY}:${uid}`;
}

function getMigrationFlagKey(uid: string): string {
  return `${MIGRATED_KEY_PREFIX}${uid}`;
}

function mergeReaderOptions(
  base: ReaderOptions,
  raw?: Record<string, unknown> | null
): ReaderOptions {
  if (!raw || typeof raw !== "object") return base;
  const parsed = raw as Partial<ReaderOptions>;
  return {
    ...base,
    ...parsed,
    imageBrightness: parsed.imageBrightness ?? base.imageBrightness,
    imageContrast: parsed.imageContrast ?? base.imageContrast,
    imageGrayscale: parsed.imageGrayscale ?? base.imageGrayscale,
    imageFilterPreset: parsed.imageFilterPreset ?? base.imageFilterPreset,
  };
}

function pickLayoutOverride(
  raw?: Record<string, unknown> | null
): Partial<Pick<ReaderOptions, ComicLayoutOverrideKey>> | null {
  if (!raw || typeof raw !== "object") return null;
  const picked: Record<string, unknown> = {};
  for (const key of COMIC_LAYOUT_OVERRIDE_KEYS) {
    if (key in raw && raw[key] !== undefined) {
      picked[key] = raw[key];
    }
  }
  return Object.keys(picked).length > 0
    ? (picked as Partial<Pick<ReaderOptions, ComicLayoutOverrideKey>>)
    : null;
}

function readLocalGlobalOptions(uid: string): {
  options: ReaderOptions;
  hasLegacy: boolean;
} {
  try {
    const userRaw = localStorage.getItem(getUserStorageKey(uid));
    if (userRaw) {
      return {
        options: mergeReaderOptions(defaultReaderOptions, JSON.parse(userRaw)),
        hasLegacy: false,
      };
    }
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      return {
        options: mergeReaderOptions(
          defaultReaderOptions,
          JSON.parse(legacyRaw)
        ),
        hasLegacy: true,
      };
    }
  } catch {
    // ignore storage errors
  }
  return { options: defaultReaderOptions, hasLegacy: false };
}

function writeLocalGlobalOptions(uid: string, opts: ReaderOptions): void {
  try {
    localStorage.setItem(getUserStorageKey(uid), JSON.stringify(opts));
  } catch {
    // ignore storage errors
  }
}

export function useReaderOptions(scopeCtx?: UseReaderOptionsScopeContext) {
  const { user } = useAuth();
  const uid = user?.id ?? "anon";
  const comicId = scopeCtx?.comicId?.trim() || "";
  const seriesId = scopeCtx?.seriesId?.trim() || "";

  const [globalOptions, setGlobalOptions] =
    useState<ReaderOptions>(defaultReaderOptions);
  const [seriesOverride, setSeriesOverride] = useState<Partial<
    Pick<ReaderOptions, ComicLayoutOverrideKey>
  > | null>(null);
  const [comicOverride, setComicOverride] = useState<Partial<
    Pick<ReaderOptions, ComicLayoutOverrideKey>
  > | null>(null);
  const [activeScope, setActiveScopeState] =
    useState<ReaderOptionScope>("global");
  const [loaded, setLoaded] = useState(false);
  const [remoteRevision, setRemoteRevision] = useState(0);

  const globalOptionsRef = useRef(globalOptions);
  const seriesOverrideRef = useRef(seriesOverride);
  const comicOverrideRef = useRef(comicOverride);
  const activeScopeRef = useRef<ReaderOptionScope>("global");
  const scopeManuallySetRef = useRef(false);
  const pendingSavesRef = useRef<
    Map<
      string,
      {
        timer: number;
        payload: Record<string, unknown>;
      }
    >
  >(new Map());

  globalOptionsRef.current = globalOptions;
  seriesOverrideRef.current = seriesOverride;
  comicOverrideRef.current = comicOverride;
  activeScopeRef.current = activeScope;

  // Reset manual scope lock when switching books
  useEffect(() => {
    scopeManuallySetRef.current = false;
  }, [comicId, uid]);

  // Flush or clear pending debounced saves when unmounting
  useEffect(() => {
    const pendingMap = pendingSavesRef.current;
    return () => {
      pendingMap.forEach((entry, scopeKey) => {
        window.clearTimeout(entry.timer);
        if (user?.id) {
          void saveReaderPreference(scopeKey, entry.payload).catch(() => {});
        }
      });
      pendingMap.clear();
    };
  }, [user?.id]);

  const scheduleCloudSave = useCallback(
    (scopeKey: string, payload: Record<string, unknown>) => {
      if (!user?.id) return;
      const existing = pendingSavesRef.current.get(scopeKey);
      if (existing) {
        window.clearTimeout(existing.timer);
      }
      const timer = window.setTimeout(() => {
        pendingSavesRef.current.delete(scopeKey);
        void saveReaderPreference(scopeKey, payload).catch(() => {});
      }, 250);
      pendingSavesRef.current.set(scopeKey, { timer, payload });
    },
    [user?.id]
  );

  // Hydrate from localStorage + server preferences
  useEffect(() => {
    let cancelled = false;
    const { options: localGlobal, hasLegacy } = readLocalGlobalOptions(uid);
    globalOptionsRef.current = localGlobal;
    setGlobalOptions(localGlobal);

    if (!user?.id) {
      setSeriesOverride(null);
      setComicOverride(null);
      setLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    const syncFromServer = async () => {
      try {
        const res = await getReaderPreferences({
          comicId: comicId || undefined,
          seriesId: seriesId || undefined,
        });
        if (cancelled) return;

        const serverGlobal =
          res.globalComic && typeof res.globalComic === "object"
            ? res.globalComic
            : {};
        const hasServerGlobal = Object.keys(serverGlobal).length > 0;
        const migratedKey = getMigrationFlagKey(uid);
        const alreadyMigrated = (() => {
          try {
            return localStorage.getItem(migratedKey) === "1";
          } catch {
            return false;
          }
        })();

        if (hasServerGlobal) {
          const mergedGlobal = mergeReaderOptions(
            defaultReaderOptions,
            serverGlobal
          );
          globalOptionsRef.current = mergedGlobal;
          setGlobalOptions(mergedGlobal);
          writeLocalGlobalOptions(uid, mergedGlobal);
        } else if (!alreadyMigrated && hasLegacy) {
          await saveReaderPreference(
            "global_comic",
            localGlobal as unknown as Record<string, unknown>
          );
          try {
            localStorage.setItem(migratedKey, "1");
          } catch {
            // ignore storage errors
          }
          writeLocalGlobalOptions(uid, localGlobal);
        }

        const nextSeries = seriesId
          ? pickLayoutOverride(res.seriesOverride)
          : null;
        const nextComic = comicId
          ? pickLayoutOverride(res.comicOverride)
          : null;

        seriesOverrideRef.current = nextSeries;
        comicOverrideRef.current = nextComic;
        setSeriesOverride(nextSeries);
        setComicOverride(nextComic);

        if (!scopeManuallySetRef.current) {
          if (nextComic) {
            setActiveScopeState("comic");
          } else if (nextSeries && seriesId) {
            setActiveScopeState("series");
          } else {
            setActiveScopeState("global");
          }
        }
        setRemoteRevision((r) => r + 1);
      } catch {
        // Offline / error: retain local cached global options
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    void syncFromServer();
    return () => {
      cancelled = true;
    };
  }, [uid, user?.id, comicId, seriesId]);

  const setActiveScope = useCallback(
    (scope: ReaderOptionScope) => {
      if (scope === "series" && !seriesId) return;
      if (scope === "comic" && !comicId) return;
      scopeManuallySetRef.current = true;
      setActiveScopeState(scope);
    },
    [comicId, seriesId]
  );

  const options = useMemo<ReaderOptions>(
    () => ({
      ...defaultReaderOptions,
      ...globalOptions,
      ...(seriesId && seriesOverride ? seriesOverride : {}),
      ...(comicId && comicOverride ? comicOverride : {}),
    }),
    [globalOptions, seriesId, seriesOverride, comicId, comicOverride]
  );

  const updateOptions = useCallback(
    (partial: Partial<ReaderOptions>) => {
      const scope = activeScopeRef.current;
      const layoutPatch: Record<string, unknown> = {};
      const globalPatch: Partial<ReaderOptions> = {};

      for (const [key, val] of Object.entries(partial)) {
        if (val === undefined) continue;
        if (LAYOUT_KEY_SET.has(key)) {
          layoutPatch[key] = val;
        } else {
          (globalPatch as Record<string, unknown>)[key] = val;
        }
      }

      const hasLayout = Object.keys(layoutPatch).length > 0;
      const hasGlobal = Object.keys(globalPatch).length > 0;

      if (hasGlobal || (hasLayout && scope === "global")) {
        const mergedPatch: Partial<ReaderOptions> =
          scope === "global"
            ? { ...globalPatch, ...layoutPatch }
            : globalPatch;
        const nextGlobal = { ...globalOptionsRef.current, ...mergedPatch };
        globalOptionsRef.current = nextGlobal;
        setGlobalOptions(nextGlobal);
        writeLocalGlobalOptions(uid, nextGlobal);
        scheduleCloudSave(
          "global_comic",
          nextGlobal as unknown as Record<string, unknown>
        );
      }

      if (hasLayout && scope === "series" && seriesId) {
        const nextSeries = {
          ...(seriesOverrideRef.current ?? {}),
          ...layoutPatch,
        } as Partial<Pick<ReaderOptions, ComicLayoutOverrideKey>>;
        seriesOverrideRef.current = nextSeries;
        setSeriesOverride(nextSeries);
        scheduleCloudSave(`series:${seriesId}`, nextSeries);
      } else if (hasLayout && scope === "comic" && comicId) {
        const nextComic = {
          ...(comicOverrideRef.current ?? {}),
          ...layoutPatch,
        } as Partial<Pick<ReaderOptions, ComicLayoutOverrideKey>>;
        comicOverrideRef.current = nextComic;
        setComicOverride(nextComic);
        scheduleCloudSave(`comic:${comicId}`, nextComic);
      }
    },
    [uid, comicId, seriesId, scheduleCloudSave]
  );

  const resetOverride = useCallback(
    (targetScope: "series" | "comic") => {
      if (targetScope === "series" && seriesId) {
        const scopeKey = `series:${seriesId}`;
        const pending = pendingSavesRef.current.get(scopeKey);
        if (pending) {
          window.clearTimeout(pending.timer);
          pendingSavesRef.current.delete(scopeKey);
        }
        seriesOverrideRef.current = null;
        setSeriesOverride(null);
        setRemoteRevision((r) => r + 1);
        if (!comicOverrideRef.current) {
          setActiveScopeState("global");
        }
        if (user?.id) {
          void deleteReaderPreference(scopeKey).catch(() => {});
        }
      } else if (targetScope === "comic" && comicId) {
        const scopeKey = `comic:${comicId}`;
        const pending = pendingSavesRef.current.get(scopeKey);
        if (pending) {
          window.clearTimeout(pending.timer);
          pendingSavesRef.current.delete(scopeKey);
        }
        comicOverrideRef.current = null;
        setComicOverride(null);
        setRemoteRevision((r) => r + 1);
        setActiveScopeState(
          seriesOverrideRef.current && seriesId ? "series" : "global"
        );
        if (user?.id) {
          void deleteReaderPreference(scopeKey).catch(() => {});
        }
      }
    },
    [comicId, seriesId, user?.id]
  );

  return {
    options,
    updateOptions,
    loaded,
    remoteRevision,
    activeScope,
    setActiveScope,
    hasSeriesOverride: Boolean(seriesId && seriesOverride),
    hasComicOverride: Boolean(comicId && comicOverride),
    resetOverride,
  };
}
