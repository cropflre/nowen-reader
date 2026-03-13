import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "@/app/globals.css";

import { ThemeProvider } from "@/lib/theme-context";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth-context";
import { AuthGuard } from "@/components/AuthGuard";
import { PWARegister } from "@/app/pwa-register";
import { PWAInstallBanner } from "@/components/PWAInstall";

// Pages — imported directly from original Next.js pages
// The "use client" directive is harmless in Vite
import Home from "@/app/page";
import ComicDetail from "@/app/comic/[id]/page";
import Reader from "@/app/reader/[id]/page";
import EHentai from "@/app/ehentai/page";
import Recommendations from "@/app/recommendations/page";
import Stats from "@/app/stats/page";

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <AuthGuard>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/comic/:id" element={<ComicDetail />} />
                <Route path="/reader/:id" element={<Reader />} />
                <Route path="/ehentai" element={<EHentai />} />
                <Route path="/recommendations" element={<Recommendations />} />
                <Route path="/stats" element={<Stats />} />
              </Routes>
            </AuthGuard>
            <PWAInstallBanner />
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
      <PWARegister />
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
