import { apiPath } from "@/lib/base-path";
import { useEffect, useState } from "react";

// 与后端 internal/handler/system_pdf_renderer.go 保持字段一致
export interface PdfRendererStatus {
  available: boolean;
  tools: Record<string, string>; // mutool / pdftoppm / convert => 路径，未找到为空字符串
  active?: string;
  os: string;
  hint?: string;
}

let cached: PdfRendererStatus | null = null;
let inflight: Promise<PdfRendererStatus> | null = null;

async function fetchStatus(force = false): Promise<PdfRendererStatus> {
  if (!force && cached) return cached;
  if (inflight) return inflight;
  inflight = fetch(apiPath("/api/system/pdf-renderer"), { credentials: "include" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as PdfRendererStatus;
    })
    .then((data) => {
      cached = data;
      inflight = null;
      return data;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

/**
 * 探测后端 PDF 渲染工具（mutool / pdftoppm / convert）的可用情况。
 *
 * 用于：
 *   - PDF 阅读页：在工具缺失时给出醒目提示，避免用户面对一片空白
 *   - 「从内页选择封面」对话框（PDF 漫画）：提前阻止/提示
 *
 * - 仅当 enabled=true 时发起请求，结果会在模块内缓存，多个组件复用时不会重复请求
 * - 调用方可通过 refresh() 强制刷新（如用户在设置中改了 PdfRendererPath 后）
 */
export function usePdfRendererStatus(enabled: boolean = true) {
  const [status, setStatus] = useState<PdfRendererStatus | null>(cached);
  const [loading, setLoading] = useState<boolean>(enabled && !cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    fetchStatus()
      .then((data) => {
        if (!cancelled) {
          setStatus(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message || err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await fetchStatus(true);
      setStatus(data);
      setError(null);
      return data;
    } catch (err) {
      setError(String((err as Error)?.message || err));
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { status, loading, error, refresh };
}
