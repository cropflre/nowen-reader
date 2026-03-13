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
    back: () => navigate(-1),
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
