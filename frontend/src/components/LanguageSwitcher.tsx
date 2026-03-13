"use client";

import { useLocale, type Locale } from "@/lib/i18n";
import { Globe } from "lucide-react";

const localeLabels: Record<Locale, string> = {
  "zh-CN": "中",
  en: "EN",
};

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  const toggle = () => {
    setLocale(locale === "zh-CN" ? "en" : "zh-CN");
  };

  return (
    <button
      onClick={toggle}
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 text-muted transition-colors duration-200 hover:border-border hover:text-foreground"
      title={locale === "zh-CN" ? "Switch to English" : "切换到中文"}
    >
      <span className="text-xs font-medium">{localeLabels[locale]}</span>
    </button>
  );
}
