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
| GET | `/api/auth/api-keys` | 当前用户的 API Key 列表 🔒浏览器会话 |
| POST | `/api/auth/api-keys` | 创建 API Key 🔒浏览器会话 |
| DELETE | `/api/auth/api-keys/:id` | 撤销一个 API Key 🔒浏览器会话 |
| DELETE | `/api/auth/api-keys` | 撤销当前用户全部 API Key 🔒浏览器会话 |
| GET | `/api/admin/users/:id/api-keys` | 查看指定用户的 API Key 元数据 🔒管理员浏览器会话 |
| DELETE | `/api/admin/users/:id/api-keys` | 撤销指定用户全部 API Key 🔒管理员浏览器会话 |

### API Key 认证

除登录、注册等公开接口外，需要认证的接口支持浏览器 Session Cookie 或 API Key。API Key 通过请求头发送：

```http
Authorization: Bearer nwr_<key-id>_<secret>
```

- API Key 绑定到创建它的用户，不单独保存角色、用户组或书库权限。
- 每次请求都使用用户当前的角色与 `canView`、`canDownload`、`canManage` 权限；管理员 Key 拥有该管理员当时的完整权限。
- 用户权限、用户组、角色或书库授权发生变化后，已有 Key 会立即按新权限生效。
- 请求只要携带 `Authorization` 头，就优先按 Bearer Key 认证；Key 错误、过期或已撤销时返回 `401`，不会退回 Cookie。
- 不支持通过 URL 查询参数传递 API Key。
- API Key 管理接口仅接受浏览器 Session Cookie。API Key 本身不能查看、创建或撤销 Key。
- 服务端仅保存 Key 的 SHA-256 摘要；完整 Key 只在创建成功的响应中返回一次。
- 删除用户时会同时删除该用户的全部 API Key。修改密码不会自动撤销 Key，可使用全部撤销接口主动失效。

#### 创建 API Key

```http
POST /api/auth/api-keys
Content-Type: application/json

{
  "name": "家庭自动化",
  "currentPassword": "当前账户密码",
  "expiresInDays": 365
}
```

`name` 为 1-64 个字符。`expiresInDays` 省略时默认 365 天，传 `0` 表示永不过期，最大为 3650 天。创建成功返回 `201`：

```json
{
  "apiKey": {
    "id": "uuid",
    "userId": "uuid",
    "name": "家庭自动化",
    "keyPrefix": "nwr_12345678...",
    "expiresAt": "2027-07-14T00:00:00Z",
    "lastUsedAt": null,
    "revokedAt": null,
    "createdAt": "2026-07-14T00:00:00Z"
  },
  "key": "nwr_<key-id>_<secret>"
}
```

列表接口只返回 `apiKey` 元数据，不会再次返回完整 `key` 或摘要。单个撤销成功返回 `204`。

撤销当前用户全部 Key 需要再次验证密码：

```http
DELETE /api/auth/api-keys
Content-Type: application/json

{"currentPassword": "当前账户密码"}
```

管理员接口只能查看指定用户的 Key 元数据或全部撤销，不能替其他用户创建 Key。

