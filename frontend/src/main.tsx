import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "@/app/globals.css";

import { ThemeProvider } from "@/lib/theme-context";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth-context";
import { AuthGuard } from "@/components/AuthGuard";
import { PWARegister } from "@/app/pwa-register";


import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastProvider } from "@/components/Toast";
import MobileBottomNav from "@/components/MobileBottomNav";

// Pages — imported directly from original Next.js pages
// The "use client" directive is harmless in Vite
import Home from "@/app/page";
import ComicDetail from "@/app/comic/[id]/page";
import Reader from "@/app/reader/[id]/page";
import NovelReader from "@/app/novel/[id]/page";
import Recommendations from "@/app/recommendations/page";
import Stats from "@/app/stats/page";
import Logs from "@/app/logs/page";
import Settings from "@/app/settings/page";

function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>
              <ToastProvider>
                <AuthGuard>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/comic/:id" element={<ComicDetail />} />
                    <Route path="/reader/:id" element={<Reader />} />
                    <Route path="/novel/:id" element={<NovelReader />} />
                    <Route path="/recommendations" element={<Recommendations />} />
                    <Route path="/stats" element={<Stats />} />
                    <Route path="/logs" element={<Logs />} />
                    <Route path="/settings" element={<Settings />} />
                  </Routes>
                </AuthGuard>
                <MobileBottomNav />
              </ToastProvider>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </ErrorBoundary>
      <PWARegister />
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
