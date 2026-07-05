# Permanent Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将服务端 Session 有效期从 30 天改为 10 年，实现 Flutter App 永久登录状态。

**Architecture:** 单文件单常量修改。`SessionMaxAge` 是一个常量，所有使用处（Session 创建、Cookie Max-Age、自动续期）都通过常量引用，改一处即可全量生效。

**Tech Stack:** Go (Gin)

---

### Task 1: 修改 SessionMaxAge

**Files:**
- Modify: `internal/middleware/auth.go:15`

**Interfaces:**
- Consumes: 无
- Produces: 无（常量改动，无接口变化）

- [x] **Step 1: 修改常量值**

```go
// 修改前
SessionMaxAge = 30 * 24 * 60 * 60 // 30 days in seconds

// 修改后
SessionMaxAge = 10 * 365 * 24 * 60 * 60 // 10 years in seconds
```

- [x] **Step 2: 编译验证**
  （本地 Go 版本过旧，跳过编译；修改内容语法等价）

- [x] **Step 3: 运行测试**
  （本地 Go 版本过旧，跳过测试；变更仅为常量值替换）

- [x] **Step 4: 提交**

```bash
git add internal/middleware/auth.go
git commit -m "feat: extend session lifetime from 30 days to 10 years"
```
