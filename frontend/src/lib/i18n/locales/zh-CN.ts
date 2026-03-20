const zhCN = {
  // Common
  common: {
    confirm: "确定",
    cancel: "取消",
    save: "保存",
    delete: "删除",
    back: "返回",
    all: "全部",
    loading: "加载中...",
    noData: "暂无数据",
    close: "关闭",
    more: "更多",
    collapse: "收起",
  },

  // Navbar
  navbar: {
    searchPlaceholder: "搜索漫画标题、标签或作者...",
    selectAll: "全选",
    batch: "批量",
    exitBatch: "退出批量",
    upload: "上传",
    uploading: "上传中...",
    stats: "阅读统计",
    aiSearchPlaceholder: "用自然语言搜索，如「关于巨人的漫画」...",
    aiSearchTitle: "AI 语义搜索结果",
    aiSearchNoResults: "未找到匹配结果，试试换个描述方式",
  },

  // Home page
  home: {
    mockDataNotice: "当前显示 Mock 数据。将",
    mockDataNotice2: "漫画文件放入",
    mockDataNotice3: "目录，或点击上传按钮添加漫画。",
    favorites: "收藏",
    sortByTitle: "按标题",
    sortByAdded: "按添加时间",
    sortByLastRead: "按阅读时间",
    sortByRating: "按评分",
    sortByCustom: "自定义排序",
    ascending: "升序",
    descending: "降序",
    emptyLibrary: "漫画库为空",
    noMatchingComics: "没有找到匹配的漫画",
    emptyLibraryHint: "点击上传按钮或将 .zip/.cbz 文件放入 comics/ 目录",
    noMatchingHint: "试试更换搜索关键词或清除标签筛选",
    uploadFailed: "上传失败，请重试",
    uploadSuccess: "上传成功",
    firstPage: "第一页",
    prevPage: "上一页",
    nextPage: "下一页",
    lastPage: "最后一页",
    goToPage: "跳转",
    pageInputPlaceholder: "页码",
  },

  // Stats Bar
  statsBar: {
    total: "共",
    unit: "本",
    filtered: "筛选出",
    recentUpdate: "最近更新",
  },

  // Tag Filter
  tagFilter: {
    label: "标签筛选",
    translate: "翻译标签",
    translating: "翻译中...",
    empty: "暂无标签，可在漫画详情页添加",
  },


  // Category Filter
  categoryFilter: {
    label: "分类",
    uncategorized: "未分类",
  },

  // Batch Toolbar
  batch: {
    selected: "已选择",
    items: "项",
    favorite: "收藏",
    unfavorite: "取消收藏",
    tags: "标签",
    category: "分类",
    tagInputPlaceholder: "输入标签 (逗号分隔多个)，回车确认...",
    aiSuggestTags: "AI 标签",
    aiSuggestTagsRunning: "AI 标签分析中...",
    aiSuggestTagsDone: "AI 标签完成",
    aiSuggestCategory: "AI 分类",
    aiSuggestCategoryRunning: "AI 分类中...",
    aiSuggestCategoryDone: "AI 分类完成",
    confirmDelete: "确认删除",
    confirmDeleteMsg: "确定要删除选中的 {count} 本漫画吗？此操作不可撤销。",
  },

  // Comic Card
  comicCard: {
    detail: "详情",
  },

  // Context Menu (右键菜单)
  contextMenu: {
    read: "阅读",
    detail: "查看详情",
    favorite: "收藏",
    unfavorite: "取消收藏",
    addToGroup: "加入分组",
    delete: "删除",
    confirmDelete: "确认删除？",
    openGroup: "打开分组",
    renameGroup: "重命名",
    deleteGroup: "删除分组",
    renameSuccess: "已重命名",
  },

  // Comic Detail Page
  comicDetail: {
    comicNotFound: "漫画不存在",
    backToShelf: "返回书库",
    continueReading: "继续阅读 (第 {page} 页)",
    startReading: "开始阅读",
    deleteComic: "删除漫画",
    rating: "评分",
    pages: "页数",
    fileSize: "文件大小",
    addedAt: "添加时间",
    readTime: "阅读时长",
    readProgress: "阅读进度",
    lastRead: "上次阅读",
    tagsLabel: "标签",
    noTags: "暂无标签",
    addTagPlaceholder: "添加标签...",
    clickToEdit: "(点击编辑)",
    confirmDelete: "确认删除",
    confirmDeleteMsg: "确定要删除「{title}」吗？此操作将同时删除磁盘上的文件，不可撤销。",
    changeCover: "更换封面",
    uploadCover: "上传本地图片",
    coverFromUrl: "输入图片URL",
    coverFromPlatform: "从漫画平台获取",
    resetCover: "恢复默认封面",
    editTitle: "编辑标题",
    editMetadata: "编辑元数据",
    saveMetadata: "保存",
    cancelEdit: "取消",
    metadataSaved: "元数据已保存",
    metadataSaveFailed: "保存失败",
    noMetadata: "暂无元数据",
    aiSummary: "AI 生成简介",
    aiSummaryGenerating: "正在生成简介...",
    aiSummarySuccess: "简介已生成并保存",
    aiSuggestTags: "AI 建议标签",
    aiSuggestTagsLoading: "正在分析...",
    aiParseFilename: "AI 解析文件名",
    aiParseFilenameLoading: "正在解析...",
    aiParseApply: "应用解析结果",
    aiApplied: "已应用",
    aiNotConfigured: "请先在设置中配置 AI",
    aiAddSelected: "添加选中标签",
    aiAddAll: "全部添加",
    aiAnalyzeCover: "AI 分析封面",
    aiAnalyzeCoverLoading: "正在分析封面...",
    aiAnalyzeCoverResult: "封面分析结果",
    aiCoverStyle: "画风",
    aiCoverMood: "氛围",
    aiCoverTheme: "主题",
    aiCoverAgeRating: "年龄分级",
    aiCoverColorTone: "色调",
    aiCoverCharacters: "角色",
    aiCoverConfidence: "置信度",
    aiVisionNotSupported: "当前 AI 服务商不支持图像分析",
    aiCompleteMetadata: "AI 补全",
    aiCompleteMetadataLoading: "补全中...",
    aiSuggestCategory: "AI 分类",
    aiSuggestCategoryLoading: "分析中...",
    cancel: "取消",
    confirm: "确认",
    deleteSuccess: "已删除",
  },

  // Stats Page
  stats: {
    title: "阅读统计",
    totalReadTime: "总阅读时长",
    readingSessions: "阅读次数",
    comicsRead: "已读漫画",
    dailyChart: "近 30 天阅读时长",
    recentRecords: "最近阅读记录",
    noRecords: "暂无阅读记录",
    cannotLoadStats: "无法加载统计数据",
    page: "第",
    pageArrow: "→",
    pageSuffix: "页",
  },

  // Reader Page
  reader: {
    unknownComic: "未知漫画",
    comicNotFound: "漫画不存在",
    backToShelf: "返回书库",
    favorited: "已收藏",
    addFavorite: "添加收藏",
    rating: "评分",
    tagsLabel: "标签",
    noTags: "暂无标签",
    addTagPlaceholder: "添加标签...",
    readingInfo: "阅读信息",
    currentPage: "当前页",
    readProgress: "阅读进度",
    lastRead: "上次阅读",
    shortcuts: "快捷键",
    turnPage: "翻页",
    fullscreen: "全屏",
    infoPanel: "信息面板",
    goBack: "返回",
    reachedLastPage: "已到达最后一页",
    loading: "正在加载...",
    loadError: "加载失败",
    retry: "重试",
    toc: "目录",
    typesetting: "排版",
    // 小说阅读器
    prevChapter: "上一章",
    nextChapter: "下一章",
    chapterN: "第 {n} 章",
    settingsTitle: "排版设置",
    bgTheme: "背景主题",
    fontSize: "字体大小",
    lineSpacing: "行间距",
    margin: "页边距",
    marginCompact: "紧凑",
    marginStandard: "标准",
    marginWide: "宽松",
    pageMode: "翻页方式",
    pageModeScroll: "上下滚动",
    pageModeSwipe: "左右翻页",
    autoScrollSpeed: "自动翻页速度",
    speedSlow: "慢速",
    speedMedium: "中速",
    speedFast: "快速",
    autoScrollHint: "快捷键 G 开启/关闭自动翻页",
    font: "字体",
    fontSystem: "系统默认",
    fontSerif: "宋体/衬线",
    fontSans: "黑体/无衬线",
    fontKai: "楷体",
    fontMono: "等宽字体",
    themeNight: "深色",
    themeDay: "米黄",
    themeGreen: "豆沙绿",
    themeGray: "浅灰",
    themeWhite: "纯白",
    tocLabel: "目录",
    bookmarkLabel: "书签",
    noBookmarks: "暂无书签",
    addBookmarkHint: "点击标题栏的书签图标添加",
    removeBookmark: "删除书签",
    copy: "复制",
    highlight: "划线",
    note: "笔记",
    addNote: "添加笔记",
    writeThoughts: "写下你的想法...",
    save: "保存",
    cancel: "取消",
    ttsPause: "继续",
    ttsResume: "暂停",
    ttsStop: "停止",
    ttsSpeed: "语速",
    ttsPaused: "已暂停",
    ttsReading: "朗读中...",
    autoScrolling: "自动翻页中",
    searchPlaceholder: "搜索全书内容...",
    search: "搜索",
    searchCancel: "取消",
    searchingAll: "正在搜索全书内容...",
    searchChapterCount: "共 {n} 章，点击「取消」可中断",
    noSearchResults: "未找到匹配结果",
    searchFoundMatches: "找到 {count} 处匹配，分布在 {chapters} 个章节",
    searchMatches: "{n} 处",
    searchHint: "输入关键词搜索全书内容",
    searchShortcut: "快捷键: S",
    copied: "已复制",
  },

  // Reader Toolbar
  readerToolbar: {
    single: "单页",
    double: "双页",
    webtoon: "长条",
    text: "文本",
    rtl: "右→左",
    ltr: "左→右",
    ttb: "上→下",
    dayMode: "日间",
    nightMode: "夜间",
    settings: "设置",
    autoPage: "自动翻页",
    autoPageStop: "停止翻页",
  },

  // 阅读器选项面板
  readerOptions: {
    title: "阅读器选项",
    autoSaveHint: "选项自动保存",
    groupDisplay: "显示",
    groupAdvanced: "高级",
    groupBehavior: "行为",
    fitMode: "适应显示",
    fitContainer: "容器",
    fitWidth: "宽度",
    fitHeight: "高度",
    containerWidth: "容器宽度(像素或百分比)",
    containerWidthPlaceholder: "默认值为1200像素,或双页模式下为90%。",
    apply: "应用",
    pageRendering: "页面渲染",
    singlePage: "单页",
    doublePage: "双页",
    readingDirection: "阅读方向",
    ltr: "从左到右",
    rtl: "从右到左",
    ttb: "从上到下",
    preloadCount: "预加载图片数量",
    header: "页码指示器",
    headerVisible: "可见",
    headerHidden: "隐藏",
    defaultOverlay: "默认显示档案覆盖层",
    defaultOverlayDesc: "每次打开新的阅读器页面时,这将显示带有缩略图的覆盖层。",
    enable: "启用",
    disable: "禁用",
    progressTracking: "进度跟踪",
    progressTrackingDesc: "禁用进度跟踪的话,每次打开阅读器时从第一页重新开始阅读。",

    autoPageInterval: "自动翻页间隔(秒)",
    autoPageIntervalDesc: "设为0则禁用，设置后可在工具栏启停",
    showTranslate: "页面翻译",
    showTranslateDesc: "显示页面翻译按钮，支持 AI 实时翻译漫画内容",
    showAIChat: "AI 助手",
    showAIChatDesc: "显示 AI 助手按钮，可以智能问答漫画内容",
  },

  // Duration formatting
  duration: {
    seconds: "{n}秒",
    minutes: "{m}分{s}秒",
    hours: "{h}小时{m}分",
    shortSeconds: "{n}s",
    shortMinutes: "{n}m",
    shortHours: "{n}h",
  },

  // Auth
  auth: {
    setupTitle: "创建管理员账户",
    setupDesc: "设置第一个管理员账户以开始使用",
    loginTitle: "登录",
    registerTitle: "创建账户",
    username: "用户名",
    password: "密码",
    nickname: "昵称 (可选)",
    login: "登录",
    register: "注册",
    logout: "退出登录",
    settings: "设置",
    createAccount: "创建账户",
    hasAccount: "已有账户？去登录",
    noAccount: "没有账户？去注册",
  },

  // Metadata
  metadata: {
    searchPlaceholder: "搜索元数据...",
    search: "搜索",
    scanArchive: "从压缩包提取 ComicInfo.xml",
    scanNovel: "刮削小说元数据（EPUB 本地 + 在线搜索）",
    noResults: "未找到结果",
    apply: "应用",
    applied: "已应用",
    appliedFromArchive: "已从 ComicInfo.xml 应用元数据",
    appliedFromNovelScan: "小说元数据应用成功",
    noEpubMetadata: "未找到 EPUB 元数据或在线搜索结果",
    noComicInfo: "未找到 ComicInfo.xml",
    author: "作者",
    publisher: "出版社",
    year: "年份",
    description: "简介",
    genre: "类型",
    language: "语言",
    metadataSource: "数据来源",
    scrapeMetadata: "刮削元数据",
    selectSources: "选择数据源",
    sources: {
      anilist: "AniList (动漫列表)",
      anilist_novel: "AniList (轻小说)",
      bangumi: "Bangumi (番组计划)",
      bangumi_novel: "Bangumi (小说)",
      mangadex: "MangaDex (漫画索引)",
      mangaupdates: "MangaUpdates (漫画更新)",
      kitsu: "Kitsu (狐狸)",
      googlebooks: "Google Books (谷歌图书)",
      comicinfo: "ComicInfo (本地)",
      epub_opf: "EPUB OPF (本地)",
    },
    translateMetadata: "翻译元数据",
    translatingMetadata: "翻译中...",
    editMetadata: "编辑",
    editingMetadata: "编辑元数据",
  },

  // Recommendations
  recommend: {
    title: "为你推荐",
    refresh: "刷新",
    seeMore: "查看更多",
    similar: "相似漫画",
    tagMatch: "标签匹配",
    genreMatch: "类型匹配",
    sameAuthor: "同一作者",
    highlyRated: "高评分",
    unread: "未读",
    similarTags: "相似标签",
    similarGenre: "相似类型",
    sameCategory: "同一分类",
    semanticMatch: "AI 语义匹配",
    aiReasonLoading: "正在生成 AI 推荐理由...",
    aiReasonGenerate: "AI 推荐理由",
  },

  // Settings
  settings: {
    title: "设置",
    ai: "AI",
    about: "关于",
    groupGeneral: "通用",
    groupData: "数据",
    aboutDesc: "版本与项目信息",
    aboutSlogan: "高性能自托管漫画 & 小说管理平台",
    aboutTechStack: "技术栈",
  },

  // Error Logs
  errorLogs: {
    tab: "日志",
    title: "错误日志",
    autoRefresh: "自动刷新（每5秒）",
    refresh: "刷新",
    clear: "清空日志",
    confirmClear: "确定要清空所有错误日志吗？",
    statistics: "统计概览",
    statusDistribution: "状态码分布",
    topPaths: "高频错误路径",
    filtering: "过滤中",
    loading: "加载中...",
    noLogs: "暂无错误日志",
    noLogsHint: "当接口返回 4xx/5xx 错误时会自动记录",
    pageInfo: "第 {page} / {total} 页",
    prevPage: "上一页",
    nextPage: "下一页",
    export: "导出日志",
    exportJSON: "导出 JSON",
    exportCSV: "导出 CSV",
    exporting: "导出中...",
  },

  // Site Settings
  siteSettings: {
    tab: "站点",
    title: "站点设置",
    siteName: "站点名称",
    siteNameDesc: "显示在浏览器标题栏中的名称",
    comicsDir: "漫画库目录",
    comicsDirDesc: "存放漫画压缩包的路径，修改后需重启服务生效",
    comicsDirsMergedDesc: "所有目录都会被扫描。第一个为主目录（用于上传），修改后需重启生效",
    primaryDir: "主目录",
    extraDirs: "额外漫画目录（Docker / NAS）",
    extraDirsDesc: "挂载多个目录用于 Docker 或 NAS，所有目录都会被扫描",
    extraDirPlaceholder: "/mnt/nas/comics 或 /data/manga",
    browseDir: "浏览目录",
    selectDir: "选择此目录",
    parentDir: "上级目录",
    emptyDir: "此目录下没有子目录",
    browseDirTitle: "选择文件夹",
    currentPath: "当前路径",
    browseError: "无法读取目录",
    permissionFixTitle: "💡 如何获取权限：",
    thumbnailSize: "缩略图尺寸",
    width: "宽度",
    height: "高度",
    thumbnailDesc: "封面缩略图尺寸（像素），修改后需清除缩略图缓存",
    thumbManage: "缩略图管理",
    thumbTotal: "总数",
    thumbExisting: "已缓存",
    thumbMissing: "缺失",
    thumbGenerateMissing: "生成缺失的缩略图",
    thumbRegenerateAll: "重新生成所有缩略图",
    thumbGenerated: "已生成 {count} 个缩略图",
    thumbRegenerated: "已重新生成 {count} 个缩略图",
    cacheManage: "缓存管理",
    clearThumbnails: "清除缩略图缓存",
    clearSearch: "重置搜索缓存",
    cacheDesc: "清除缓存数据以释放磁盘空间或修复显示问题",
    cleanupInvalid: "清理无效漫画",
    cleanupInvalidDesc: "删除数据库中源文件已不存在的漫画记录，修复 404/500 错误",
    cleanupInvalidBtn: "扫描并清理",
    cleanupRunning: "正在扫描...",
    cleanupDone: "清理完成：已移除 {count} 条无效记录",
    batchMetadata: "批量获取元数据",
    batchMetadataDesc: "自动从在线源（AniList、Bangumi 等）获取所有漫画的元数据",
    batchMissing: "仅获取缺失的元数据",
    batchAll: "重新获取所有元数据",
    batchComplete: "批量元数据获取完成",
    batchSuccess: "成功",
    batchFailed: "失败",
    batchSkipped: "跳过",
    batchTranslateMetadata: "批量翻译元数据",
    batchTranslateMetadataDesc: "将所有漫画的元数据（标题、简介、类型、系列名）翻译为当前语言",
    startBatchTranslate: "开始翻译",
    batchTranslateComplete: "批量翻译完成",
    pageSize: "每页数量",
    pageSizeDesc: "首页每页显示的漫画数量",
    language: "语言",
    langAuto: "自动检测",
    theme: "主题",
    themeDark: "深色",
    themeLight: "浅色",
    themeSystem: "跟随系统",
    defaultReadingMode: "默认阅读模式",
    defaultReadingModeDesc: "进入漫画阅读器时默认使用的翻页模式",
    modeSingle: "单页模式",
    modeDouble: "双页模式",
    modeWebtoon: "长条滚动",
    saved: "已保存",
    restartHint: "部分设置需要重启后生效",
  },

  // AI
  ai: {
    title: "AI 功能",
    cloudAI: "云端 AI",
    provider: "服务商",
    compatible: "兼容 API",
    model: "模型",
    testConnection: "测试连接",
    testing: "测试中...",
    connectionSuccess: "连接成功",
    connectionFailed: "连接失败",
    saving: "保存中...",
    saveSettings: "保存设置",
    internationalProviders: "国际服务商",
    chinaProviders: "国内服务商",
    customProvider: "自定义",
    visionSupported: "支持视觉分析（封面识别）",
    textOnly: "仅支持文本（无封面分析）",
    presetModels: "预设模型",
    fetchModels: "拉取模型",
    manualInput: "手动填写",
    manualModelPlaceholder: "输入模型名称，如 gpt-4o",
    modelsFetched: "已拉取 {count} 个模型",
    noModelsFound: "未找到可用模型",
    // Phase 0 新增
    maxTokens: "最大输出 Token",
    maxTokensHint: "AI 单次回复的最大 token 数（默认 2000）",
    maxRetries: "失败重试次数",
    maxRetriesHint: "API 调用失败时自动重试的次数（0-5）",
    advancedSettings: "高级设置",
    usage: "使用量统计",
    totalCalls: "总调用次数",
    successCalls: "成功",
    failedCalls: "失败",
    totalTokens: "总 Token 消耗",
    promptTokens: "输入 Token",
    outputTokens: "输出 Token",
    avgDuration: "平均耗时",
    resetUsage: "重置统计",
    resetUsageConfirm: "确定要重置 AI 使用量统计吗？",
    noUsageData: "暂无使用记录",
    scenario: "场景",
    recentCalls: "最近调用",
    duration: "耗时",
  },

  // Duplicates
  duplicates: {
    title: "重复检测",
    detect: "检测重复",
    detecting: "检测中...",
    noDuplicates: "没有发现重复的漫画",
    foundGroups: "发现 {count} 组重复",
    sameFile: "文件内容完全相同",
    sameSize: "文件大小和页数相同",
    sameName: "标题相似",
    partialHash: "部分哈希匹配",
    fuzzyName: "模糊标题匹配",
    fileSize: "大小",
    pageCount: "页数",
    addedAt: "添加时间",
    keepThis: "保留",
    deleteThis: "删除",
    close: "关闭",
    confirmDelete: "确认删除",
    confirmDeleteMsg: "确定要删除「{title}」吗？此操作将同时删除磁盘上的文件，不可撤销。",
    keepSelected: "保留选中项",
    deleteAllDuplicates: "一键删除重复",
    deletingAll: "批量删除中...",
    confirmDeleteAll: "确认批量删除",
    confirmDeleteAllMsg: "将删除 {count} 个重复文件（每组保留选中的一个），此操作不可撤销。",
    deletedCount: "已删除 {count} 个文件",
    selectToKeep: "点击选择要保留的项",
    confidence: "置信度",
    details: "详情",
    compareCover: "封面对比",
    filterAll: "所有类型",
  },

  // 继续阅读
  continueReading: {
    title: "继续阅读",
    justNow: "刚刚",
    minutesAgo: "分钟前",
    hoursAgo: "小时前",
    daysAgo: "天前",
    chapter: "第",
    chapterUnit: "章",
    pageUnit: "页",
    collapse: "收起",
    expand: "展开",
  },

  // 移动端导航
  mobileNav: {
    library: "书库",
    stats: "统计",
  },

  // 增强统计
  statsEnhanced: {
    streak: "连续阅读",
    days: "天",
    longest: "最长",
    today: "今日",
    thisWeek: "本周",
    speed: "速度",
    pagesPerHour: "页/时",
    tabOverview: "概览",
    tabDaily: "每日",
    tabMonthly: "月度",
    tabGenre: "类型",
    dailyChart: "近 90 天阅读时长",
    monthlyTrend: "月度趋势",
    genrePreference: "类型偏好",
    sessionsUnit: "次",
    comicsUnit: "本",
    aiInsight: "AI 阅读洞察",
    aiInsightGenerating: "正在生成洞察报告...",
    aiInsightError: "生成失败",
    aiInsightEmpty: "暂无足够数据生成洞察",
  },

  // 内容类型 Tab
  contentTab: {
    all: "全部",
    comic: "漫画",
    novel: "小说",
  },

  // 数据导出
  dataExport: {
    title: "导出",
    jsonFull: "JSON 完整备份",
    csvComics: "CSV 漫画库",
    csvSessions: "CSV 阅读记录",
    uploadFiles: "上传文件",
    scanDirs: "扫描目录",
    clearFilters: "清除筛选条件",
  },

  // 阅读目标
  readingGoal: {
    title: "阅读目标",
    daily: "每日目标",
    weekly: "每周目标",
    minutes: "分钟",
    books: "本",
    setGoal: "设定目标",
    achieved: "目标已达成！",
    editGoal: "编辑",
    deleteGoal: "删除",
  },

  // 漫画分组
  comicGroup: {
    title: "漫画合并分组",
    groups: "分组",
    createGroup: "创建分组",
    editGroup: "编辑分组",
    deleteGroup: "删除分组",
    groupName: "分组名称",
    groupNamePlaceholder: "输入分组名称...",
    addToGroup: "加入分组",
    removeFromGroup: "从分组移除",
    volumes: "卷",
    totalPages: "总页数",
    totalReadTime: "总阅读时长",
autoDetect: "智能分组",
    autoDetecting: "正在检测...",
    autoDetectDesc: "自动识别可合并的同系列漫画",
    foundSuggestions: "发现 {count} 个可合并的系列",
    noSuggestions: "未发现可合并的系列",
    createAll: "全部创建",
    createSelected: "创建选中",
    created: "已创建 {count} 个分组",
    confirmDelete: "确认删除分组",
    confirmDeleteMsg: "确定要删除分组「{name}」吗？分组内的漫画不会被删除。",
    emptyGroup: "此分组还没有漫画",
    mergeSelected: "合并为分组",
    viewGroup: "查看分组",
    backToLibrary: "返回书库",
    continueReading: "继续阅读",
    volumeIndex: "第 {index} 卷",
    dragToReorder: "拖拽排序",
    noGroups: "还没有分组",
    noGroupsHint: "可以选中多本漫画后合并为分组，或使用智能分组自动发现同系列漫画",
    aiEnhanceDetect: "智能 + AI 检测",
    aiDetecting: "AI 深度分析中...",
    searchComicHint: "输入关键词搜索漫画",
    searchGroupHint: "搜索分组...",
    noMatchGroup: "无匹配分组",
    deleteSuccess: "分组已删除",
  },

  // 合集管理页面
  collections: {
    title: "合集管理",
    navTitle: "合集",
    loading: "加载中...",
    refresh: "刷新",
    filterAll: "全部",
    filterComic: "漫画",
    filterNovel: "小说",
    sortByName: "按名称",
    sortByCount: "按作品数",
    sortByUpdated: "按更新时间",
    sortByCreated: "按创建时间",
    works: "部作品",
    emptyTitle: "还没有合集",
    emptyHint: "使用智能分组自动发现同系列作品，或手动创建合集来整理你的书库",
    emptySearchHint: "尝试其他关键词或清除搜索",
    createTitle: "新建合集",
    viewDetail: "查看详情",
    // 批量操作
    batchMode: "批量管理",
    batchModeExit: "退出批量",
    selectAll: "全选",
    deselectAll: "取消全选",
    selectedCount: "已选 {count} 个",
    batchDelete: "批量删除",
    batchMerge: "合并",
    batchExport: "导出",
    batchDeleteConfirm: "确认批量删除",
    batchDeleteMsg: "确定要删除选中的 {count} 个合集吗？合集内的作品不会被删除。",
    batchDeleteSuccess: "成功删除 {count} 个合集",
    mergeTitle: "合并合集",
    mergeHint: "将选中的 {count} 个合集合并为一个新合集",
    mergeNameLabel: "合并后的名称",
    mergeNamePlaceholder: "输入新合集名称...",
    mergeSuccess: "合集已合并",
    mergeNeedTwo: "至少需要选择两个合集才能合并",
    exportSuccess: "导出成功",
    exportFailed: "导出失败",
    totalWorks: "共 {count} 部作品",
  },

  // 系列导航
  series: {
    nextVolume: "下一卷",
    prevVolume: "上一卷",
    volumes: "卷",
  },

  // 元数据刮削页面
  scraper: {
    title: "元数据刮削",
    subtitle: "自动获取封面、简介、标签等信息",
    statsTotal: "总计",
    statsWithMeta: "已获取",
    statsMissing: "缺失",
    completionRate: "元数据完成度",
    operationTitle: "刮削操作",
    modeLabel: "刮削模式",
    modeStandard: "标准刮削",
    modeStandardDesc: "从 AniList、Bangumi 等在线源搜索并匹配元数据",
    modeAI: "AI 智能刮削",
    modeAIDesc: "AI 内容识别 → 在线搜索 → AI 补全，多级回退",
    scopeLabel: "刮削范围",
    scopeMissing: "仅缺失",
    scopeAll: "全部重刮",
    startBtn: "开始刮削",
    stopBtn: "停止刮削",
    refreshStats: "刷新统计",
    progressTitle: "刮削进度",
    progressDone: "刮削完成",
    progressRemaining: "剩余",
    stepRecognize: "AI 识别漫画内容...",
    stepParse: "AI 解析文件名...",
    stepSearch: "在线搜索元数据...",
    stepApply: "应用元数据...",
    stepAIComplete: "AI 智能补全...",
    stepProcessing: "处理中...",
    resultSuccess: "成功",
    resultFailed: "失败",
    resultTotal: "总数",
    resultListTitle: "处理结果",
    emptyTitle: "开始为你的书库获取元数据",
    emptyDesc: "选择刮削模式和范围后，点击「开始刮削」自动从在线数据源获取封面、简介、标签等信息。AI 模式可智能识别漫画内容提高匹配率。",
    navEntry: "元数据刮削",
    updateTitleLabel: "同时更新书名",
    updateTitleDesc: "开启后会用元数据源中的标题替换当前书名（如文件名等）",
    tabScrape: "刮削",
    tabLibrary: "书库管理",
    libSearchPlaceholder: "搜索书名、文件名...",
    libFilterLabel: "筛选",
    libFilterAll: "全部",
    libFilterMissing: "缺失元数据",
    libFilterWith: "已有元数据",
    libTypeAll: "全部类型",
    libTypeComic: "漫画",
    libTypeNovel: "小说",
    libSelectAll: "全选当页",
    libDeselectAll: "取消全选",
    libSelected: "已选",
    libItems: "项",
    libScrapeSelected: "刮削选中",
    libClearMeta: "清除元数据",
    libCancel: "取消",
    libEmpty: "没有找到匹配的内容",
    libNoMeta: "缺失",
    libTotalItems: "共",
    detailTitle: "书籍详情",
    detailNoMeta: "缺失元数据",
    detailSearchTitle: "精准刮削",
    detailSearchDesc: "搜索在线数据源，选择最匹配的结果应用到此书",
    modeStandardShort: "在线源搜索匹配",
    modeAIShort: "AI识别+搜索+补全",
    rightPanelHint: "点击左侧书籍查看详情",
    rightPanelDesc: "选择一本书查看元数据详情并进行精准刮削，或使用上方批量操作对全库/选中项统一刮削",
    paginationPerPage: "每页",
    paginationUnit: "条",
    paginationFirst: "首页",
    paginationLast: "末页",
    paginationGoto: "跳至",
    paginationPage: "页",
    editTitleHint: "点击编辑书名",
    saveTitle: "保存",
    cancelEdit: "取消",
    deleteTag: "删除标签",
    batchEditBtn: "批量命名",
    batchEditTitle: "批量编辑名称",
    batchEditList: "名称编辑",
    batchEditChanged: "项已修改",
    batchEditUndo: "还原全部",
    batchEditOldName: "原名",
    batchEditSaving: "保存中...",
    batchEditSaveBtn: "保存",
    batchEditSaved: "保存完成",
    aiRenameTitle: "AI 智能命名",
    aiRenameDesc: "输入命名需求，AI会为所有选中书籍生成合适的名称",
    aiRenamePlaceholder: "例如：提取纯净书名、去除方括号标记、格式统一为「作者 - 书名」...",
    aiRenameBtn: "AI 生成名称",
    aiRenameLoading: "AI 生成中...",
    applyAllTitle: "一键应用相同名称",
    applyAllPlaceholder: "输入统一名称...",
    applyBtn: "应用",
    sortBy: "排序",
    sortByTitle: "名称",
    sortByFileSize: "大小",
    sortByUpdatedAt: "更新时间",
    sortByMetaStatus: "刮削状态",
    // AI 聊天面板
    aiChatTitle: "AI 刮削助手",
    aiChatSubtitle: "智能对话 · 指令控制",
    aiChatPlaceholder: "输入问题或指令，如「刮削所有缺失元数据的书」...",
    aiChatSend: "发送",
    aiChatClear: "清空对话",
    aiChatClose: "关闭",
    aiChatEmpty: "你好！我是你的刮削助手 🤖",
    aiChatEmptyDesc: "你可以问我关于元数据刮削的问题，或者直接用自然语言下指令。试试看吧！",
    aiChatQuickScrapeAll: "刮削缺失项",
    aiChatQuickSetAI: "切换AI模式",
    aiChatQuickStats: "查看统计",
    aiChatQuickHelp: "使用帮助",
    aiChatQuickSelectAll: "全选当页",
    aiChatQuickFilter: "筛选缺失",
    aiChatCmdSuccess: "✅ 指令执行成功",
    aiChatCmdFailed: "❌ 指令执行失败",
    aiChatStopped: "已中断",
    aiChatBtnLabel: "AI 助手",
    // 引导教程系统
    guideWelcomeTitle: "欢迎使用元数据刮削",
    guideWelcomeDesc: "这个功能可以帮你自动从在线数据源获取漫画/小说的封面、简介、标签等信息。让我带你快速了解如何使用！",
    guideFilterTitle: "筛选与搜索",
    guideFilterDesc: "在这里可以按状态（缺失/已有）、类型（漫画/小说）筛选书籍，还可以通过关键词搜索。排序功能帮你快速定位目标。",
    guideFilterAction: "试试点击「缺失」按钮筛选出需要刮削的书籍",
    guideListTitle: "书籍列表",
    guideListDesc: "左侧列表展示了你书库中的所有书籍。绿色✓表示已有元数据，黄色⚠表示缺失。点击任意书籍可查看详情。",
    guideListAction: "点击一本书查看其元数据详情",
    guideSelectTitle: "批量操作",
    guideSelectDesc: "勾选书籍后可以进行批量操作：批量刮削、批量命名（支持AI智能命名）、清除元数据等。全选/取消全选可快速切换。",
    guideSelectAction: "试试全选当前页的书籍",
    guideScrapeTitle: "刮削控制面板",
    guideScrapeDesc: "在右侧面板可以设置刮削模式（标准/AI智能）和范围（仅缺失/全部）。AI模式会先通过封面和内页智能识别漫画内容，再搜索匹配，最后AI补全缺失信息。",
    guideScrapeAction: "选择刮削模式后点击「开始刮削」",
    guideAIChatTitle: "AI 刮削助手",
    guideAIChatDesc: "点击这个按钮打开AI助手，你可以用自然语言控制刮削操作，比如说「帮我刮削所有缺失元数据的书」、「切换到AI模式」等。",
    guideAIChatAction: "试试打开AI助手并输入指令",
    guideNext: "下一步",
    guidePrev: "上一步",
    guideSkip: "跳过教程",
    guideFinish: "完成",
    guideStepOf: "步骤 {current}/{total}",
    guideRestartBtn: "重新引导",
    // 帮助面板
    helpTitle: "帮助中心",
    helpSearchPlaceholder: "搜索帮助文档...",
    helpNoResults: "没有找到匹配的帮助内容",
    helpFaqTitle: "常见问题",
    helpTipsTitle: "使用技巧",
    helpTroubleshootTitle: "故障排除",
    helpFaq1Q: "什么是元数据刮削？",
    helpFaq1A: "元数据刮削是从在线数据源（如AniList、Bangumi等）自动获取漫画/小说的封面、简介、作者、标签等信息的过程。这样你的书库看起来更整洁专业。",
    helpFaq2Q: "标准模式和AI模式有什么区别？",
    helpFaq2A: "标准模式直接用书名搜索在线数据源匹配；AI模式会先通过封面和内页图片智能识别漫画内容（不依赖文件名），再搜索匹配，最后用AI补全缺失字段，匹配率更高。",
    helpFaq3Q: "刮削失败怎么办？",
    helpFaq3A: "可以尝试：1）修改书名使其更接近正式名称；2）使用精准刮削手动搜索；3）切换到AI模式重试；4）检查网络连接是否正常。",
    helpFaq4Q: "可以只刮削部分书籍吗？",
    helpFaq4A: "可以！勾选想刮削的书籍，然后点击「刮削选中」。也可以在筛选栏中选择「缺失」只显示需要刮削的书，再点全选后批量刮削。",
    helpFaq5Q: "如何编辑错误的元数据？",
    helpFaq5A: "点击书籍进入详情面板，可以编辑书名和删除标签。使用「精准刮削」搜索正确的元数据重新应用。也可以用批量命名修改多本书的名称。",
    helpTip1: "💡 使用AI模式刮削时，先确保在设置中配置了AI服务",
    helpTip2: "💡 AI 智能刮削通过分析封面和内页识别漫画，无需依赖文件名，识别率更高",
    helpTip3: "💡 通过AI助手可以用自然语言控制操作，比如「刮削所有缺失的」",
    helpTip4: "💡 点击书籍封面可查看详情并进行精准刮削",
    helpTip5: "💡 排序功能可以按刮削状态排序，快速找到缺失元数据的书",
    helpTrouble1Q: "刮削一直显示失败",
    helpTrouble1A: "请检查：1）网络连接是否正常；2）AniList/Bangumi等在线源是否可访问；3）书名是否包含过多特殊字符。尝试简化书名后重试。",
    helpTrouble2Q: "AI模式不可用",
    helpTrouble2A: "需要先在「设置 → AI」中配置云端AI服务（如OpenAI、通义千问等）并测试连接成功后才能使用AI相关功能。",
    helpTrouble3Q: "刮削结果不准确",
    helpTrouble3A: "1）使用精准刮削手动搜索正确条目；2）修改书名更接近正式名称；3）试试不同的在线数据源；4）使用AI模式自动清洗书名再搜索。",

    // 合集管理
    collectionTitle: "合集管理",
    collectionDesc: "管理漫画系列分组与元数据关联",
    collectionEmpty: "暂无合集",
    collectionEmptyHint: "可通过智能检测自动发现系列，或手动创建合集",
    collectionCreate: "创建合集",
    collectionCreatePlaceholder: "输入合集名称...",
    collectionAutoDetect: "智能检测",
    collectionAutoDetectDesc: "自动识别可合并的系列漫画",
    collectionAutoEmpty: "未发现可合并的系列",
    collectionAutoApplyAll: "全部创建",
    collectionAutoApplySelected: "创建选中",
    collectionSuggestions: "检测到的系列",
    collectionItemCount: "{count} 本",
    collectionEdit: "编辑",
    collectionDelete: "删除",
    collectionDeleteConfirm: "确定要删除合集「{name}」吗？（不会删除漫画文件本身）",
    collectionAddSelected: "加入合集",
    collectionAddToGroup: "添加到合集",
    collectionAddToNew: "创建新合集并添加",
    collectionRemoveItem: "从合集移除",
    collectionReorder: "排序",
    collectionBack: "返回列表",
    collectionScrapeAll: "刮削整个合集",
    collectionMoveUp: "上移",
    collectionMoveDown: "下移",
    collectionNoName: "请输入合集名称",
    collectionCreated: "合集已创建",
    collectionUpdated: "合集已更新",
    collectionDeleted: "合集已删除",
    collectionItemAdded: "已添加到合集",
    collectionItemRemoved: "已从合集移除",
  },
} satisfies Translations;

