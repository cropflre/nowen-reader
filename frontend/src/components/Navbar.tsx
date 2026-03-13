"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Search,
  Upload,
  BookMarked,
  Loader2,
  BarChart3,
  Sun,
  Moon,
  Globe,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/lib/theme-context";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { UserMenu } from "@/components/UserMenu";

interface NavbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onUpload?: () => void;
  uploading?: boolean;
}

export default function Navbar({
  searchQuery,
  onSearchChange,
  onUpload,
  uploading,
}: NavbarProps) {
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const t = useTranslation();
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 sm:h-16 max-w-[1800px] items-center justify-between px-3 sm:px-6">
        {/* Logo */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg bg-accent">
            <BookMarked className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
          </div>
          <span className="hidden sm:inline text-lg font-bold tracking-tight text-foreground">
            NowenReader
          </span>
        </div>

        {/* Search Bar */}
        <div className="flex flex-1 items-center justify-center px-2 sm:px-8">
          <div
            className={`relative flex w-full max-w-md items-center transition-all duration-300 ${
              isSearchFocused ? "max-w-lg" : ""
            }`}
          >
            <Search className="absolute left-3 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder={t.navbar.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              className="h-9 sm:h-10 w-full rounded-xl border border-border/60 bg-card/50 pl-10 pr-4 text-sm text-foreground placeholder:text-muted/60 outline-none transition-all duration-300 focus:border-accent/50 focus:bg-card focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Stats */}
          <Link
            href="/stats"
            className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl border border-border/60 text-muted transition-colors duration-200 hover:border-border hover:text-foreground"
            title={t.navbar.stats}
          >
            <BarChart3 className="h-4 w-4" />
          </Link>

          {/* E-Hentai */}
          <Link
            href="/ehentai"
            className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 text-muted transition-colors duration-200 hover:border-border hover:text-foreground"
            title={t.ehentai?.title || "E-Hentai"}
          >
            <Globe className="h-4 w-4" />
          </Link>

          {/* Upload */}
          <button
            onClick={onUpload}
            disabled={uploading}
            className="flex h-8 sm:h-9 items-center gap-1.5 sm:gap-2 rounded-xl bg-accent px-2.5 sm:px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{uploading ? t.navbar.uploading : t.navbar.upload}</span>
          </button>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 text-muted transition-colors duration-200 hover:border-border hover:text-foreground"
            title={theme === "dark" ? (t.readerToolbar?.dayMode || "Day") : (t.readerToolbar?.nightMode || "Night")}
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          {/* Language Switcher */}
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>

          {/* User Menu */}
          <UserMenu />
        </div>
      </div>
    </nav>
  );
}
