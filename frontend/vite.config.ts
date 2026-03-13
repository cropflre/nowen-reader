import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
