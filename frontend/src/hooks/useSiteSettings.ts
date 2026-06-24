"use client";

import { useState, useEffect } from "react";

interface SiteSettings {
  siteName: string;
  siteIcon: string;
  scraperEnabled: boolean;
}

const defaultSettings: SiteSettings = {
  siteName: "NowenReader",
  siteIcon: "",
  scraperEnabled: false,
};

// 模块级缓存，避免每个组件都重复请求
let cachedSettings: SiteSettings | null = null;
let fetchPromise: Promise<SiteSettings> | null = null;

async function fetchSiteSettings(): Promise<SiteSettings> {
  try {
    const res = await fetch("/api/site-settings");
    if (!res.ok) return defaultSettings;
    const data = await res.json();
    return {
      siteName: data.siteName || "NowenReader",
      siteIcon: data.siteIcon || "",
      scraperEnabled: data.scraperEnabled ?? false,
    };
  } catch {
    return defaultSettings;
  }
}

/**
 * 获取站点设置的 hook，主要用于获取 scraperEnabled 等全局开关状态。
 * 使用模块级缓存，多个组件共享同一份数据。
 * 同时自动同步浏览器 favicon 为用户上传的站点图标。
 */
export function useSiteSettings(): SiteSettings {
  const [settings, setSettings] = useState<SiteSettings>(cachedSettings || defaultSettings);

  useEffect(() => {
    if (cachedSettings) {
      setSettings(cachedSettings);
      return;
    }

    if (!fetchPromise) {
      fetchPromise = fetchSiteSettings().then((s) => {
        cachedSettings = s;
        fetchPromise = null;
        return s;
      });
    }

    fetchPromise.then((s) => setSettings(s));
  }, []);

  // 同步浏览器 favicon
  useEffect(() => {
    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!link) return;

    if (settings.siteIcon) {
      link.href = `/api/site-settings/icon?t=${Date.now()}`;
    } else {
      link.href = "/icons/icon-192.png";
    }
  }, [settings.siteIcon]);

  return settings;
}

/**
 * 使缓存失效，下次调用 useSiteSettings 时会重新请求。
 */
export function invalidateSiteSettings() {
  cachedSettings = null;
  fetchPromise = null;
}