## 📚 漫画

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/comics` | 列表（按用户可访问书库过滤，搜索/筛选/分页/排序/FTS5 全文搜索）🔒 |
| GET | `/api/comics/:id` | 详情（无权限返回 403）🔒 |
| PUT | `/api/comics/:id/favorite` | 切换收藏 🔒 |
| PUT | `/api/comics/:id/rating` | 更新评分 🔒 |
| PUT | `/api/comics/:id/progress` | 更新阅读进度 🔒 |
| PUT | `/api/comics/:id/reading-status` | 设置阅读状态 🔒 |
| PUT | `/api/comics/:id/metadata` | 编辑元数据 🔒管理员 |
| DELETE | `/api/comics/:id/delete` | 删除漫画（含磁盘文件） 🔒管理员 |
| POST | `/api/comics/batch` | 批量操作 🔒管理员 |
| POST | `/api/comics/cleanup` | 清理无效条目 🔒管理员 |
| POST | `/api/comics/redetect-types` | 漫画类型重检测 🔒管理员 |
| PUT | `/api/comics/reorder` | 自定义排序 🔒管理员 |
| GET | `/api/comics/duplicates` | 重复检测 |


### 漫画列表查询

```
GET /api/comics?libraryIds=lib-a,lib-b&contentType=comic&page=1&pageSize=24
Authorization: Bearer <token>
```

| 查询参数 | 类型 | 必填 | 说明 |
|:---|:---|:---:|:---|
| `search` | string | 否 | 按标题/文件名全文搜索 |
| `tags` | string | 否 | 逗号分隔的标签名，匹配任意标签 |
| `favorites` | string | 否 | `true` 时仅返回当前用户收藏 |
| `sortBy` | string | 否 | 排序字段，默认 `title`；标题排序使用中文拼音 + 数字自然排序键 |
| `sortOrder` | string | 否 | `asc` / `desc`，默认 `asc` |
| `category` | string | 否 | 分类 slug；`uncategorized` 表示无分类 |
| `contentType` | string | 否 | `comic` / `novel` |
| `readingStatus` | string | 否 | `want` / `reading` / `finished` / `shelved` |
| `libraryIds` | string | 否 | 逗号分隔的书库 ID。管理员按传入书库过滤；普通用户会与自身可访问书库取交集，不会越权 |
| `excludeGrouped` | string | 否 | `true` 时排除已加入分组的作品 |
| `uncategorized` | string | 否 | `true` 时仅返回无分类作品 |
| `untagged` | string | 否 | `true` 时仅返回无标签作品 |
| `page` | int | 否 | 页码，默认 `0` |
| `pageSize` | int | 否 | 每页数量，默认 `0`（不分页） |

- 需要登录。
- 普通用户即使不传 `libraryIds`，也只返回自己可访问书库中的作品。
- 普通用户传入无权限书库 ID 时会被过滤掉；交集为空时返回空列表。
- 没有任何书库访问权限的普通用户返回空列表，不会退化成全库查询。
- `sortBy=title` 时会按服务端维护的 `titleSortKey` 排序，效果上 `第2卷` 在 `第10卷` 前，常见中文标题按拼音顺序排列。

### 设置阅读状态

```
PUT /api/comics/:id/reading-status
Authorization: Bearer <token>

