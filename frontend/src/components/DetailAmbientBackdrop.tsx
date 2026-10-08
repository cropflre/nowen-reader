"use client";

import DashboardAmbientBackdrop from "@/components/home/DashboardAmbientBackdrop";
import type { AmbientCover } from "@/components/home/dashboard-shelf";
import { usePrivacyMode } from "@/hooks/usePrivacyMode";
import "./home/dashboard-main.css";
import "./app-shell-material.css";

export default function DetailAmbientBackdrop({ cover }: { cover: AmbientCover }) {
  const { enabled, blurNSFW } = usePrivacyMode();
  return <DashboardAmbientBackdrop comics={[cover]} activeId={cover.id} hideNSFW={enabled && blurNSFW} />;
}
