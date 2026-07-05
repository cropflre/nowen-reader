# Brainstorm Summary

- Change: permanent-session
- Date: 2026-07-05

## Confirmed Technical Approach

修改 `internal/middleware/auth.go` 中 `SessionMaxAge` 常量值从 `30 * 24 * 60 * 60`（30天）改为 `315360000`（10年）。Cookie `Max-Age` 同步变更为 10 年。保留自动续期逻辑（< 7 天时续期到 10 年）。Flutter 客户端零改动。

## Key Trade-offs and Risks

- 自托管场景安全风险可接受（用户完全控制服务器）
- 10 年对 `int` 类型的 `Max-Age` 参数无溢出风险
- 退出登录行为不受影响

## Testing Strategy

- 确认 Flutter App 登录后 Cookie Max-Age 为 10 年
- 确认 App 重启后保持登录
- 确认退出后需重新登录

## Spec Patches

无
