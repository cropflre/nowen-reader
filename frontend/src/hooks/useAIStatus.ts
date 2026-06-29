import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

// 模块级缓存，避免多个组件重复请求
let cachedStatus: { configured: boolean } | null = null;
let fetchPromise: Promise<void> | null = null;
let listeners: Array<() => void> = [];

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

async function fetchAIStatus() {
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch("/api/ai/status")
    .then((r) => r.json())
    .then((data) => {
      // 支持 Cloud AI 和 Local AI
      const cloudConfigured = data.cloudAI?.configured ?? false;
      const localConfigured = data.localAI?.configured ?? false;
      cachedStatus = { configured: cloudConfigured || localConfigured };
      notifyListeners();
    })
    .catch(() => {
      cachedStatus = { configured: false };
      notifyListeners();
    })
    .finally(() => {
      fetchPromise = null;
    });
  return fetchPromise;
}

/**
 * 全局 AI 状态 hook
 * - aiConfigured: AI 是否已配置且当前用户有权限使用（管理员或 aiEnabled 的用户）
 * - aiSystemConfigured: AI 系统是否已配置（不考虑用户权限，用于管理员显示配置状态）
 * - refreshAIStatus: 手动刷新状态（如设置页保存后调用）
 */
export function useAIStatus() {
  const [configured, setConfigured] = useState(cachedStatus?.configured ?? false);
  const { user } = useAuth();

  useEffect(() => {
    // 注册监听
    const listener = () => {
      setConfigured(cachedStatus?.configured ?? false);
    };
    listeners.push(listener);

    // 首次加载时请求
    if (!cachedStatus) {
      fetchAIStatus();
    } else {
      setConfigured(cachedStatus.configured);
    }

    return () => {
      listeners = listeners.filter((fn) => fn !== listener);
    };
  }, []);

  const refreshAIStatus = () => {
    cachedStatus = null;
    fetchAIStatus();
  };

  // 用户有 AI 权限：管理员天生有权限，或普通用户被授权
  const userHasAIAccess = user?.role === "admin" || user?.aiEnabled === true;

  return {
    // AI 已配置且用户有权限
    aiConfigured: configured && userHasAIAccess,
    // AI 系统配置状态（不考虑用户权限）
    aiSystemConfigured: configured,
    refreshAIStatus,
  };
}
