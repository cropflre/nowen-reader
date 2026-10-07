// Shim for next/navigation — maps to react-router-dom equivalents
import { useParams as useRouterParams, useNavigate } from "react-router-dom";

export function useParams() {
  return useRouterParams();
}

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (path: string) => navigate(path),
    replace: (path: string) => navigate(path, { replace: true }),
    back: (fallback?: string) => {
      // React Router's index counts in-app entries, unlike history.length,
      // which may include a different site or a directly opened reader tab.
      if (fallback && !(window.history.state?.idx > 0)) {
        navigate(fallback, { replace: true });
      } else {
        navigate(-1);
      }
    },
    forward: () => navigate(1),
    refresh: () => window.location.reload(),
    prefetch: () => {},
  };
}

export function usePathname() {
  return window.location.pathname;
}

export function useSearchParams() {
  return new URLSearchParams(window.location.search);
}

export function redirect(url: string) {
  window.location.href = url;
}
