# API 文档

NowenReader 提供完整的 RESTful API，所有功能均可通过 API 调用。

> 🔒 = 需要认证（登录用户） &emsp; 🔒管理员 = 需要管理员权限

## 🔐 认证

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| POST | `/api/auth/register` | 注册（限流） |
| POST | `/api/auth/login` | 登录（限流） |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 当前用户信息 |
| GET | `/api/auth/users` | 用户列表 🔒管理员 |
| POST | `/api/auth/users` | 创建用户 🔒管理员 |
| PUT | `/api/auth/users` | 更新用户 🔒管理员 |
| DELETE | `/api/auth/users` | 删除用户 🔒管理员 |

## 📚 漫画

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/comics` | 列表（搜索/筛选/分页/排序/FTS5 全文搜索） |
| GET | `/api/comics/:id` | 详情 |
| PUT | `/api/comics/:id/favorite` | 切换收藏 🔒管理员 |
| PUT | `/api/comics/:id/rating` | 更新评分 🔒管理员 |
| PUT | `/api/comics/:id/progress` | 更新阅读进度 🔒 |
| PUT | `/api/comics/:id/reading-status` | 设置阅读状态 🔒 |
| PUT | `/api/comics/:id/metadata` | 编辑元数据 🔒管理员 |
| DELETE | `/api/comics/:id/delete` | 删除漫画（含磁盘文件） 🔒管理员 |
| POST | `/api/comics/batch` | 批量操作 🔒管理员 |
| POST | `/api/comics/cleanup` | 清理无效条目 🔒管理员 |
| POST | `/api/comics/redetect-types` | 漫画类型重检测 🔒管理员 |
| PUT | `/api/comics/reorder` | 自定义排序 🔒管理员 |
| GET | `/api/comics/duplicates` | 重复检测 |

## 🏷️ 标签 & 分类

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/tags` | 标签列表 |
| PUT | `/api/tags/color` | 更新标签颜色 🔒管理员 |
| PUT | `/api/tags/rename` | 重命名标签 🔒管理员 |
| DELETE | `/api/tags` | 删除标签 🔒管理员 |
| POST | `/api/tags/merge` | 合并标签 🔒管理员 |
| POST | `/api/tags/translate` | 标签翻译 🔒管理员 |
| POST | `/api/comics/:id/tags` | 添加标签 🔒管理员 |
| DELETE | `/api/comics/:id/tags` | 移除标签 🔒管理员 |
| DELETE | `/api/comics/:id/tags/clear-all` | 清除所有标签 🔒管理员 |
| POST | `/api/comics/:id/translate-metadata` | 翻译漫画元数据 🔒管理员 |
| GET | `/api/categories` | 分类列表 |
| POST | `/api/categories` | 初始化分类 🔒管理员 |
| POST | `/api/categories/create` | 创建分类 🔒管理员 |
| PUT | `/api/categories/reorder` | 分类排序 🔒管理员 |
| PUT | `/api/categories/:slug` | 更新分类 🔒管理员 |
| DELETE | `/api/categories/:slug` | 删除分类 🔒管理员 |
| POST | `/api/comics/:id/categories` | 添加分类 🔒管理员 |
| PUT | `/api/comics/:id/categories` | 设置分类 🔒管理员 |
| DELETE | `/api/comics/:id/categories` | 移除分类 🔒管理员 |

