import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const PDF_WORKER_ASSET = "assets/pdf.worker.min.mjs";

function isPdfWorkerAsset(name: string | undefined): boolean {
  if (!name) return false;
  return name.replaceAll("\\", "/").endsWith("pdf.worker.min.mjs");
}

/**
 * PDF.js 的 Worker 之前使用 Vite 内容哈希文件名。应用升级或本地反复构建后，
 * 已打开页面/PWA 缓存可能仍引用已被清理的旧哈希文件，PDF.js 随后回退到
 * fake worker，并报 Failed to fetch dynamically imported module。
 *
 * Worker 与当前 pdfjs-dist 版本始终一起构建，因此使用稳定文件名，并由服务端
 * 对该文件设置 no-cache。这样既不会引用已经消失的旧哈希，也不会长期缓存旧版本。
 */
function verifyStablePdfWorker(): Plugin {
  return {
    name: "verify-stable-pdf-worker",
    generateBundle(_options, bundle) {
      if (!bundle[PDF_WORKER_ASSET]) {
        this.error(`PDF.js worker was not emitted as ${PDF_WORKER_ASSET}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), verifyStablePdfWorker()],
  resolve: {
    alias: {
      // Map @/ to frontend/src
      "@": path.resolve(__dirname, "src"),
      // Next.js shims — redirect Next.js imports to our compatibility layer
      "next/navigation": path.resolve(__dirname, "src/shims/next/navigation.ts"),
      "next/link": path.resolve(__dirname, "src/shims/next/link.tsx"),
      "next/image": path.resolve(__dirname, "src/shims/next/image.tsx"),
      "next/dynamic": path.resolve(__dirname, "src/shims/next/dynamic.tsx"),
      "next/headers": path.resolve(__dirname, "src/shims/next/headers.ts"),
      "next/font/google": path.resolve(__dirname, "src/shims/next/font/google.ts"),
    },
  },
  server: {
    port: 5090,
    proxy: {
      "/api/": {
        target: "http://localhost:5080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (isPdfWorkerAsset(assetInfo.name)) {
            return PDF_WORKER_ASSET;
          }
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
});
