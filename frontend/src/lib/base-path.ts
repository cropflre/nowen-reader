declare global {
  interface Window {
    __NOWEN_READER_CONFIG__?: {
      basePath?: string;
    };
  }
}

/**
 * Normalize a base path string.
 * - "/" or "" -> ""
 * - "/reader/" -> "/reader"
 * - "reader" -> "/reader"
 */
export function normalizeBasePath(raw?: string): string {
  if (!raw) return "";
  let path = raw.trim();
  if (path === "" || path === "/") return "";
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

/**
 * Returns the normalized runtime Base Path (e.g. "/reader" or "").
 * Reads from window.__NOWEN_READER_CONFIG__.basePath injected by the server.
 */
export function getBasePath(): string {
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="nowen-base-path"]');
    if (meta) {
      const content = meta.getAttribute("content");
      if (content !== null) {
        return normalizeBasePath(content);
      }
    }
  }
  if (typeof window !== "undefined" && window.__NOWEN_READER_CONFIG__?.basePath) {
    return normalizeBasePath(window.__NOWEN_READER_CONFIG__.basePath);
  }
  return "";
}

/**
 * Prepend Base Path to an application page path (for React Router / window.location).
 * e.g. appPath("/books") -> "/reader/books" or "/books"
 */
export function appPath(path?: string): string {
  const base = getBasePath();
  if (!path || path === "/") {
    return base || "/";
  }
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  if (base && (path === base || path.startsWith(base + "/"))) {
    return path;
  }
  return base + path;
}

/**
 * Prepend Base Path to an API path.
 * e.g. apiPath("/comics") -> "/reader/api/comics" or "/api/comics"
 * e.g. apiPath("comics") -> "/reader/api/comics" or "/api/comics"
 */
export function apiPath(path: string): string {
  if (!path) return (getBasePath() || "") + "/api";

  // Full URLs (http://, https://, blob:, data:) are left untouched
  if (/^(https?:|blob:|data:)/i.test(path)) {
    return path;
  }

  const base = getBasePath();
  let cleanPath = path.trim();
  if (!cleanPath.startsWith("/")) {
    cleanPath = "/" + cleanPath;
  }

  if (base && (cleanPath.startsWith(base + "/api") || cleanPath === base + "/api")) {
    return cleanPath;
  }

  // Ensure /api prefix
  if (!cleanPath.startsWith("/api/") && cleanPath !== "/api") {
    cleanPath = "/api" + cleanPath;
  }

  return base + cleanPath;
}

/**
 * Strip Base Path from a pathname.
 * Useful when receiving a full path and needing relative app path.
 */
export function stripBasePath(pathname: string): string {
  const base = getBasePath();
  if (!base) return pathname;
  if (pathname === base) return "/";
  if (pathname.startsWith(base + "/")) {
    return pathname.slice(base.length);
  }
  return pathname;
}
