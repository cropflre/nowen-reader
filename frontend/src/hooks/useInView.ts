import { useRef, useState, useEffect, useCallback } from "react";

interface UseInViewOptions {
  /** 触发阈值，0~1，默认 0.1 */
  threshold?: number;
  /** 仅触发一次（进入后不再监听），默认 true */
  once?: boolean;
  /** root margin，默认 "0px 0px 80px 0px"，让元素快进入视口时就触发 */
  rootMargin?: string;
}

/**
 * 检测元素是否进入视口
 * @returns [ref, isInView] — 把 ref 绑到目标元素，isInView 为 true 时表示已可见
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(
  options: UseInViewOptions = {}
): [React.RefObject<T | null>, boolean] {
  const { threshold = 0.1, once = true, rootMargin = "0px 0px 80px 0px" } = options;
  const ref = useRef<T | null>(null);
  const [isInView, setIsInView] = useState(false);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[], observer: IntersectionObserver) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setIsInView(true);
          if (once && ref.current) {
            observer.unobserve(ref.current);
          }
        } else if (!once) {
          setIsInView(false);
        }
      }
    },
    [once]
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 优先检查 prefers-reduced-motion，如果关闭动画则直接标记为可见
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(handleIntersect, {
      threshold,
      rootMargin,
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [handleIntersect, threshold, rootMargin]);

  return [ref, isInView];
}
