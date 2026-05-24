# API 文档

NowenReader 提供完整的 RESTful API，所有功能均可通过 API 调用。

> 🔒 = 需要认证 &emsp; 🔒管理员 = 需要管理员权限

## 🔐 认证

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| POST | `/api/auth/register` | 注册（限流） |
| POST | `/api/auth/login` | 登录（限流） |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 当前用户信息 |
| GET | `/api/auth/users` | 用户列表 🔒管理员 |
| PUT | `/api/auth/users` | 更新用户 🔒管理员 |
| DELETE | `/api/auth/users` | 删除用户 🔒管理员 |

## 📚 漫画

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/comics` | 列表（搜索/筛选/分页/排序/FTS5 全文搜索） |
| GET | `/api/comics/:id` | 详情 |
| PUT | `/api/comics/:id/favorite` | 切换收藏 🔒 |
| PUT | `/api/comics/:id/rating` | 更新评分 🔒 |
| PUT | `/api/comics/:id/progress` | 更新阅读进度 🔒 |
| PUT | `/api/comics/:id/reading-status` | 设置阅读状态 🔒 |
| PUT | `/api/comics/:id/metadata` | 编辑元数据 🔒 |
| DELETE | `/api/comics/:id/delete` | 删除漫画（含磁盘文件） 🔒 |
| POST | `/api/comics/batch` | 批量操作 🔒 |
| POST | `/api/comics/cleanup` | 清理无效条目 🔒 |
| PUT | `/api/comics/reorder` | 自定义排序 🔒 |
| GET | `/api/comics/duplicates` | 重复检测 |

## 🏷️ 标签 & 分类

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/tags` | 标签列表 |
| PUT | `/api/tags/color` | 更新标签颜色 |
| POST | `/api/tags/translate` | 标签翻译 |
| POST | `/api/comics/:id/tags` | 添加标签 🔒 |
| DELETE | `/api/comics/:id/tags` | 移除标签 🔒 |
| POST | `/api/comics/:id/translate-metadata` | 翻译漫画元数据 🔒 |
| GET | `/api/categories` | 分类列表 |
| POST | `/api/categories` | 初始化分类 |
| POST | `/api/comics/:id/categories` | 添加分类 🔒 |
| PUT | `/api/comics/:id/categories` | 设置分类 🔒 |
| DELETE | `/api/comics/:id/categories` | 移除分类 🔒 |

## 📁 合并分组

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/groups` | 分组列表 |
| GET | `/api/groups/comic-map` | 漫画-分组映射关系 |
| GET | `/api/groups/:id` | 分组详情 |
| POST | `/api/groups` | 创建分组 🔒 |
| PUT | `/api/groups/:id` | 更新分组 🔒 |
| DELETE | `/api/groups/:id` | 删除分组 🔒 |
| POST | `/api/groups/:id/comics` | 添加漫画到分组 🔒 |
| DELETE | `/api/groups/:id/comics/:comicId` | 从分组移除漫画 🔒 |
| PUT | `/api/groups/:id/reorder` | 分组内漫画排序 🔒 |
| POST | `/api/groups/auto-detect` | 自动检测可合并分组 🔒 |
| POST | `/api/groups/batch-create` | 批量创建分组 🔒 |

## 🖼️ 图片 & 内容

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/comics/:id/pages` | 页面列表 |
| GET | `/api/comics/:id/page/:pageIndex` | 页面图片 |
| GET | `/api/comics/:id/thumbnail` | 缩略图 |
| POST | `/api/comics/:id/cover` | 更新封面 🔒 |
| GET | `/api/comics/:id/pdf` | PDF 文件流式传输 |
| GET | `/api/comics/:id/chapter/:chapterIndex` | 小说章节内容 |
| GET | `/api/comics/:id/epub-resource/*resourcePath` | EPUB 资源 |
| POST | `/api/thumbnails/manage` | 缩略图管理 🔒 |

## 🌐 元数据

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET/POST | `/api/metadata/search` | 搜索元数据 |
| POST | `/api/metadata/apply` | 应用元数据 |
| POST | `/api/metadata/scan` | 扫描 ComicInfo.xml |
| POST | `/api/metadata/novel-scan` | 扫描小说元数据 |
| POST | `/api/metadata/batch` | 批量获取元数据 |
| POST | `/api/metadata/translate-batch` | 批量翻译元数据 |

