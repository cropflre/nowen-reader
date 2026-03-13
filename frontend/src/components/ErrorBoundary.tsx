import React from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 全局错误边界 — 捕获子组件渲染异常，防止白屏
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="w-full max-w-md text-center">
            {/* 图标 */}
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
              <AlertTriangle className="h-8 w-8 text-red-400" />
            </div>

            {/* 标题 */}
            <h1 className="mb-2 text-xl font-semibold text-foreground">
              页面出现了错误
            </h1>
            <p className="mb-6 text-sm text-muted">
              很抱歉，渲染过程中发生了意外错误。您可以尝试以下操作：
            </p>

            {/* 错误详情 (可折叠) */}
            {this.state.error && (
              <details className="mb-6 rounded-lg border border-border bg-card p-3 text-left">
                <summary className="cursor-pointer text-xs font-medium text-muted">
                  查看错误详情
                </summary>
                <pre className="mt-2 overflow-x-auto text-xs text-red-400/80">
                  {this.state.error.message}
                </pre>
              </details>
            )}

            {/* 操作按钮 */}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleRetry}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              >
                <RefreshCw className="h-4 w-4" />
                重试
              </button>
              <button
                onClick={this.handleGoHome}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card-hover"
              >
                <Home className="h-4 w-4" />
                返回首页
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
