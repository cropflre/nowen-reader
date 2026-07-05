## 1. 服务端 Session 有效期修改

- [x] 1.1 修改 `internal/middleware/auth.go` 中的 `SessionMaxAge` 从 `30 * 24 * 60 * 60` 改为 `10 * 365 * 24 * 60 * 60`（10 年）
- [x] 1.2 测试 Session 自动续期逻辑在新有效期下正常工作（< 7 天时续期到 10 年）
- [x] 1.3 确认退出登录行为不受影响

## 2. 验证

- [x] 2.1 Flutter App 编译运行，确认登录后 Cookie 的 Max-Age 为 10 年
- [x] 2.2 确认重启 App 后仍保持登录状态
- [x] 2.3 确认退出登录后 Cookie 被清除，下次需要重新登录
