## Why

Flutter App 当前登录状态的有效期为 30 天。自托管用户长时间不打开 App（如出差、旅游）后，需要重新登录，体验不佳。对于自托管场景（用户自己控制服务器），没有第三方攻击面，可以让会话永久有效，除非用户主动退出。

## What Changes

- 修改服务端 Session 过期时间：`SessionMaxAge` 从 30 天（2592000 秒）改为 **100 年**（3153600000 秒）
- 修改 `CleanExpiredSessions` 只清理已明确退出登录的 Session（`ExpiresAt < now()` 的处于活跃状态的 Session 不再被清理），或在 Session 永不过期的情况下删除该定时任务
- Flutter 客户端无需任何改动（`PersistCookieJar` + `FileStorage` 已正确持久化 Cookie）
- 不改变"退出登录"的行为（退出时仍会调用 `DELETE` 删除 Session 记录并清除 Cookie）
- 不影响未登录用户和首次使用流程

## Capabilities

### New Capabilities
- `permanent-session`: 服务端 Session 永不过期（对自托管场景），Flutter App 登录后除非主动退出，否则永久保持登录状态

### Modified Capabilities
- （无现有 spec 变更）

## Impact

- **文件变更**：`internal/middleware/auth.go`（修改 `SessionMaxAge` 常量）
- **API 变更**：无
- **数据库变更**：无（Schema 不变，仅逻辑过期时间变长）
- **依赖变更**：无
