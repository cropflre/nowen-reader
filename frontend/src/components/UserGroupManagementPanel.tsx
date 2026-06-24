"use client";

import { useState, useEffect, useCallback } from "react";

import {
  UserGroup,
  fetchUserGroups,
  createUserGroup,
  updateUserGroup,
  deleteUserGroup,
  fetchGroupMembers,
  setGroupMembers,
  fetchGroupLibraryAccess,
  setGroupLibraryAccess,
  GroupMember,
} from "@/api/userGroups";
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  BookOpen,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

export default function UserGroupManagementPanel() {

  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [members, setMembers] = useState<
    Array<GroupMember & { isMember: boolean }>
  >([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [libraries, setLibraries] = useState<
    Array<{ id: string; name: string; canView: boolean }>
  >([]);
  const [loadingLibs, setLoadingLibs] = useState(false);
  const [activeTab, setActiveTab] = useState<"members" | "libraries">(
    "members"
  );

  const loadGroups = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchUserGroups();
      setGroups(data);
    } catch (err) {
      console.error("Failed to load user groups:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createUserGroup({ name: newName.trim(), description: newDesc });
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
      loadGroups();
    } catch (err) {
      console.error("Failed to create group:", err);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await updateUserGroup(id, {
        name: editName.trim(),
        description: editDesc,
      });
      setEditingId(null);
      loadGroups();
    } catch (err) {
      console.error("Failed to update group:", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此用户组？"))
      return;
    try {
      await deleteUserGroup(id);
      if (expandedId === id) setExpandedId(null);
      loadGroups();
    } catch (err) {
      console.error("Failed to delete group:", err);
    }
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setActiveTab("members");
    loadMembersAndLibs(id);
  };

  const loadMembersAndLibs = async (groupId: string) => {
    setLoadingMembers(true);
    setLoadingLibs(true);
    try {
      const [membersData, libsData] = await Promise.all([
        fetchGroupMembers(groupId),
        fetchGroupLibraryAccess(groupId),
      ]);
      setMembers(membersData.users || []);
      setLibraries(libsData.libraries || []);
    } catch (err) {
      console.error("Failed to load group details:", err);
    } finally {
      setLoadingMembers(false);
      setLoadingLibs(false);
    }
  };

  const handleToggleMember = async (
    groupId: string,
    userId: string,
    isMember: boolean
  ) => {
    const newIds = isMember
      ? members.filter((m) => m.isMember || m.id === userId).map((m) => m.id)
      : members.filter((m) => m.isMember && m.id !== userId).map((m) => m.id);
    // Ensure unique
    const uniqueIds = [...new Set(newIds)];
    try {
      await setGroupMembers(groupId, uniqueIds);
      // Reload
      const data = await fetchGroupMembers(groupId);
      setMembers(data.users || []);
    } catch (err) {
      console.error("Failed to toggle member:", err);
    }
  };

  const handleToggleLibrary = async (
    groupId: string,
    libraryId: string,
    canView: boolean
  ) => {
    const newIds = canView
      ? libraries.filter((l) => l.canView || l.id === libraryId).map((l) => l.id)
      : libraries
          .filter((l) => l.canView && l.id !== libraryId)
          .map((l) => l.id);
    const uniqueIds = [...new Set(newIds)];
    try {
      await setGroupLibraryAccess(groupId, uniqueIds);
      const data = await fetchGroupLibraryAccess(groupId);
      setLibraries(data.libraries || []);
    } catch (err) {
      console.error("Failed to toggle library access:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted">{"加载中..."}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-accent" />
          <h3 className="text-lg font-medium text-foreground">
            {"用户组管理"}
          </h3>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          {"新建用户组"}
        </button>
      </div>

      <p className="text-sm text-muted">
        {"通过用户组批量管理用户对书库的访问权限。将用户加入组后，组的书库权限会自动继承给组内所有用户。"}
      </p>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
          <input
            type="text"
            placeholder={"用户组名称"}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded bg-card border border-border px-3 py-2 text-sm text-foreground placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <input
            type="text"
            placeholder={
              "描述（可选）"
            }
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="w-full rounded bg-card border border-border px-3 py-2 text-sm text-foreground placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
            >
              <Save className="h-3.5 w-3.5" />
              {"保存"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded bg-card-hover px-3 py-1.5 text-sm text-muted hover:text-foreground"
            >
              {"取消"}
            </button>
          </div>
        </div>
      )}

      {/* Group list */}
      {groups.length === 0 ? (
        <div className="text-center py-8 text-muted">
          {"暂无用户组，点击上方按钮创建"}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <div
              key={group.id}
              className="rounded-lg border border-border bg-card/50 overflow-hidden"
            >
              {/* Group header */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <button
                    onClick={() => toggleExpand(group.id)}
                    className="text-muted hover:text-foreground flex-shrink-0"
                  >
                    {expandedId === group.id ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  {editingId === group.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="rounded bg-card border border-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent w-40"
                      />
                      <input
                        type="text"
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        placeholder={
                          "描述"
                        }
                        className="rounded bg-card border border-border px-2 py-1 text-sm text-foreground placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent flex-1"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-foreground truncate">
                        {group.name}
                      </span>
                      {group.description && (
                        <span className="text-xs text-muted truncate hidden sm:inline">
                          {group.description}
                        </span>
                      )}
                      <span className="text-xs text-muted/70 flex-shrink-0">
                        ({group.memberCount || 0}{" "}
                        {"成员"})
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {editingId === group.id ? (
                    <>
                      <button
                        onClick={() => handleUpdate(group.id)}
                        className="p-1.5 text-emerald-500 hover:text-emerald-400"
                      >
                        <Save className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="p-1.5 text-muted hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditingId(group.id);
                          setEditName(group.name);
                          setEditDesc(group.description);
                        }}
                        className="p-1.5 text-muted hover:text-foreground"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(group.id)}
                        className="p-1.5 text-muted hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Expanded content */}
              {expandedId === group.id && (
                <div className="border-t border-border p-3">
                  {/* Tabs */}
                  <div className="flex gap-4 mb-3 border-b border-border">
                    <button
                      onClick={() => setActiveTab("members")}
                      className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === "members"
                          ? "border-accent text-accent"
                          : "border-transparent text-muted hover:text-foreground"
                      }`}
                    >
                      <Users className="inline h-3.5 w-3.5 mr-1" />
                      {"成员管理"}
                    </button>
                    <button
                      onClick={() => setActiveTab("libraries")}
                      className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === "libraries"
                          ? "border-accent text-accent"
                          : "border-transparent text-muted hover:text-foreground"
                      }`}
                    >
                      <BookOpen className="inline h-3.5 w-3.5 mr-1" />
                      {"书库权限"}
                    </button>
                  </div>

                  {/* Members tab */}
                  {activeTab === "members" && (
                    <div>
                      {loadingMembers ? (
                        <div className="text-sm text-muted py-2">
                          {"加载中..."}
                        </div>
                      ) : members.length === 0 ? (
                        <div className="text-sm text-muted py-2">
                          {"暂无用户"}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {members.map((user) => (
                            <label
                              key={user.id}
                              className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-card-hover cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={user.isMember}
                                onChange={() =>
                                  handleToggleMember(
                                    group.id,
                                    user.id,
                                    !user.isMember
                                  )
                                }
                                className="rounded border-border text-accent focus:ring-accent"
                              />
                              <span className="text-sm text-foreground">
                                {user.nickname || user.username}
                              </span>
                              <span className="text-xs text-muted">
                                @{user.username}
                              </span>
                              {user.role === "admin" && (
                                <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                  admin
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Libraries tab */}
                  {activeTab === "libraries" && (
                    <div>
                      {loadingLibs ? (
                        <div className="text-sm text-muted py-2">
                          {"加载中..."}
                        </div>
                      ) : libraries.length === 0 ? (
                        <div className="text-sm text-muted py-2">
                          {"暂无书库"}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {libraries.map((lib) => (
                            <label
                              key={lib.id}
                              className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-card-hover cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={lib.canView}
                                onChange={() =>
                                  handleToggleLibrary(
                                    group.id,
                                    lib.id,
                                    !lib.canView
                                  )
                                }
                                className="rounded border-border text-accent focus:ring-accent"
                              />
                              <BookOpen className="h-3.5 w-3.5 text-muted" />
                              <span className="text-sm text-foreground">
                                {lib.name}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
