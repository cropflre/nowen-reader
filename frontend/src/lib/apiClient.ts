/**
 * 统一的 API 请求客户端
 * 封装 fetch，统一处理错误、token注入、请求拦截
 */

type RequestMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface ApiClientOptions {
  method?: RequestMethod;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** 超时时间(ms)，默认 30000 */
  timeout?: number;
}

interface ApiError {
  status: number;
  message: string;
  raw?: unknown;
}

/**
 * 获取存储的认证 token
 */
function getAuthToken(): string | null {
  try {
    return localStorage.getItem("auth_token") || null;
  } catch {
    return null;
  }
}

/**
 * 核心请求函数
 */
async function request<T = unknown>(
  url: string,
  options: ApiClientOptions = {}
): Promise<T> {
  const { method = "GET", body, headers = {}, signal, timeout = 30000 } = options;

  // 构建请求头
  const reqHeaders: Record<string, string> = { ...headers };

  // 自动注入认证 token
  const token = getAuthToken();
  if (token) {
    reqHeaders["Authorization"] = `Bearer ${token}`;
  }

  // 自动设置 Content-Type（非 FormData 时）
  if (body && !(body instanceof FormData)) {
    reqHeaders["Content-Type"] = "application/json";
  }

  // 超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // 合并 signal
  const combinedSignal = signal
    ? AbortSignal.any?.([signal, controller.signal]) || controller.signal
    : controller.signal;

  try {
    const res = await fetch(url, {
      method,
      headers: reqHeaders,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      let errorMessage = `HTTP ${res.status}`;
      try {
        const errorBody = await res.json();
        errorMessage = errorBody.error || errorBody.message || errorMessage;
      } catch {
        // 无法解析 JSON 错误体
      }

      const error: ApiError = {
        status: res.status,
        message: errorMessage,
      };
      throw error;
    }

    // 204 No Content
    if (res.status === 204) {
      return undefined as T;
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);

    // AbortError (timeout)
    if (err instanceof DOMException && err.name === "AbortError") {
      throw {
        status: 0,
        message: `请求超时 (${timeout}ms)`,
      } as ApiError;
    }

    // 已经是 ApiError
    if (typeof err === "object" && err !== null && "status" in err) {
      throw err;
    }

    // 网络错误
    throw {
      status: 0,
      message: err instanceof Error ? err.message : "网络请求失败",
    } as ApiError;
  }
}

// ============================================================
// 便捷方法
// ============================================================

export const apiClient = {
  get: <T = unknown>(url: string, options?: Omit<ApiClientOptions, "method" | "body">) =>
    request<T>(url, { ...options, method: "GET" }),

  post: <T = unknown>(url: string, body?: unknown, options?: Omit<ApiClientOptions, "method" | "body">) =>
    request<T>(url, { ...options, method: "POST", body }),

  put: <T = unknown>(url: string, body?: unknown, options?: Omit<ApiClientOptions, "method" | "body">) =>
    request<T>(url, { ...options, method: "PUT", body }),

  delete: <T = unknown>(url: string, body?: unknown, options?: Omit<ApiClientOptions, "method" | "body">) =>
    request<T>(url, { ...options, method: "DELETE", body }),

  /** 用于文件上传（FormData） */
  upload: <T = unknown>(url: string, formData: FormData, options?: Omit<ApiClientOptions, "method" | "body">) =>
    request<T>(url, { ...options, method: "POST", body: formData, timeout: 120000 }),
};

export type { ApiError, ApiClientOptions };
