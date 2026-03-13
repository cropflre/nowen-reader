"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import zhCN, { type Translations } from "./locales/zh-CN";
import en from "./locales/en";

export type Locale = "zh-CN" | "en";

const localeMap: Record<Locale, Translations> = {
  "zh-CN": zhCN,
  en,
};

const STORAGE_KEY = "nowen-reader-locale";

interface I18nContextValue {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  t: zhCN,
  setLocale: () => {},
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("zh-CN");

  // Load saved locale on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (saved && localeMap[saved]) {
        setLocaleState(saved);
      }
    } catch {}
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
    } catch {}
    // Update html lang attribute
    document.documentElement.lang = newLocale === "zh-CN" ? "zh-CN" : "en";
  }, []);

  const t = localeMap[locale];

  return (
    <I18nContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const { t } = useContext(I18nContext);
  return t;
}

export function useLocale() {
  const { locale, setLocale } = useContext(I18nContext);
  return { locale, setLocale };
}