## 📁 合并分组

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/groups` | 分组列表 |
| GET | `/api/groups/comic-map` | 漫画-分组映射关系 |
| GET | `/api/groups/:id` | 分组详情 |
| POST | `/api/groups` | 创建分组 🔒管理员 |
| PUT | `/api/groups/:id` | 更新分组 🔒管理员 |
| DELETE | `/api/groups/:id` | 删除分组 🔒管理员 |
| POST | `/api/groups/:id/comics` | 添加漫画到分组 🔒管理员 |
| DELETE | `/api/groups/:id/comics/:comicId` | 从分组移除漫画 🔒管理员 |
| PUT | `/api/groups/:id/reorder` | 分组内漫画排序 🔒管理员 |

### 分组元数据管理 🔒管理员

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| PUT | `/api/groups/:id/metadata` | 更新分组元数据 |
| POST | `/api/groups/:id/inherit-metadata` | 继承元数据到子卷 |
| POST | `/api/groups/:id/preview-inherit` | 预览继承结果 |
| POST | `/api/groups/:id/inherit-to-volumes` | 应用继承到卷 |

### 系列级标签管理 🔒管理员

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/groups/:id/tags` | 获取分组标签 |
| PUT | `/api/groups/:id/tags` | 设置分组标签 |
| POST | `/api/groups/:id/sync-tags` | 同步标签到子卷 |
| POST | `/api/groups/:id/override-tags` | 覆盖标签到子卷 |
| POST | `/api/groups/:id/ai-suggest-tags` | AI 标签建议 |

### 系列级分类管理 🔒管理员

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/groups/:id/categories` | 获取分组分类 |
| PUT | `/api/groups/:id/categories` | 设置分组分类 |
| POST | `/api/groups/:id/sync-categories` | 同步分类到子卷 |
| POST | `/api/groups/:id/ai-suggest-categories` | AI 分类建议 |

### 系列级元数据刮削 & AI 识别 🔒管理员

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| POST | `/api/groups/:id/scrape-metadata` | 刮削元数据 |
| POST | `/api/groups/:id/apply-metadata` | 应用刮削的元数据 |
| POST | `/api/groups/:id/ai-recognize` | AI 识别系列 |

### 批量操作 🔒管理员

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| POST | `/api/groups/auto-group-by-dir` | 按目录自动分组 |
| POST | `/api/groups/auto-detect` | 自动检测可合并分组 |
| POST | `/api/groups/batch-create` | 批量创建分组 |
| POST | `/api/groups/batch-delete` | 批量删除分组 |
| POST | `/api/groups/batch-scrape` | 批量刮削 |
| POST | `/api/groups/merge` | 合并分组 |
| POST | `/api/groups/export` | 导出分组 |
| POST | `/api/groups/detect-dirty` | 检测脏数据 |
| POST | `/api/groups/cleanup` | 清理分组 |
| POST | `/api/groups/fix-name` | 修复名称 |

## 🖼️ 图片 & 内容

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/comics/:id/pages` | 页面列表 |
| GET | `/api/comics/:id/page/:pageIndex` | 页面图片 |
| GET | `/api/comics/:id/thumbnail` | 缩略图 |
| POST | `/api/comics/:id/cover` | 更新封面 🔒管理员 |
| GET | `/api/comics/:id/pdf` | PDF 文件流式传输 |
| GET | `/api/comics/:id/chapter/:chapterIndex` | 小说章节内容 |
| GET | `/api/comics/:id/epub-resource/*resourcePath` | EPUB 资源 |
| GET | `/api/comics/:id/embedded-images` | 嵌入图片列表 |
| GET | `/api/comics/:id/embedded-image/:index` | 单个嵌入图片 |
| POST | `/api/comics/:id/warmup` | 页面预热 |
| POST | `/api/comics/:id/warmup-done` | 预热完成 |
| POST | `/api/thumbnails/manage` | 缩略图管理 🔒管理员 |

