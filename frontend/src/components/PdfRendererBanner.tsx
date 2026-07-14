import { AlertTriangle, ExternalLink, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { usePdfRendererStatus } from "../hooks/usePdfRendererStatus";

interface Props {
  /**
   * 是否启用探测。通常只在打开 PDF 阅读 / 选内页封面时才探测；
   * 默认 true。
   */
  enabled?: boolean;
  /**
   * 紧凑模式：用于对话框等空间有限的场景（不显示安装步骤详情，仅一行提示 + 链接）。
   */
  compact?: boolean;
  /**
   * 当 PDF 渲染器可用时是否显示一个绿色勾的"已就绪"提示（默认 false）。
   */
  showWhenAvailable?: boolean;
  className?: string;
}

/**
 * PDF 渲染器状态提示条。
 *
 * 当后端探测不到 mutool / pdftoppm / convert 时，醒目展示安装提示；
 * 否则不渲染任何内容（避免打扰）。
 */
export default function PdfRendererBanner({
  enabled = true,
  compact = false,
  showWhenAvailable = false,
  className = "",
}: Props) {
  const { status, loading, refresh } = usePdfRendererStatus(enabled);
  const [dismissed, setDismissed] = useState(false);

  if (!enabled) return null;
  if (loading && !status) return null;
  if (dismissed) return null;
  if (!status) return null;

  if (status.available) {
    if (!showWhenAvailable) return null;
    return (
      <div
        className={`flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-300 ${className}`}
      >
        <span>PDF 渲染工具已就绪{status.active ? `（${status.active}）` : ""}</span>
      </div>
    );
  }

  const isWindows = status.os === "windows";

  return (
    <div
      className={`relative rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/70 dark:bg-amber-900/20 dark:text-amber-200 ${className}`}
      role="alert"
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-1.5 top-1.5 rounded p-0.5 text-amber-700/70 hover:bg-amber-100 dark:text-amber-300/70 dark:hover:bg-amber-800/30"
        aria-label="关闭提示"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-start gap-2 pr-5">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            未检测到 PDF 渲染工具，PDF 文件无法正常显示
          </div>

          {!compact && (
            <div className="mt-1.5 space-y-1 text-xs leading-relaxed text-amber-800 dark:text-amber-300/90">
              {status.hint && <div>{status.hint}</div>}

              {isWindows && (
                <ol className="ml-4 list-decimal space-y-0.5">
                  <li>
                    下载 mutool（推荐）：
                    <a
                      href="https://mupdf.com/releases"
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 inline-flex items-center gap-0.5 underline hover:text-amber-700 dark:hover:text-amber-100"
                    >
                      mupdf.com/releases <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                  <li>解压获得 mutool.exe，放到任意目录（例如 C:\tools\mupdf\）</li>
                  <li>
                    将该目录加入系统 PATH，<b>或</b>设置环境变量{" "}
                    <code className="rounded bg-amber-100 px-1 dark:bg-amber-800/40">
                      PDF_RENDERER=C:\tools\mupdf\mutool.exe
                    </code>
                    ，<b>或</b>在「站点设置 → 高级」中填写「PdfRendererPath」
                  </li>
                  <li>重启服务后点击下方刷新按钮</li>
                </ol>
              )}

              {!isWindows && (
                <div>
                  Debian/Ubuntu：
                  <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-800/40">
                    apt install poppler-utils
                  </code>
                  ；Alpine：
                  <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-800/40">
                    apk add poppler-utils
                  </code>
                  ；macOS：
                  <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-800/40">
                    brew install poppler
                  </code>
                  （也可使用 mupdf-tools）
                </div>
              )}

              <div className="text-amber-700/80 dark:text-amber-400/80">
                已检测：
                {Object.entries(status.tools).map(([name, path]) => (
                  <span key={name} className="ml-2 inline-block">
                    {name}:{" "}
                    {path ? (
                      <span className="text-emerald-700 dark:text-emerald-400">✓</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">✗</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-1.5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => refresh()}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white/60 px-2 py-0.5 text-xs hover:bg-white dark:border-amber-700 dark:bg-amber-900/30 dark:hover:bg-amber-900/50"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              重新检测
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