## 🤖 AI

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/ai/status` | AI 服务状态 |
| GET/PUT | `/api/ai/settings` | AI 设置 |
| GET | `/api/ai/models` | 可用模型列表 |
| POST | `/api/ai/test` | 测试 AI 连接 |
| GET/DELETE | `/api/ai/usage` | AI 用量统计 |
| GET/PUT/DELETE | `/api/ai/prompts` | 提示词模板 |
| POST | `/api/ai/chat` | AI 对话 |
| POST | `/api/ai/semantic-search` | 语义搜索 |
| POST | `/api/ai/reading-insight` | 阅读洞察报告 |
| POST | `/api/ai/batch-suggest-tags` | 批量标签建议 |
| POST | `/api/ai/suggest-category` | 分类建议 |
| POST | `/api/ai/batch-suggest-category` | 批量分类建议 |
| POST | `/api/ai/enhance-group-detect` | AI 增强分组检测 |
| POST | `/api/ai/verify-duplicates` | AI 重复验证 |
| POST | `/api/ai/recommend-goal` | AI 推荐阅读目标 |

### AI 漫画级功能

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| POST | `/api/comics/:id/ai-summary` | 生成摘要 🔒 |
| POST | `/api/comics/:id/ai-parse-filename` | 解析文件名 🔒 |
| POST | `/api/comics/:id/ai-suggest-tags` | 标签建议 🔒 |
| POST | `/api/comics/:id/ai-analyze-cover` | 封面分析 🔒 |
| POST | `/api/comics/:id/ai-complete-metadata` | 完善元数据 🔒 |
| POST | `/api/comics/:id/ai-chapter-recap` | 章节回顾 🔒 |
| POST | `/api/comics/:id/ai-chapter-summary` | 章节摘要 🔒 |
| POST | `/api/comics/:id/ai-chapter-summaries` | 批量章节摘要 🔒 |
| POST | `/api/comics/:id/ai-translate-page` | 页面翻译 🔒 |

## 📊 阅读统计 & 目标 & 导出

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/stats` | 阅读统计 |
| GET | `/api/stats/yearly` | 年度阅读报告 |
| POST | `/api/stats/session` | 开始阅读会话 |
| PUT | `/api/stats/session` | 结束阅读会话 |
| POST | `/api/stats/session/end` | 结束会话（sendBeacon 兜底） |
| GET | `/api/stats/enhanced` | 增强统计数据 |
| GET | `/api/stats/files` | 文件统计 |
| GET | `/api/goals` | 获取目标进度 |
| POST | `/api/goals` | 设定阅读目标 🔒 |
| DELETE | `/api/goals` | 删除阅读目标 🔒 |
| GET | `/api/export/json` | JSON 全量导出 |
| GET | `/api/export/csv/sessions` | CSV 会话导出 |
| GET | `/api/export/csv/comics` | CSV 漫画列表导出 |

## 📡 OPDS & 推荐 & 其他

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/opds` | OPDS 根目录 |
| GET | `/api/opds/all` | 全部漫画 |
| GET | `/api/opds/recent` | 最近更新 |
| GET | `/api/opds/favorites` | 收藏列表 |
| GET | `/api/opds/search` | OPDS 搜索 |
| GET | `/api/opds/download/:id` | 下载原始文件 |
| GET | `/api/recommendations` | 个性化推荐 |
| GET | `/api/recommendations/similar/:id` | 相似推荐 |
| POST | `/api/recommendations/ai-reasons` | AI 推荐理由 |
| GET | `/api/health` | 健康检查 |
| GET/PUT | `/api/site-settings` | 站点设置 |
| POST | `/api/upload` | 文件上传 🔒 |
| POST | `/api/cache` | 缓存管理 🔒 |
| POST | `/api/sync` | 触发文件同步 🔒 |
| GET | `/api/browse-dirs` | 浏览服务器目录 🔒 |
| GET | `/api/logs` | 错误日志 🔒管理员 |
| GET | `/api/logs/stats` | 日志统计 🔒管理员 |
| GET | `/api/logs/export` | 导出日志 🔒管理员 |
| DELETE | `/api/logs` | 清理日志 🔒管理员 |