{
  "status": "want" | "reading" | "finished" | "shelved" | ""
}
```

- 需要登录（任何角色）
- 需要对该漫画有访问权限（书库权限校验）
- 状态保存到当前用户的 UserComicState，不更新全局 Comic 表
- 多用户之间阅读状态互不影响
- 空字符串 `""` 表示清除状态
- 第一版前端不暴露 `shelved` 状态

### 按阅读状态筛选列表

```
GET /api/comics?readingStatus=want
GET /api/comics?readingStatus=reading
GET /api/comics?readingStatus=finished
```

- 按当前用户的 UserComicState.readingStatus 过滤
- 与 search、tags、category、contentType、favorites 等条件可自由组合
- 不传该参数时不按阅读状态过滤

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
| GET | `/api/groups` | 分组列表（支持 contentType/category/tags/favoritesOnly/libraryIds 过滤）🔒 |
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
| POST | `/api/upload` | 文件上传 🔒（管理员或目标书库 canManage） |

### `POST /api/upload`

- **认证**: 登录用户。管理员可上传到任意启用书库；普通用户必须传 `libraryId` 且对该书库拥有 `canManage` 权限。
- **Content-Type**: `multipart/form-data`

#### 参数

| 参数 | 类型 | 必填 | 说明 |
|:---|:---|:---:|:---|
| `files` | File[] | 必填 | 上传文件列表（表单字段名必须为 `files`） |
| `category` | string | 可选 | `comic` 或 `novel`，帮助后端判断歧义扩展名（如 `.azw3`） |
| `libraryId` | string | 普通用户必填 | 目标书库 ID；普通用户必须拥有该书库 `canManage` 权限。不传时仅管理员可使用旧目录逻辑 |

#### 行为

**传入 `libraryId` 时**：

1. 查询目标 Library，校验存在、`enabled=true`、`rootPath` 非空
2. 文件写入 `Library.rootPath`
3. 按 `Library.type` 校验文件格式：
   - `comic`：仅允许归档类（`.zip` `.cbz` `.rar` `.cbr` `.7z` 等）
   - `novel`：仅允许电子书（`.txt` `.epub` `.mobi` `.azw3` `.html` `.htm` `.pdf`）
   - `mixed`：允许全部支持格式

**不传 `libraryId` 时**：

- 仅管理员可用，完全兼容旧逻辑
- 漫画文件写入 `comicsDir`，小说文件写入 `novelsDir`
- 根据 `category` 和文件扩展名自动判断目标目录

**上传成功后**：

- 接口只负责文件落盘，**不直接写入数据库**
- 不直接触发扫描
- 入库依赖现有 `POST /api/sync` 扫描流程（上传成功后通常自动触发）

#### 错误响应

| HTTP 状态码 | 场景 |
|:---:|:---|
| 400 | 没有上传文件 / `libraryId` 不存在 / Library 已禁用 / Library rootPath 为空 |
| 401/403 | 未登录 / 普通用户未传 `libraryId` / 对目标书库无 `canManage` 权限 |
| 200（单文件级别） | 文件已存在 / 不支持的格式 / 文件类型与书库类型不匹配（按单文件报告在 `results` 中） |

#### 响应示例

**全部成功**：

```json
{
  "message": "Successfully uploaded 2 file(s)",
  "results": [
    { "filename": "vol01.zip", "success": true },
    { "filename": "vol02.zip", "success": true }
  ],
  "successCount": 2,
  "totalCount": 2,
  "libraryId": "abc123"
}
```

**部分失败**：

```json
{
  "message": "Uploaded 1 of 2 file(s), 1 failed",
  "results": [
    { "filename": "vol01.zip", "success": true },
    { "filename": "notes.txt", "success": false, "error": "File type not allowed for comic library" }
  ],
  "successCount": 1,
  "totalCount": 2,
  "libraryId": "abc123"
}
```

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

## 📖 书库管理 🔒管理员

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/admin/libraries` | 获取所有书库列表 |
| POST | `/api/admin/libraries` | 创建书库 |
| PUT | `/api/admin/libraries/:id` | 更新书库 |
| DELETE | `/api/admin/libraries/:id` | 删除书库 |
| POST | `/api/admin/libraries/:id/scan` | 扫描指定书库 |
| GET | `/api/admin/libraries/ownership-preview` | 预览目录归属与重复记录 |
| POST | `/api/admin/libraries/ownership-reconcile` | 合并重复记录并修复书库归属 |
| POST | `/api/admin/libraries/:id/delete-preview` | 删除书库预览（不删除源文件） |
| GET | `/api/libraries/accessible` | 获取当前用户可访问书库 🔒 |
| POST | `/api/libraries/:id/scan` | 扫描当前用户可管理的书库 🔒（需要 canManage） |
| GET | `/api/admin/users/:id/library-access` | 获取用户书库访问权限 |
| PUT | `/api/admin/users/:id/library-access` | 设置用户书库访问权限 |
| GET | `/api/admin/user-groups/:id/library-access` | 获取权限组书库访问权限 |
| PUT | `/api/admin/user-groups/:id/library-access` | 设置权限组书库访问权限 |

> 普通用户只能访问被授权的书库。列表接口按用户可访问书库自动过滤，详情/图片/PDF/章节/OPDS 等资源接口无权限返回 403。

### 书库字段

书库对象包含多目录和权限相关字段：

```json
{
  "id": "string",
  "name": "string",
  "type": "comic|novel|mixed",
  "rootPath": "string",
  "rootPaths": ["string"],
  "enabled": true,
  "sortOrder": 0,
  "defaultAccess": "public|private",
  "scanEnabled": true,
  "lastScanAt": null,
  "lastScanAdded": 0,
  "lastScanTotal": 0,
  "comicCount": 0
}
```

