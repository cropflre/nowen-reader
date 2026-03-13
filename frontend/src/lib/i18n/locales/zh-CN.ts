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
    firstPage: "第一页",
    prevPage: "上一页",
    nextPage: "下一页",
    lastPage: "最后一页",
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
    confirmDelete: "确认删除",
    confirmDeleteMsg: "确定要删除选中的 {count} 本漫画吗？此操作不可撤销。",
  },

  // Comic Card
  comicCard: {
    detail: "详情",
  },

  // Comic Detail Page
  comicDetail: {
    comicNotFound: "漫画不存在",
    backToShelf: "返回书架",
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
    backToShelf: "返回书架",
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
  },

  // Reader Toolbar
  readerToolbar: {
    single: "单页",
    double: "双页",
    webtoon: "长条",
    text: "文本",
    rtl: "右→左",
    ltr: "左→右",
    dayMode: "日间",
    nightMode: "夜间",
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
    series: "系列",
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
    seriesIndex: "卷号",
  },

  // PWA
  pwa: {
    installTitle: "安装 NowenReader",
    installDesc: "添加到主屏幕获得更好体验",
    install: "安装",
    updateAvailable: "有新版本可用",
    updateDesc: "新版本已准备就绪",
    update: "更新",
    appSettings: "应用设置",
    installStatus: "安装状态",
    installed: "已安装",
    notInstalled: "未安装",
    offlineSupport: "离线支持",
    enabled: "已启用",
    clearCache: "清除离线缓存",
    cacheCleared: "缓存已清除",
  },

  // Cloud Sync
  sync: {
    title: "云同步",
    export: "导出数据",
    import: "导入数据",
    syncNow: "立即同步",
    syncing: "同步中...",
    syncComplete: "同步完成",
    syncFailed: "同步失败",
    itemsUpdated: "项已更新",
    lastSync: "上次同步",
    webdavUrl: "WebDAV 地址",
    username: "用户名",
    password: "密码",
    testConnection: "测试连接",
    testing: "测试中...",
    connectionSuccess: "连接成功",
    connectionFailed: "连接失败",
    exportSuccess: "数据已导出",
    exportFailed: "导出失败",
    importSuccess: "导入成功",
    importFailed: "导入失败",
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
    seriesContinuation: "系列续集",
    seriesInProgress: "继续阅读",
    highlyRated: "高评分",
    unread: "未读",
    similarTags: "相似标签",
    similarGenre: "相似类型",
    sameSeries: "同一系列",
    sameCategory: "同一分类",
    semanticMatch: "AI 语义匹配",
  },

  // Settings
  settings: {
    title: "设置",
    sync: "同步",
    ai: "AI",
    pwa: "应用",
    about: "关于",
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
    saved: "已保存",
    restartHint: "部分设置需要重启后生效",
  },

  // AI
  ai: {
    title: "AI 功能",
    localAI: "本地 AI",
    cloudAI: "云端 AI",
    perceptualHash: "感知哈希去重",
    perceptualHashDesc: "检测封面视觉相似的重复漫画",
    semanticSearch: "语义搜索",
    semanticSearchDesc: "支持自然语言搜索漫画",
    autoTag: "智能自动标签",
    autoTagDesc: "基于 AI 的标签推荐",
    confidence: "置信度",
    provider: "服务商",
    compatible: "兼容 API",
    model: "模型",
    coverAnalysis: "封面图像分析",
    metadataCompletion: "智能元数据补全",
    testConnection: "测试连接",
    testing: "测试中...",
    connectionSuccess: "连接成功",
    connectionFailed: "连接失败",
    saving: "保存中...",
    saveSettings: "保存设置",
    analyzing: "AI 分析中...",
    analyzeComplete: "分析完成",
    analyzeFailed: "分析失败",
    aiAnalyze: "AI 分析",
    aiComplete: "AI 补全",
    similarCover: "封面视觉相似",
    semanticSearchPlaceholder: "用自然语言描述你想找的漫画...",
    searchResults: "语义搜索结果",
    noAIResults: "未找到匹配结果",
    relevance: "相关度",
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
  },

  // E-Hentai
  ehentai: {
    title: "E-Hentai 浏览",
    search: "搜索",
    searchPlaceholder: "搜索画廊标题、标签...",
    searching: "搜索中...",
    noResults: "未找到结果",
    emptyHint: "输入关键词搜索 E-Hentai 画廊",
    resultsCount: "共 {count} 个结果",
    prevPage: "上一页",
    nextPage: "下一页",
    pageNum: "第 {page} 页",
    pages: "页",
    uploader: "上传者",
    fileCount: "文件数",
    tags: "标签",
    preview: "预览",
    downloadToLibrary: "下载到本地库",
    downloading: "下载中",
    downloadStarting: "准备下载...",
    downloadFetchingInfo: "获取画廊信息...",
    downloadPackaging: "打包 CBZ 中...",
    downloadCompleted: "下载完成",
    downloadError: "下载失败",
    galleryId: "画廊",
    notConfigured: "未配置 E-Hentai",
    notConfiguredDesc: "请在设置中配置 E-Hentai Cookie 以启用此功能。点击右上角用户菜单 → 设置 → E-Hentai。",
  },

  // E-Hentai Settings
  ehentaiSettings: {
    title: "E-Hentai 配置",
    statusConfigured: "已配置",
    statusNotConfigured: "未配置",
    currentConfig: "当前配置",
    description: "从 E-Hentai 登录后的浏览器 Cookie 中获取以下值。打开浏览器开发者工具 → Application → Cookies 查找。",
    keepCurrent: "留空保持当前值",
    optional: "可选，用于 ExHentai",
    save: "保存",
    test: "测试",
    clear: "清除",
    testSuccess: "连接测试成功",
    testFailed: "连接失败，请检查 Cookie 值",
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
  },

  // 书架
  shelf: {
    create: "新建书架",
    namePlaceholder: "书架名称...",
    confirmDeleteShelf: "确定要删除此书架吗？其中的漫画不会被删除。",
    moveTo: "移动到",
    title: "书架",
  },

  // 移动端导航
  mobileNav: {
    shelf: "书架",
    stats: "统计",
    explore: "发现",
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
    firstPage: string;
    prevPage: string;
    nextPage: string;
    lastPage: string;
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
    confirmDelete: string;
    confirmDeleteMsg: string;
  };
  comicCard: {
    detail: string;
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
  };
  readerToolbar: {
    single: string;
    double: string;
    webtoon: string;
    text: string;
    rtl: string;
    ltr: string;
    dayMode: string;
    nightMode: string;
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
    series: string;
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
    seriesIndex: string;
  };
  pwa: {
    installTitle: string;
    installDesc: string;
    install: string;
    updateAvailable: string;
    updateDesc: string;
    update: string;
    appSettings: string;
    installStatus: string;
    installed: string;
    notInstalled: string;
    offlineSupport: string;
    enabled: string;
    clearCache: string;
    cacheCleared: string;
  };
  sync: {
    title: string;
    export: string;
    import: string;
    syncNow: string;
    syncing: string;
    syncComplete: string;
    syncFailed: string;
    itemsUpdated: string;
    lastSync: string;
    webdavUrl: string;
    username: string;
    password: string;
    testConnection: string;
    testing: string;
    connectionSuccess: string;
    connectionFailed: string;
    exportSuccess: string;
    exportFailed: string;
    importSuccess: string;
    importFailed: string;
  };
  recommend: {
    title: string;
    refresh: string;
    seeMore: string;
    similar: string;
    tagMatch: string;
    genreMatch: string;
    sameAuthor: string;
    seriesContinuation: string;
    seriesInProgress: string;
    highlyRated: string;
    unread: string;
    similarTags: string;
    similarGenre: string;
    sameSeries: string;
    sameCategory: string;
    semanticMatch: string;
  };
  settings: {
    title: string;
    sync: string;
    ai: string;
    pwa: string;
    about: string;
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
    saved: string;
    restartHint: string;
  };
  ai: {
    title: string;
    localAI: string;
    cloudAI: string;
    perceptualHash: string;
    perceptualHashDesc: string;
    semanticSearch: string;
    semanticSearchDesc: string;
    autoTag: string;
    autoTagDesc: string;
    confidence: string;
    provider: string;
    compatible: string;
    model: string;
    coverAnalysis: string;
    metadataCompletion: string;
    testConnection: string;
    testing: string;
    connectionSuccess: string;
    connectionFailed: string;
    saving: string;
    saveSettings: string;
    analyzing: string;
    analyzeComplete: string;
    analyzeFailed: string;
    aiAnalyze: string;
    aiComplete: string;
    similarCover: string;
    semanticSearchPlaceholder: string;
    searchResults: string;
    noAIResults: string;
    relevance: string;
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
  };
  ehentai: {
    title: string;
    search: string;
    searchPlaceholder: string;
    searching: string;
    noResults: string;
    emptyHint: string;
    resultsCount: string;
    prevPage: string;
    nextPage: string;
    pageNum: string;
    pages: string;
    uploader: string;
    fileCount: string;
    tags: string;
    preview: string;
    downloadToLibrary: string;
    downloading: string;
    downloadStarting: string;
    downloadFetchingInfo: string;
    downloadPackaging: string;
    downloadCompleted: string;
    downloadError: string;
    galleryId: string;
    notConfigured: string;
    notConfiguredDesc: string;
  };
  ehentaiSettings: {
    title: string;
    statusConfigured: string;
    statusNotConfigured: string;
    currentConfig: string;
    description: string;
    keepCurrent: string;
    optional: string;
    save: string;
    test: string;
    clear: string;
    testSuccess: string;
    testFailed: string;
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
  };
  shelf: {
    create: string;
    namePlaceholder: string;
    confirmDeleteShelf: string;
    moveTo: string;
    title: string;
  };
  mobileNav: {
    shelf: string;
    stats: string;
    explore: string;
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
}
