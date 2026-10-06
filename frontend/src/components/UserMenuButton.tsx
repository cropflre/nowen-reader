"use client";

import { ChevronDown, UserRound } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface UserMenuButtonProps {
  user: { username: string; nickname?: string } | null;
  open: boolean;
  onClick: () => void;
}

export default function UserMenuButton({ user, open, onClick }: UserMenuButtonProps) {
  const t = useTranslation();
  const name = user?.nickname?.trim() || user?.username.trim() || t.auth.userMenu;
  const initial = user ? Array.from(name)[0]?.toUpperCase() : "";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${t.auth.userMenu} ${name}`}
      aria-expanded={open}
      aria-haspopup="true"
      title={name}
      className={`inline-flex h-10 min-w-0 max-w-[120px] items-center gap-1.5 rounded-lg px-1.5 text-foreground transition-colors hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-accent sm:max-w-[196px] sm:gap-2 sm:px-2 ${open ? "bg-card-hover" : ""}`}
    >
      <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/20 bg-accent/15 text-xs font-semibold text-accent sm:h-8 sm:w-8">
        {initial || <UserRound className="h-4 w-4" />}
      </span>
      <span className="min-w-0 max-w-[60px] truncate text-xs font-medium sm:max-w-[128px] sm:text-[13px]">{name}</span>
      <ChevronDown aria-hidden="true" className={`h-3 w-3 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}