- `rootPath` 是主目录；`rootPaths` 包含主目录和额外目录。
- 文件解析按漫画记录的 `libraryId + relativePath` 在该书库所有根目录内查找，不再按全局文件名唯一定位。
- 书库内通过 `libraryId + relativePath` 去重，不同书库允许相同文件名。
- 不同书库不能配置完全相同的物理根目录；创建或更新时返回 `409 Conflict` 和 `conflicts` 数组。
- 父子根目录可以共存，文件归属于匹配路径最深的书库；父书库扫描时自动跳过子书库目录。
- 禁用或关闭自动扫描的子书库仍保留目录所有权，防止内容被父书库以不同权限重新收录。

### 书库归属巡检与修复

```http
GET /api/admin/libraries/ownership-preview
```

仅按真实物理路径检查，不会将不同目录中的同名文件或相同 MD5 文件误判为同一条记录。响应包括完全相同的根目录冲突，以及需要移动或合并的记录：

```json
{
  "issueCount": 1,
  "duplicateRows": 1,
  "canReconcile": true,
  "rootConflicts": [],
  "issues": [
    {
      "physicalPath": "/books/novels/book.epub",
      "targetLibraryId": "novels",
      "targetLibraryName": "小说",
      "targetRelativePath": "book.epub",
      "targetId": "string",
      "action": "merge",
      "resolvable": true,
      "records": []
    }
  ]
}
```

确认修复：

```http
POST /api/admin/libraries/ownership-reconcile
Content-Type: application/json

{
  "confirm": true,
  "rootOwners": {
    "/books/novels": "novels"
  }
}
```

修复在数据库事务中合并标签、分类、分组、用户阅读状态、阅读会话和元数据日志，不删除或移动源文件。存在完全相同的根目录冲突时，必须通过 `rootOwners` 明确选择每个目录保留在哪个书库；记录合并完成后再修改其他书库的重复路径。未提供完整选择时返回 `409 Conflict`。

### 当前用户可访问书库

```
GET /api/libraries/accessible
```

响应中仅包含当前用户可查看的启用书库，并附带该用户是否可管理：

```json
{
  "libraries": [
    {
      "id": "string",
      "name": "string",
      "type": "comic|novel|mixed",
      "enabled": true,
      "defaultAccess": "public|private",
      "comicCount": 0,
      "canManage": true
    }
  ]
}
```

### 用户/权限组书库权限

用户和权限组的书库权限均为三列权限矩阵：

- `canView`: 可查看书库内容。
- `canDownload`: 可下载书库内容。
- `canManage`: 可上传、管理该书库内容。
- 保存时 `canDownload` 或 `canManage` 会自动包含 `canView`。
- 兼容旧请求体 `{ "libraryIds": ["lib-id"] }`，等价于对这些书库设置 `canView=true`、`canDownload=false`、`canManage=false`。

#### 获取用户书库权限

```
GET /api/admin/users/:id/library-access
```

```json
{
  "userId": "string",
  "libraries": [
    {
      "id": "string",
      "name": "string",
      "type": "comic|novel|mixed",
      "rootPath": "string",
      "rootPaths": ["string"],
      "canView": true,
      "canDownload": false,
      "canManage": false
    }
  ]
}
```

#### 设置用户书库权限

```
PUT /api/admin/users/:id/library-access
```

```json
{
  "libraryAccess": [
    {
      "libraryId": "string",
      "canView": true,
      "canDownload": false,
      "canManage": false
    }
  ]
}
```

#### 获取/设置权限组书库权限

```
GET /api/admin/user-groups/:id/library-access
PUT /api/admin/user-groups/:id/library-access
```

响应和请求体与用户书库权限相同，响应顶层字段为 `groupId`。


| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/system/pdf-renderer` | PDF 渲染器状态 |
