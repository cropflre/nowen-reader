---
comet_change: permanent-session
role: technical-design
canonical_spec: openspec
archived-with: 2026-07-05-permanent-session
status: final
---

# Permanent Session — Technical Design

## Summary

将服务端 Session 有效期从 30 天改为 10 年，实现 Flutter App 永久登录状态的等效效果。

## Change

**文件**: `internal/middleware/auth.go:15`

```go
// 修改前
SessionMaxAge = 30 * 24 * 60 * 60 // 30 days in seconds

// 修改后
SessionMaxAge = 315360000 // 10 years in seconds (315360000 = 10*365*24*60*60)
```

## Impact

| 组件 | 影响 |
|------|------|
| Cookie Max-Age | 同步变为 10 年（由 Gin `SetCookie` 自动使用 `SessionMaxAge`） |
| 自动续期 | 保留；< 7 天时续期到 10 年（由 `middleware.GetCurrentUser` 自动使用 `SessionMaxAge`） |
| Session 清理 | `CleanExpiredSessions` 每 6 小时清理已过期 Session，10 年前的过期记录会被清理，不影响活跃用户 |
| Flutter 客户端 | 零改动；`PersistCookieJar` 已持久化 Cookie 到磁盘 |
| 退出登录 | 不受影响（调用 `DeleteSession` + 清除 Cookie） |
