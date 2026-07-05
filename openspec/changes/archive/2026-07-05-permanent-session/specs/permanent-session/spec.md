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