## 🌐 元数据

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET/POST | `/api/metadata/search` | 搜索元数据 |
| POST | `/api/metadata/apply` | 应用元数据 |
| POST | `/api/metadata/scan` | 扫描 ComicInfo.xml |
| POST | `/api/metadata/novel-scan` | 扫描小说元数据 |
| POST | `/api/metadata/batch` | 批量获取元数据 |
| POST | `/api/metadata/translate-batch` | 批量翻译元数据 |
| GET | `/api/metadata/stats` | 元数据统计 🔒管理员 |
| POST | `/api/metadata/ai-batch` | AI 批量处理 🔒管理员 |
| GET | `/api/metadata/library` | 库信息 🔒管理员 |
| POST | `/api/metadata/batch-selected` | 批量选择 🔒管理员 |
| POST | `/api/metadata/clear` | 清除元数据 🔒管理员 |
| POST | `/api/metadata/batch-rename` | 批量重命名 🔒管理员 |
| POST | `/api/metadata/ai-rename` | AI 重命名 🔒管理员 |
| POST | `/api/metadata/ai-chat` | AI 对话 🔒管理员 |
| GET | `/api/metadata/folder-tree` | 文件夹树 🔒管理员 |
| POST | `/api/metadata/batch-folder` | 批量文件夹 🔒管理员 |

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
| POST | `/api/comics/:id/ai-infer-title` | AI 推断标题 🔒 |
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
| GET | `/api/stats/folder-tree` | 文件夹树统计 |
| GET | `/api/goals` | 获取目标进度 |
| POST | `/api/goals` | 设定阅读目标 🔒管理员 |
| DELETE | `/api/goals` | 删除阅读目标 🔒管理员 |
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
| POST | `/api/upload` | 文件上传 🔒管理员 |
| POST | `/api/cache` | 缓存管理 🔒管理员 |
| POST | `/api/sync` | 触发文件同步 🔒管理员 |
| GET | `/api/browse-dirs` | 浏览服务器目录 🔒管理员 |
| GET | `/api/logs` | 错误日志 🔒管理员 |
| GET | `/api/logs/stats` | 日志统计 🔒管理员 |
| GET | `/api/logs/export` | 导出日志 🔒管理员 |
| DELETE | `/api/logs` | 清理日志 🔒管理员 |

## 🎨 站点设置

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/site-settings/icon` | 获取站点图标 |
| POST | `/api/site-settings/icon` | 上传站点图标 🔒管理员 |
| DELETE | `/api/site-settings/icon` | 删除站点图标 🔒管理员 |

## 📋 扫描规则 🔒管理员

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/scan-rules` | 获取扫描规则 |
| PUT | `/api/scan-rules` | 更新扫描规则 |
| POST | `/api/scan-rules/apply` | 应用规则 |
| POST | `/api/scan-rules/preview` | 预览规则效果 |
| POST | `/api/scan-rules/restore-titles` | 恢复原标题 |
| GET | `/api/scan-rules/logs` | 规则应用日志 |
| GET | `/api/scan-rules/progress` | 应用进度 |

## 💾 存储管理 🔒管理员

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/admin/storage` | 存储概览 |
| GET | `/api/admin/storage/database` | 数据库信息 |
| GET | `/api/admin/storage/history` | 历史记录 |
| POST | `/api/admin/storage/cache/clear` | 清除缓存 |
| POST | `/api/admin/storage/db/checkpoint` | 数据库检查点 |
| POST | `/api/admin/storage/db/analyze` | 数据库分析 |
| POST | `/api/admin/storage/db/vacuum` | 数据库清理 |
| POST | `/api/admin/storage/db/integrity` | 数据库完整性检查 |
| PUT | `/api/admin/storage/threshold` | 更新阈值 |

## 🌍 翻译引擎

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/translate/engines` | 翻译引擎列表 |
| GET | `/api/translate/config` | 翻译配置 |
| GET | `/api/translate/health` | 引擎健康检查 |
| GET | `/api/translate/cache/stats` | 缓存统计 |
| PUT | `/api/translate/config` | 更新翻译配置 🔒管理员 |
| DELETE | `/api/translate/cache` | 清除翻译缓存 🔒管理员 |
| POST | `/api/translate/test` | 测试翻译引擎 🔒管理员 |

## 🔄 元数据同步 🔒管理员

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/sync/status` | 同步状态 |
| GET | `/api/sync/history` | 同步历史 |
| GET | `/api/sync/diff/:id` | 差异对比 |
| POST | `/api/sync/push` | 推送同步 |
| POST | `/api/sync/revert` | 回滚同步 |

## ⚙️ 系统

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/system/pdf-renderer` | PDF 渲染器状态 |
