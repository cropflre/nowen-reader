import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Outlet, useLocation, useParams } from "react-router-dom";
import "@/app/globals.css";

import { ThemeProvider } from "@/lib/theme-context";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth-context";
import { AuthGuard } from "@/components/AuthGuard";
import { PWARegister } from "@/app/pwa-register";
import { useAuth } from "@/lib/auth-context";
import { Navigate } from "react-router-dom";
import { useSiteSettings } from "@/hooks/useSiteSettings";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastProvider } from "@/components/Toast";
import AppShell from "@/components/AppShell";
import MobileBottomNav from "@/components/MobileBottomNav";
import PageProgressBar from "@/components/PageProgressBar";
import { LibraryTypeCompatibilityGuard } from "@/components/LibraryTypeCompatibilityGuard";
import { seriesIdFromShelfId } from "@/lib/series-id";
import { getBasePath } from "@/lib/base-path";

// Pages — imported directly from original Next.js pages
// The "use client" directive is harmless in Vite
import Home from "@/app/page";
const BooksPage = React.lazy(() => import("@/app/books/page"));
const ComicDetail = React.lazy(() => import("@/app/comic/[id]/page"));
const Reader = React.lazy(() => import("@/app/reader/[id]/page"));
const NovelReader = React.lazy(() => import("@/app/novel/[id]/page"));
const SeriesDetail = React.lazy(() => import("@/app/series/[id]/page"));
const Recommendations = React.lazy(() => import("@/app/recommendations/page"));
const Stats = React.lazy(() => import("@/app/stats/page"));
const Logs = React.lazy(() => import("@/app/logs/page"));
const Settings = React.lazy(() => import("@/app/settings/page"));
const GroupDetail = React.lazy(() => import("@/app/group/[id]/page"));
const Scraper = React.lazy(() => import("@/app/scraper/page"));
const Collections = React.lazy(() => import("@/app/collections/page"));
const TagManager = React.lazy(() => import("@/app/tag-manager/page"));
const DataAdmin = React.lazy(() => import("@/app/data-admin/page"));
const DataQA = React.lazy(() => import("@/app/data-qa/page"));
const History = React.lazy(() => import("@/app/history/page"));
const BookFlipDevPage = React.lazy(() => import("@/app/dev/book-flip/page"));

/** 动态设置浏览器标签页标题 */
function SiteTitle() {
  const { siteName } = useSiteSettings();
  React.useEffect(() => {
    document.title = `${siteName} - 数字阅读库`;
  }, [siteName]);
  return null;
}

/** 管理员路由守卫 —— 非管理员用户重定向到首页 */
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function ComicDetailRoute() {
  const { id = "" } = useParams();
  const seriesId = seriesIdFromShelfId(id);
  if (seriesId) {
    return <Navigate to={`/series/${seriesId}`} replace />;
  }
  return <ComicDetail />;
}

/**
 * 作品卡片继续复用现有 ComicCard。后端为作品生成 series-{id} 的虚拟卡片 ID，
 * 这里在进入阅读器前将其安全转发到作品详情页；普通漫画仍进入原阅读器。
 */
function ReaderRoute() {
  const { id = "" } = useParams();
  const seriesId = seriesIdFromShelfId(id);
  if (seriesId) {
    return <Navigate to={`/series/${seriesId}`} replace />;
  }
  return <Reader />;
}

/** 只替换和过渡当前路由的内容，外层应用框架保持挂载。 */
function AnimatedOutlet() {
  const location = useLocation();
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-b-accent" />
        </div>
      }
    >
      <div key={location.pathname} className="animate-page-enter overflow-x-hidden">
        <Outlet />
      </div>
    </React.Suspense>
  );
}

function ShellRouteLayout() {
  return (
    <AppShell className="overflow-x-hidden">
      <AnimatedOutlet />
    </AppShell>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<ShellRouteLayout />}>
        <Route index element={<Home />} />
        <Route path="books" element={<BooksPage />} />
        <Route path="recommendations" element={<Recommendations />} />
        <Route path="stats" element={<Stats />} />
        <Route path="logs" element={<AdminRoute><Logs /></AdminRoute>} />
        <Route path="settings" element={<Settings />} />
        <Route path="history" element={<History />} />
        <Route path="scraper" element={<AdminRoute><Scraper /></AdminRoute>} />
        <Route path="collections" element={<AdminRoute><Collections /></AdminRoute>} />
        <Route path="tag-manager" element={<AdminRoute><TagManager /></AdminRoute>} />
        <Route path="data-admin" element={<AdminRoute><DataAdmin /></AdminRoute>} />
        <Route path="data-qa" element={<AdminRoute><DataQA /></AdminRoute>} />
      </Route>

      <Route element={<AnimatedOutlet />}>
        <Route path="comic/:id" element={<ComicDetailRoute />} />
        <Route path="reader/:id" element={<ReaderRoute />} />
        <Route path="novel/:id" element={<NovelReader />} />
        <Route path="series/:id" element={<SeriesDetail />} />
        <Route path="group/:id" element={<GroupDetail />} />
        <Route path="dev/book-flip" element={<BookFlipDevPage />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter basename={getBasePath()}>
      <ErrorBoundary>
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>
              <ToastProvider>
                <AuthGuard>
                  <SiteTitle />
                  <LibraryTypeCompatibilityGuard />
                  <PageProgressBar />
                  <AppRoutes />
                  <MobileBottomNav />
                </AuthGuard>
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
