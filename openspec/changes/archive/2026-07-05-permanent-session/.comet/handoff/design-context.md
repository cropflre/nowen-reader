# Comet Design Handoff

- Change: permanent-session
- Phase: design
- Mode: compact
- Context hash: a1057ffb754568b62230a6b97b5351adc7e7789ef898fae57d62468765ddae1b

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/permanent-session/proposal.md

- Source: openspec/changes/permanent-session/proposal.md
- Lines: 1-26
- SHA256: 9c8bf264b258daa5a96cf39ecf549b71c0da4b7d09268b2dc91a86aeaa9e0f66

```md
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
```

## openspec/changes/permanent-session/design.md

- Source: openspec/changes/permanent-session/design.md
- Lines: 1-47
- SHA256: 393a8137d04d891287b60488fcac7fba1af83a31b4c7482a012a84e9fd6c7aac

```md
## Context

当前 Flutter App 依赖服务端 Session Cookie 进行认证。`PersistCookieJar` + `FileStorage` 已经将 Cookie 正确持久化到设备磁盘。限制登录持久性的唯一因素是服务端的 `SessionMaxAge = 30 天`。30 天不访问后，服务端会话过期，Cookie 被清除，用户必须重新登录。

自托管场景下，用户完全控制服务器，不存在第三方 Session 劫持风险。可以让登录状态永不过期。

## Goals / Non-Goals

**Goals:**
- Flutter App 登录后永久保持登录状态，直到用户主动退出
- 服务端 Session 不过期（或等效永久）
- 退出登录行为不变（立即删除 Session + 清除 Cookie）
- Flutter 客户端零改动

**Non-Goals:**
- 不添加"记住我"开关
- 不引入 Token 刷新机制（直接用 Session 永不过期解决）
- 不改变 Web 前端行为

## Decisions

| 决策 | 选择 | 理由 |
|------|------|------|
| SessionMaxAge 值 | **10 年** (100 年因 int MaxAge 限制调整为 10 年) | `SetCookie` 的 `maxAge` 参数为 `int` 秒，315360000 秒 ≈ 10 年，对自托管场景等效永久 |
| 自动续期策略 | **保留现有机制** | 当前 < 7 天续期逻辑能确保活跃用户持续有效；即使退化为 none，10 年也足够 |
| Expired Session 清理 | **保留定时清理**，但逻辑调整为只清理手动退出登录的 | Cookie 被清除后 Session 记录留在 DB 中无意义。当前 `expiresAt < now()` 的清理条件依然有效（只清 10 年前的老记录） |
| Cookie Max-Age | **同步改为 10 年** | 客户端 `PersistCookieJar` 依赖 `Max-Age` 决定是否丢弃 Cookie |

```
修改前:
  SessionMaxAge = 2592000  (30天)
  Cookie Max-Age = 2592000 (30天)
  Session 过期时间 = now + 30天
  自动续期: < 7天时延长到 30天

修改后:
  SessionMaxAge = 315360000  (10年)
  Cookie Max-Age = 315360000 (10年)
  Session 过期时间 = now + 10年
  自动续期: < 7天时延长到 10年（保留）
```

## Risks / Trade-offs

- [低风险] 服务端 DB 中 Session 表记录随用户登录而不清理，但用户量小（自托管），影响可忽略
- [低风险] 10 年代码维护——10 年后这个值是否仍然合理？届时修改即可，不影响已有 Session
- [安全性] 自托管场景下安全风险可接受；如果未来支持公开注册/多租户，可以再引入可配置的 Session TTL
```

## openspec/changes/permanent-session/tasks.md

- Source: openspec/changes/permanent-session/tasks.md
- Lines: 1-11
- SHA256: 5f125010ae315d7e9398e18beadf4e7a14faf12aa53ac5fe0e07f92e1f75fc8a

```md
## 1. 服务端 Session 有效期修改

- [ ] 1.1 修改 `internal/middleware/auth.go` 中的 `SessionMaxAge` 从 `30 * 24 * 60 * 60` 改为 `315360000`（10 年）
- [ ] 1.2 测试 Session 自动续期逻辑在新有效期下正常工作（< 7 天时续期到 10 年）
- [ ] 1.3 确认退出登录行为不受影响

## 2. 验证

- [ ] 2.1 Flutter App 编译运行，确认登录后 Cookie 的 Max-Age 为 10 年
- [ ] 2.2 确认重启 App 后仍保持登录状态
- [ ] 2.3 确认退出登录后 Cookie 被清除，下次需要重新登录
```

## openspec/changes/permanent-session/specs/permanent-session/spec.md

- Source: openspec/changes/permanent-session/specs/permanent-session/spec.md
- Lines: 1-41
- SHA256: 978ec1e251e10e5988ae3e10b302ff1ffd17bb2279dc49f2c24ed49ae791a9ba

```md
## ADDED Requirements

### Requirement: Session 永不过期

系统 SHALL 支持 Flutter App（及任何客户端）登录后永久保持登录状态，除非用户主动退出登录。

服务端创建 Session 时，其 SHALL 设置 `Max-Age` 为 **10 年**（315360000 秒），Cookie 的 `Max-Age` 同步为同一值。

当用户通过 `/auth/me` 请求时，如果 Session 剩余有效期不足 7 天，系统 SHALL 自动将 Session 延长到 10 年。

#### Scenario: 用户登录后关闭 App 再打开

- **WHEN** 用户登录成功（收到 `Set-Cookie: nowen_session`，`Max-Age=315360000`）
- **AND** 用户关闭 App
- **AND** 30 天后重新打开 App
- **THEN** 系统 SHALL 自动发送 Cookie 到 `/auth/me`
- **AND** `/auth/me` SHALL 返回 `user` 对象（非 null），用户无需重新登录

#### Scenario: 用户主动退出登录

- **WHEN** 用户点击"退出登录"
- **THEN** 系统 SHALL 立即删除服务端 Session 记录
- **AND** 系统 SHALL 清除客户端 Cookie
- **AND** 下次启动 App 时，用户 SHALL 被重定向到登录页

#### Scenario: 一年后 Session 仍然有效

- **WHEN** 用户登录
- **AND** 一年后（365 天后）再次打开 App
- **THEN** 系统 SHALL 发送 Cookie 到 `/auth/me`
- **AND** `/auth/me` SHALL 返回 `user` 对象（Session `expiresAt` 为 `登录时间 + 10年`，仍在有效期内）

### Requirement: 退出登录立即失效

用户退出登录时，系统 SHALL 立即删除对应的服务端 Session 记录，并清除 Cookie。旧 Cookie 即使未被客户端清除（极端情况），服务端也不 SHALL 认可该 Session。

#### Scenario: 退出登录后重新使用旧 Cookie

- **WHEN** 用户退出登录（服务端删除 Session 记录）
- **AND** 使用之前保存的旧 Cookie 访问 `/auth/me`
- **THEN** `/auth/me` SHALL 返回 `user: null`（Session 不存在）
```

