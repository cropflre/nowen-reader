"use client";

import { useEffect, useState } from "react";

export interface FileScannerBarProps {
  isScanning: boolean;
  progress: number;
  current: number;
  total: number;
  message?: string;
}

/**
 * Fixed bottom bar that shows file-scanning progress.
 * Auto-hides with a fade animation when scanning stops.
 */
export default function FileScannerBar({
  isScanning,
  progress,
  current,
  total,
  message,
}: FileScannerBarProps) {
  const [visible, setVisible] = useState(false);
  const [animateOut, setAnimateOut] = useState(false);

  useEffect(() => {
    if (isScanning) {
      setAnimateOut(false);
      setVisible(true);
    } else if (visible) {
      // Start fade-out, then unmount after animation completes
      setAnimateOut(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setAnimateOut(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isScanning]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  const pct = total > 0 ? Math.round((current / total) * 100) : progress;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 transition-opacity duration-300 ${
        animateOut ? "opacity-0" : "opacity-100"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Thin progress bar at top */}
      <div className="h-[2px] w-full bg-gray-800">
        <div
          className="h-full bg-blue-500 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Info row */}
      <div className="scanner-pulse flex items-center justify-center gap-3 bg-gray-900/80 px-4 py-2.5 backdrop-blur-md">
        {/* Spinning indicator */}
        <svg
          className="h-3.5 w-3.5 animate-spin text-blue-400"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className="opacity-25"
          />
          <path
            d="M12 2a10 10 0 0 1 10 10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>

        <span className="text-xs text-gray-300">
          {message || "Scanning..."}{" "}
          <span className="font-medium text-blue-400">{pct}%</span>
          <span className="ml-1 text-gray-500">
            ({current}/{total})
          </span>
        </span>
      </div>
    </div>
  );
}
