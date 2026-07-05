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
