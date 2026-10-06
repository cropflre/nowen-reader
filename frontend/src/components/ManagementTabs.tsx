"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { managementItems } from "@/lib/management-navigation";

export default function ManagementTabs() {
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const active = activeRef.current;
    if (!nav || !active) return;
    const reveal = () => {
      const bounds = nav.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      if (tab.left < bounds.left) nav.scrollLeft += tab.left - bounds.left;
      else if (tab.right > bounds.right) nav.scrollLeft += tab.right - bounds.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname]);
  return <nav ref={navRef} className="management-tabs" aria-label="管理工具">
    {managementItems.map(({ href, label }) => {
      const active = pathname === href || pathname.startsWith(`${href}/`);
      return <Link key={href} href={href} ref={active ? activeRef : undefined}
      aria-current={active ? "page" : undefined}
      onKeyDown={(event) => {
        const links = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLAnchorElement>("a") || []);
        const index = links.indexOf(event.currentTarget);
        const next = event.key === "ArrowRight" ? (index + 1) % links.length
          : event.key === "ArrowLeft" ? (index + links.length - 1) % links.length
          : event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        links[next]?.focus();
      }}>{label}</Link>;
    })}
  </nav>;
}
