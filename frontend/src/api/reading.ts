import { apiClient } from "@/lib/apiClient";

export interface ReadingActivityPayload {
  clientSessionId: string;
  page: number;
  totalPages: number;
  activeSeconds: number;
  sequence: number;
  finalize: boolean;
  trackProgress: boolean;
}

export async function recordReadingActivity(
  comicId: string,
  payload: ReadingActivityPayload,
): Promise<void> {
  await apiClient.post(`/api/reading/${encodeURIComponent(comicId)}/activity`, payload);
}

export function beaconReadingActivity(
  comicId: string,
  payload: ReadingActivityPayload,
): boolean {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
  const body = new Blob([JSON.stringify(payload)], { type: "application/json" });
  return navigator.sendBeacon(`/api/reading/${encodeURIComponent(comicId)}/activity`, body);
}
