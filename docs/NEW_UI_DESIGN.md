# 新版 UI 设计规范与实现文档 (New UI Design Specification)

本文档旨在详述如何根据用户提供的视觉原型图，完全还原新版 UI 的风格与界面设计（排除硬件监控模块 `Server Activity`）。

---

## 1. 视觉风格与全局主题 (Global Theme & Styling)

### 1.1 配色方案 (Color Palette)
- **背景色**: 极暗灰黑色调（例如 `#0b0b0c` 到 `#050506` 的渐变，或 `#0a0a0c`），给人以沉浸式、高端黑的主题体验。
- **卡片背景**: 半透明暗灰色，带有极细边框（例如 `rgba(30, 30, 35, 0.6)`，边框为 `rgba(255, 255, 255, 0.08)`），并配合 `backdrop-blur-md` 效果。
- **高亮/霓虹流光**: 
  - 聚焦卡片采用紫色与蓝色渐变霓虹光边框（例如 `linear-gradient(135deg, #a855f7, #3b82f6)`），并带有 `box-shadow` 的投影晕染效果。
  - 进度指示器使用鲜明度高的饱和色彩（紫色、绿色、天蓝色、粉色），确保在暗色背景下清晰夺目。
- **文字颜色**: 
  - 主标题与高亮文字: 纯白 `#ffffff`
  - 次要信息 / 按钮文本: 淡灰/静音灰（如 `#9ca3af` / `#6b7280`）
  - 重点进度百分比: 紫色/蓝色/绿色高亮

### 1.2 字体排版 (Typography)
- **大标题 (Continue Reading)**: 采用优雅高对比的衬线体（如 `Playfair Display`, `Georgia` 或类似字体），展现高端阅读器的质感。
- **正文与标签**: 使用现代、清晰的无衬线体（如 `Inter`, `System-UI`, `PingFang SC`）。

---

## 2. 核心模块设计与还原说明 (Core Modules)

### 2.1 继续阅读模块 (Continue Reading - 3D 堆叠流)

此模块放弃原有的平铺横向滑动，改用**中心聚焦、两侧 3D 倾斜堆叠（Cover Flow）**的视觉交互。

#### 2.1.1 堆叠布局 (Stacking Layout)
- **非聚焦卡片（外侧）**:
  - 左右两侧的卡片分别向内倾斜（使用 CSS `transform: rotateY(15deg)` / `-15deg` 或 2D 轻微旋转倾斜 `rotate(-5deg)` / `rotate(5deg)`）。
  - 卡片尺寸稍微缩小（如 `scale(0.85)`），透明度降低（`opacity: 0.6`），层级较低（`z-index: 10`）。
  - 卡片底部显示简易的进度条和“继续”按钮。
- **聚焦卡片（居中）**:
  - 处于最前端，尺寸放大（如 `scale(1.15)`），层级最高（`z-index: 30`）。
  - **外边框流光**: 带有蓝紫色霓虹呼吸灯渐变边框，并具有柔和的投影发光。
  - 封面图右上角叠加**圆形进度环 (Circular Progress Ring)**，内显具体进度数字（如 `76%`）。
  - 卡片下方高亮显示作品名称，并包含一个大尺寸、深色磨砂质感的“继续阅读 (Continue)”按钮。

#### 2.1.2 封面信息指示器
- **线性进度条卡片**: 展示如 `15/19 ch` 或 `12/29 ch`，以蓝色横向进度条贴于封面底部。
- **圆形进度环卡片**: 展示如 `76%` 圆形进度环。

---

### 2.2 最近入库模块 (Recently Added - 状态徽章网格)

网格展示最近新增的作品，重点在**封面图右上角**呈现丰富的作品状态徽章。

#### 2.2.1 封面徽章类型 (Cover Badges)
1. **已读/完结徽章 (Completed Badge)**:
   - 金色麦穗环（Wreath）包围着“Read”字样或“✔”打勾符号，背景为深金色微光。
2. **圆形进度环徽章 (Circular Progress Badge)**:
   - 包含进度数字（例如 `76%`）或章节比例（例如 `15/19 ch`）。
   - 圆环边框颜色根据进度动态渲染（例如：70% 以上为绿色/紫色，30%~70% 为蓝色，低进度为粉色/橙色）。
3. **标签与信息**:
   - 封面底部遮罩显示当前所在卷/页数（如 `Vol 21`，`214/240 p`）。

#### 2.2.2 排版布局
- 卡片底部只显示简洁的作品标题（The Apothecary Diaries、Solo Leveling 等），不再放置多余的按钮，保持网格干净整洁。

---

### 2.3 文件扫描进度条 (File Scanner Status Bar)

位于页面底部的全局横条，悬浮在最上层。

- **整体样式**:
  - 宽度占满，背景为半透明黑（`rgba(15, 15, 20, 0.75)`），伴有 `backdrop-blur-md` 磨砂玻璃质感。
  - 上方有一条非常细的幽蓝色渐变进度条，展示当前任务的精确百分比（如 `98%`）。
- **文字内容**:
  - 左侧高亮标明正在处理的文件名与数量比例，例如：
    `File Scanner: Processing manga/OnePiece/ch1080.zip (98%) - 3,421 / 3,480 files`

---

## 3. 技术实现路径 (Implementation Plan)

### 3.1 样式配置 (`frontend/src/app/globals.css`)
- 增加 3D 视距配置 `perspective: 1000px;` 支撑 Cover Flow 的旋转效果。
- 引入自定义的霓虹边框阴影动画与高亮边框样式。

### 3.2 继续阅读组件重构 (`frontend/src/components/ContinueReading.tsx`)
- 维护一个 `activeIndex` 状态，控制居中放大和左右侧倾斜的卡片。
- 引入圆形 SVG Progress Ring 计算圆周率 `strokeDasharray` 和 `strokeDashoffset` 来展示进度。
- 模拟实现 3D Cover Flow 卡片，通过 CSS transition 保证切换时的平滑缩放与旋转。

### 3.3 最近入库组件重构 (`frontend/src/components/home/RecentlyAdded.tsx`)
- 丰富 `ShelfCard` 组件的参数，允许传入 `statusType` (`'completed'` | `'in-progress'`)。
- 绘制金色麦穗已读徽章，以及多彩圆形进度环徽章。

### 3.4 文件扫描条组件新增 (`frontend/src/components/home/FileScannerBar.tsx`)
- 订阅文件扫描的 API/WebSocket 状态。
- 实现底部悬浮的半透明磨砂条，包含流线型进度动画。