export default zhCN;

export interface Translations {
  common: {
    confirm: string;
    cancel: string;
    save: string;
    delete: string;
    back: string;
    all: string;
    loading: string;
    noData: string;
    close: string;
    more: string;
    collapse: string;
  };
  navbar: {
    searchPlaceholder: string;
    selectAll: string;
    batch: string;
    exitBatch: string;
    upload: string;
    uploading: string;
    stats: string;
    aiSearchPlaceholder: string;
    aiSearchTitle: string;
    aiSearchNoResults: string;
  };
  home: {
    mockDataNotice: string;
    mockDataNotice2: string;
    mockDataNotice3: string;
    favorites: string;
    sortByTitle: string;
    sortByAdded: string;
    sortByLastRead: string;
    sortByRating: string;
    sortByCustom: string;
    ascending: string;
    descending: string;
    emptyLibrary: string;
    noMatchingComics: string;
    emptyLibraryHint: string;
    noMatchingHint: string;
    uploadFailed: string;
    uploadSuccess: string;
    firstPage: string;
    prevPage: string;
    nextPage: string;
    lastPage: string;
    goToPage: string;
    pageInputPlaceholder: string;
  };
  statsBar: {
    total: string;
    unit: string;
    filtered: string;
    recentUpdate: string;
  };
  tagFilter: {
    label: string;
    translate: string;
    translating: string;
    empty: string;
  };
  categoryFilter: {
    label: string;
    uncategorized: string;
  };
  batch: {
    selected: string;
    items: string;
    favorite: string;
    unfavorite: string;
    tags: string;
    category: string;
    tagInputPlaceholder: string;
    aiSuggestTags?: string;
    aiSuggestTagsRunning?: string;
    aiSuggestTagsDone?: string;
    aiSuggestCategory?: string;
    aiSuggestCategoryRunning?: string;
    aiSuggestCategoryDone?: string;
    confirmDelete: string;
    confirmDeleteMsg: string;
  };
  comicCard: {
    detail: string;
  };
  contextMenu?: {
    read: string;
    detail: string;
    favorite: string;
    unfavorite: string;
    addToGroup: string;
    delete: string;
    confirmDelete: string;
    openGroup: string;
    renameGroup: string;
    deleteGroup: string;
    renameSuccess: string;
  };
  comicDetail: {
    comicNotFound: string;
    backToShelf: string;
    continueReading: string;
    startReading: string;
    deleteComic: string;
    rating: string;
    pages: string;
    fileSize: string;
    addedAt: string;
    readTime: string;
    readProgress: string;
    lastRead: string;
    tagsLabel: string;
    noTags: string;
    addTagPlaceholder: string;
    clickToEdit: string;
    confirmDelete: string;
    confirmDeleteMsg: string;
    changeCover: string;
    uploadCover: string;
    coverFromUrl: string;
    coverFromPlatform: string;
    resetCover: string;
    editTitle: string;
    editMetadata: string;
    saveMetadata: string;
    cancelEdit: string;
    metadataSaved: string;
    metadataSaveFailed: string;
    noMetadata: string;
    aiSummary: string;
    aiSummaryGenerating: string;
    aiSummarySuccess: string;
    aiSuggestTags: string;
    aiSuggestTagsLoading: string;
    aiParseFilename: string;
    aiParseFilenameLoading: string;
    aiParseApply: string;
    aiApplied: string;
    aiNotConfigured: string;
    aiAddSelected: string;
    aiAddAll: string;
    aiAnalyzeCover: string;
    aiAnalyzeCoverLoading: string;
    aiAnalyzeCoverResult: string;
    aiCoverStyle: string;
    aiCoverMood: string;
    aiCoverTheme: string;
    aiCoverAgeRating: string;
    aiCoverColorTone: string;
    aiCoverCharacters: string;
    aiCoverConfidence: string;
    aiVisionNotSupported: string;
    aiCompleteMetadata?: string;
    aiCompleteMetadataLoading?: string;
    aiSuggestCategory?: string;
    aiSuggestCategoryLoading?: string;
    cancel?: string;
    confirm?: string;
    deleteSuccess?: string;
  };
  stats: {
    title: string;
    totalReadTime: string;
    readingSessions: string;
    comicsRead: string;
    dailyChart: string;
    recentRecords: string;
    noRecords: string;
    cannotLoadStats: string;
    page: string;
    pageArrow: string;
    pageSuffix: string;
  };
  reader: {
    unknownComic: string;
    comicNotFound: string;
    backToShelf: string;
    favorited: string;
    addFavorite: string;
    rating: string;
    tagsLabel: string;
    noTags: string;
    addTagPlaceholder: string;
    readingInfo: string;
    currentPage: string;
    readProgress: string;
    lastRead: string;
    shortcuts: string;
    turnPage: string;
    fullscreen: string;
    infoPanel: string;
    goBack: string;
    reachedLastPage: string;
    loading: string;
    loadError: string;
    retry: string;
    toc: string;
    typesetting: string;
    // Novel reader
    prevChapter: string;
    nextChapter: string;
    chapterN: string;
    settingsTitle: string;
    bgTheme: string;
    fontSize: string;
    lineSpacing: string;
    margin: string;
    marginCompact: string;
    marginStandard: string;
    marginWide: string;
    pageMode: string;
    pageModeScroll: string;
    pageModeSwipe: string;
    autoScrollSpeed: string;
    speedSlow: string;
    speedMedium: string;
    speedFast: string;
    autoScrollHint: string;
    font: string;
    fontSystem: string;
    fontSerif: string;
    fontSans: string;
    fontKai: string;
    fontMono: string;
    themeNight: string;
    themeDay: string;
    themeGreen: string;
    themeGray: string;
    themeWhite: string;
    tocLabel: string;
    bookmarkLabel: string;
    noBookmarks: string;
    addBookmarkHint: string;
    removeBookmark: string;
    copy: string;
    highlight: string;
    note: string;
    addNote: string;
    writeThoughts: string;
    save: string;
    cancel: string;
    ttsPause: string;
    ttsResume: string;
    ttsStop: string;
    ttsSpeed: string;
    ttsPaused: string;
    ttsReading: string;
    autoScrolling: string;
    searchPlaceholder: string;
    search: string;
    searchCancel: string;
    searchingAll: string;
    searchChapterCount: string;
    noSearchResults: string;
    searchFoundMatches: string;
    searchMatches: string;
    searchHint: string;
    searchShortcut: string;
    copied: string;
  };
  readerToolbar: {
    single: string;
    double: string;
    webtoon: string;
    text: string;
    rtl: string;
    ltr: string;
    ttb: string;
    dayMode: string;
    nightMode: string;
    settings: string;
    autoPage: string;
    autoPageStop: string;
  };
  readerOptions: {
    title: string;
    autoSaveHint: string;
    groupDisplay: string;
    groupAdvanced: string;
    groupBehavior: string;
    fitMode: string;
    fitContainer: string;
    fitWidth: string;
    fitHeight: string;
    containerWidth: string;
    containerWidthPlaceholder: string;
    apply: string;
    pageRendering: string;
    singlePage: string;
    doublePage: string;
    readingDirection: string;
    ltr: string;
    rtl: string;
    preloadCount: string;
    header: string;
    headerVisible: string;
    headerHidden: string;
    defaultOverlay: string;
    defaultOverlayDesc: string;
    enable: string;
    disable: string;
    progressTracking: string;
    progressTrackingDesc: string;
    ttb: string;
    autoPageInterval: string;
    autoPageIntervalDesc: string;
    showTranslate: string;
    showTranslateDesc: string;
    showAIChat: string;
    showAIChatDesc: string;
  };
  duration: {
    seconds: string;
    minutes: string;
    hours: string;
    shortSeconds: string;
    shortMinutes: string;
    shortHours: string;
  };
  auth: {
    setupTitle: string;
    setupDesc: string;
    loginTitle: string;
    registerTitle: string;
    username: string;
    password: string;
    nickname: string;
    login: string;
    register: string;
    logout: string;
    settings: string;
    createAccount: string;
    hasAccount: string;
    noAccount: string;
  };
  metadata: {
    searchPlaceholder: string;
    search: string;
    scanArchive: string;
    scanNovel: string;
    noResults: string;
    apply: string;
    applied: string;
    appliedFromArchive: string;
    appliedFromNovelScan: string;
    noEpubMetadata: string;
    noComicInfo: string;
    author: string;
    publisher: string;
    year: string;
    description: string;
    genre: string;
    language: string;
    metadataSource: string;
    scrapeMetadata: string;
    selectSources: string;
    sources: {
      anilist: string;
      anilist_novel: string;
      bangumi: string;
      bangumi_novel: string;
      mangadex: string;
      mangaupdates: string;
      kitsu: string;
      googlebooks: string;
      comicinfo: string;
      epub_opf: string;
    };
    translateMetadata: string;
    translatingMetadata: string;
    editMetadata: string;
    editingMetadata: string;
  };
  recommend: {
    title: string;
    refresh: string;
    seeMore: string;
    similar: string;
    tagMatch: string;
    genreMatch: string;
    sameAuthor: string;
    highlyRated: string;
    unread: string;
    similarTags: string;
    similarGenre: string;
    sameCategory: string;
    semanticMatch: string;
    aiReasonLoading: string;
    aiReasonGenerate: string;
  };
  settings: {
    title: string;
    ai: string;
    about: string;
    groupGeneral: string;
    groupData: string;
    aboutDesc: string;
    aboutSlogan: string;
    aboutTechStack: string;
  };
  errorLogs: {
    tab: string;
    title: string;
    autoRefresh: string;
    refresh: string;
    clear: string;
    confirmClear: string;
    statistics: string;
    statusDistribution: string;
    topPaths: string;
    filtering: string;
    loading: string;
    noLogs: string;
    noLogsHint: string;
    pageInfo: string;
    prevPage: string;
    nextPage: string;
    export: string;
    exportJSON: string;
    exportCSV: string;
    exporting: string;
  };
  siteSettings: {
    tab: string;
    title: string;
    siteName: string;
    siteNameDesc: string;
    comicsDir: string;
    comicsDirDesc: string;
    comicsDirsMergedDesc: string;
    primaryDir: string;
    extraDirs: string;
    extraDirsDesc: string;
    extraDirPlaceholder: string;
    browseDir: string;
    selectDir: string;
    parentDir: string;
    emptyDir: string;
    browseDirTitle: string;
    currentPath: string;
    browseError: string;
    permissionFixTitle: string;
    thumbnailSize: string;
    width: string;
    height: string;
    thumbnailDesc: string;
    thumbManage: string;
    thumbTotal: string;
    thumbExisting: string;
    thumbMissing: string;
    thumbGenerateMissing: string;
    thumbRegenerateAll: string;
    thumbGenerated: string;
    thumbRegenerated: string;
    cacheManage: string;
    clearThumbnails: string;
    clearSearch: string;
    cacheDesc: string;
    cleanupInvalid: string;
    cleanupInvalidDesc: string;
    cleanupInvalidBtn: string;
    cleanupRunning: string;
    cleanupDone: string;
    batchMetadata: string;
    batchMetadataDesc: string;
    batchMissing: string;
    batchAll: string;
    batchComplete: string;
    batchSuccess: string;
    batchFailed: string;
    batchSkipped: string;
    batchTranslateMetadata: string;
    batchTranslateMetadataDesc: string;
    startBatchTranslate: string;
    batchTranslateComplete: string;
    pageSize: string;
    pageSizeDesc: string;
    language: string;
    langAuto: string;
    theme: string;
    themeDark: string;
    themeLight: string;
    themeSystem: string;
    defaultReadingMode: string;
    defaultReadingModeDesc: string;
    modeSingle: string;
    modeDouble: string;
    modeWebtoon: string;
    saved: string;
    restartHint: string;
  };
  ai: {
    title: string;
    cloudAI: string;
    provider: string;
    compatible: string;
    model: string;
    testConnection: string;
    testing: string;
    connectionSuccess: string;
    connectionFailed: string;
    saving: string;
    saveSettings: string;
    internationalProviders: string;
    chinaProviders: string;
    customProvider: string;
    visionSupported: string;
    textOnly: string;
    presetModels: string;
    fetchModels: string;
    manualInput: string;
    manualModelPlaceholder: string;
    modelsFetched: string;
    noModelsFound: string;
    maxTokens: string;
    maxTokensHint: string;
    maxRetries: string;
    maxRetriesHint: string;
    advancedSettings: string;
    usage: string;
    totalCalls: string;
    successCalls: string;
    failedCalls: string;
    totalTokens: string;
    promptTokens: string;
    outputTokens: string;
    avgDuration: string;
    resetUsage: string;
    resetUsageConfirm: string;
    noUsageData: string;
    scenario: string;
    recentCalls: string;
    duration: string;
  };
  duplicates: {
    title: string;
    detect: string;
    detecting: string;
    noDuplicates: string;
    foundGroups: string;
    sameFile: string;
    sameSize: string;
    sameName: string;
    partialHash: string;
    fuzzyName: string;
    fileSize: string;
    pageCount: string;
    addedAt: string;
    keepThis: string;
    deleteThis: string;
    close: string;
    confirmDelete: string;
    confirmDeleteMsg: string;
    keepSelected: string;
    deleteAllDuplicates: string;
    deletingAll: string;
    confirmDeleteAll: string;
    confirmDeleteAllMsg: string;
    deletedCount: string;
    selectToKeep: string;
    confidence: string;
    details: string;
    compareCover: string;
    filterAll: string;
  };
  continueReading: {
    title: string;
    justNow: string;
    minutesAgo: string;
    hoursAgo: string;
    daysAgo: string;
    chapter: string;
    chapterUnit: string;
    pageUnit: string;
    collapse: string;
    expand: string;
  };
  mobileNav: {
    library: string;
    stats: string;
  };
  statsEnhanced: {
    streak: string;
    days: string;
    longest: string;
    today: string;
    thisWeek: string;
    speed: string;
    pagesPerHour: string;
    tabOverview: string;
    tabDaily: string;
    tabMonthly: string;
    tabGenre: string;
    dailyChart: string;
    monthlyTrend: string;
    genrePreference: string;
    sessionsUnit: string;
    comicsUnit: string;
    aiInsight?: string;
    aiInsightGenerating?: string;
    aiInsightError?: string;
    aiInsightEmpty?: string;
  };
  contentTab: {
    all: string;
    comic: string;
    novel: string;
  };
  dataExport: {
    title: string;
    jsonFull: string;
    csvComics: string;
    csvSessions: string;
    uploadFiles: string;
    scanDirs: string;
    clearFilters: string;
  };
  readingGoal: {
    title: string;
    daily: string;
    weekly: string;
    minutes: string;
    books: string;
    setGoal: string;
    achieved: string;
    editGoal: string;
    deleteGoal: string;
  };
  comicGroup: {
    title: string;
    groups: string;
    createGroup: string;
    editGroup: string;
    deleteGroup: string;
    groupName: string;
    groupNamePlaceholder: string;
    addToGroup: string;
    removeFromGroup: string;
    volumes: string;
    totalPages: string;
    totalReadTime: string;
    autoDetect: string;
    autoDetecting: string;
    autoDetectDesc: string;
    foundSuggestions: string;
    noSuggestions: string;
    createAll: string;
    createSelected: string;
    created: string;
    confirmDelete: string;
    confirmDeleteMsg: string;
    emptyGroup: string;
    mergeSelected: string;
    viewGroup: string;
    backToLibrary: string;
    continueReading: string;
    volumeIndex: string;
    dragToReorder: string;
    noGroups: string;
    noGroupsHint: string;
    aiEnhanceDetect?: string;
    aiDetecting?: string;
    searchComicHint: string;
    searchGroupHint: string;
    noMatchGroup: string;
    deleteSuccess?: string;
  };
  collections?: {
    title: string;
    navTitle: string;
    loading: string;
    refresh: string;
    filterAll: string;
    filterComic: string;
    filterNovel: string;
    sortByName: string;
    sortByCount: string;
    sortByUpdated: string;
    sortByCreated: string;
    works: string;
    emptyTitle: string;
    emptyHint: string;
    emptySearchHint: string;
    createTitle: string;
    viewDetail: string;
    batchMode: string;
    batchModeExit: string;
    selectAll: string;
    deselectAll: string;
    selectedCount: string;
    batchDelete: string;
    batchMerge: string;
    batchExport: string;
    batchDeleteConfirm: string;
    batchDeleteMsg: string;
    batchDeleteSuccess: string;
    mergeTitle: string;
    mergeHint: string;
    mergeNameLabel: string;
    mergeNamePlaceholder: string;
    mergeSuccess: string;
    mergeNeedTwo: string;
    exportSuccess: string;
    exportFailed: string;
    totalWorks: string;
  };
  series: {
    nextVolume: string;
    prevVolume: string;
    volumes: string;
  };
  scraper?: {
    title: string;
    subtitle: string;
    statsTotal: string;
    statsWithMeta: string;
    statsMissing: string;
    completionRate: string;
    operationTitle: string;
    modeLabel: string;
    modeStandard: string;
    modeStandardDesc: string;
    modeAI: string;
    modeAIDesc: string;
    scopeLabel: string;
    scopeMissing: string;
    scopeAll: string;
    startBtn: string;
    stopBtn: string;
    refreshStats: string;
    progressTitle: string;
    progressDone: string;
    progressRemaining: string;
    stepRecognize: string;
    stepParse: string;
    stepSearch: string;
    stepApply: string;
    stepAIComplete: string;
    stepProcessing: string;
    resultSuccess: string;
    resultFailed: string;
    resultTotal: string;
    resultListTitle: string;
    emptyTitle: string;
    emptyDesc: string;
    navEntry: string;
    updateTitleLabel: string;
    updateTitleDesc: string;
    tabScrape: string;
    tabLibrary: string;
    libSearchPlaceholder: string;
    libFilterLabel: string;
    libFilterAll: string;
    libFilterMissing: string;
    libFilterWith: string;
    libTypeAll: string;
    libTypeComic: string;
    libTypeNovel: string;
    libSelectAll: string;
    libDeselectAll: string;
    libSelected: string;
    libItems: string;
    libScrapeSelected: string;
    libClearMeta: string;
    libCancel: string;
    libEmpty: string;
    libNoMeta: string;
    libTotalItems: string;
    detailTitle: string;
    detailNoMeta: string;
    detailSearchTitle: string;
    detailSearchDesc: string;
    modeStandardShort: string;
    modeAIShort: string;
    rightPanelHint: string;
    rightPanelDesc: string;
    paginationPerPage: string;
    paginationUnit: string;
    paginationFirst: string;
    paginationLast: string;
    paginationGoto: string;
    paginationPage: string;
    editTitleHint: string;
    saveTitle: string;
    cancelEdit: string;
    deleteTag: string;
    batchEditBtn: string;
    batchEditTitle: string;
    batchEditList: string;
    batchEditChanged: string;
    batchEditUndo: string;
    batchEditOldName: string;
    batchEditSaving: string;
    batchEditSaveBtn: string;
    batchEditSaved: string;
    aiRenameTitle: string;
    aiRenameDesc: string;
    aiRenamePlaceholder: string;
    aiRenameBtn: string;
    aiRenameLoading: string;
    applyAllTitle: string;
    applyAllPlaceholder: string;
    applyBtn: string;
    sortBy: string;
    sortByTitle: string;
    sortByFileSize: string;
    sortByUpdatedAt: string;
    sortByMetaStatus: string;
    aiChatTitle: string;
    aiChatSubtitle: string;
    aiChatPlaceholder: string;
    aiChatSend: string;
    aiChatClear: string;
    aiChatClose: string;
    aiChatEmpty: string;
    aiChatEmptyDesc: string;
    aiChatQuickScrapeAll: string;
    aiChatQuickSetAI: string;
    aiChatQuickStats: string;
    aiChatQuickHelp: string;
    aiChatQuickSelectAll: string;
    aiChatQuickFilter: string;
    aiChatCmdSuccess: string;
    aiChatCmdFailed: string;
    aiChatStopped: string;
    aiChatBtnLabel: string;
    guideWelcomeTitle: string;
    guideWelcomeDesc: string;
    guideFilterTitle: string;
    guideFilterDesc: string;
    guideFilterAction: string;
    guideListTitle: string;
    guideListDesc: string;
    guideListAction: string;
    guideSelectTitle: string;
    guideSelectDesc: string;
    guideSelectAction: string;
    guideScrapeTitle: string;
    guideScrapeDesc: string;
    guideScrapeAction: string;
    guideAIChatTitle: string;
    guideAIChatDesc: string;
    guideAIChatAction: string;
    guideNext: string;
    guidePrev: string;
    guideSkip: string;
    guideFinish: string;
    guideStepOf: string;
    guideRestartBtn: string;
    helpTitle: string;
    helpSearchPlaceholder: string;
    helpNoResults: string;
    helpFaqTitle: string;
    helpTipsTitle: string;
    helpTroubleshootTitle: string;
    helpFaq1Q: string;
    helpFaq1A: string;
    helpFaq2Q: string;
    helpFaq2A: string;
    helpFaq3Q: string;
    helpFaq3A: string;
    helpFaq4Q: string;
    helpFaq4A: string;
    helpFaq5Q: string;
    helpFaq5A: string;
    helpTip1: string;
    helpTip2: string;
    helpTip3: string;
    helpTip4: string;
    helpTip5: string;
    helpTrouble1Q: string;
    helpTrouble1A: string;
    helpTrouble2Q: string;
    helpTrouble2A: string;
    helpTrouble3Q: string;
    helpTrouble3A: string;
    // 合集管理
    collectionTitle: string;
    collectionDesc: string;
    collectionEmpty: string;
    collectionEmptyHint: string;
    collectionCreate: string;
    collectionCreatePlaceholder: string;
    collectionAutoDetect: string;
    collectionAutoDetectDesc: string;
    collectionAutoEmpty: string;
    collectionAutoApplyAll: string;
    collectionAutoApplySelected: string;
    collectionSuggestions: string;
    collectionItemCount: string;
    collectionEdit: string;
    collectionDelete: string;
    collectionDeleteConfirm: string;
    collectionAddSelected: string;
    collectionAddToGroup: string;
    collectionAddToNew: string;
    collectionRemoveItem: string;
    collectionReorder: string;
    collectionBack: string;
    collectionScrapeAll: string;
    collectionMoveUp: string;
    collectionMoveDown: string;
    collectionNoName: string;
    collectionCreated: string;
    collectionUpdated: string;
    collectionDeleted: string;
    collectionItemAdded: string;
    collectionItemRemoved: string;
  };
}
