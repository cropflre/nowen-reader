/**
 * 用户组管理 API
 * 对应后端 /api/admin/user-groups/*
 */

// ============================================================
// 类型定义
// ============================================================

export interface UserGroup {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  memberCount?: number;
}

export interface GroupMember {
  id: string;
  username: string;
  nickname: string;
  role: string;
  aiEnabled: boolean;
}

export interface GroupLibraryAccess {
  libraryId: string;
  canView: boolean;
}

// ============================================================
// API 函数
// ============================================================

async function safeJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// 获取所有用户组
export async function fetchUserGroups(): Promise<UserGroup[]> {
  const res = await fetch("/api/admin/user-groups");
  const data = await safeJson<{ groups: UserGroup[] }>(res);
  return data.groups || [];
}

// 创建用户组
export async function createUserGroup(group: {
  name: string;
  description?: string;
}): Promise<UserGroup> {
  const res = await fetch("/api/admin/user-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(group),
  });
  const data = await safeJson<{ group: UserGroup }>(res);
  return data.group;
}

// 更新用户组
export async function updateUserGroup(
  id: string,
  updates: Partial<{ name: string; description: string }>
): Promise<UserGroup> {
  const res = await fetch(`/api/admin/user-groups/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  const data = await safeJson<{ group: UserGroup }>(res);
  return data.group;
}

// 删除用户组
export async function deleteUserGroup(id: string): Promise<void> {
  const res = await fetch(`/api/admin/user-groups/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

// 获取用户组成员
export async function fetchGroupMembers(groupId: string): Promise<{
  groupId: string;
  members: GroupMember[];
  users: Array<GroupMember & { isMember: boolean }>;
}> {
  const res = await fetch(`/api/admin/user-groups/${groupId}/members`);
  return safeJson(res);
}

// 设置用户组成员
export async function setGroupMembers(
  groupId: string,
  userIds: string[]
): Promise<void> {
  const res = await fetch(`/api/admin/user-groups/${groupId}/members`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

// 获取用户组书库权限
export async function fetchGroupLibraryAccess(groupId: string): Promise<{
  groupId: string;
  libraries: Array<{
    id: string;
    name: string;
    type: string;
    rootPath: string;
    rootPaths?: string[];
    canView: boolean;
  }>;
}> {
  const res = await fetch(`/api/admin/user-groups/${groupId}/library-access`);
  return safeJson(res);
}

// 设置用户组书库权限
export async function setGroupLibraryAccess(
  groupId: string,
  libraryIds: string[]
): Promise<void> {
  const res = await fetch(`/api/admin/user-groups/${groupId}/library-access`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ libraryIds }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}
