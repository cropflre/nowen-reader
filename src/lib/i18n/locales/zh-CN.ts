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
  },

  // Group Filter
  groupFilter: {
    label: "分组",
    ungrouped: "未分组",
  },

  // Batch Toolbar
  batch: {
    selected: "已选择",
    items: "项",
    favorite: "收藏",
    unfavorite: "取消收藏",
    tags: "标签",
    group: "分组",
    tagInputPlaceholder: "输入标签 (逗号分隔多个)，回车确认...",
    groupInputPlaceholder: "输入分组名称，留空则取消分组...",
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
    groupLabel: "分组",
    ungrouped: "未分组",
    clickToEdit: "(点击编辑)",
    groupInputPlaceholder: "输入分组名称...",
    confirmDelete: "确认删除",
    confirmDeleteMsg: "确定要删除「{title}」吗？此操作将同时删除磁盘上的文件，不可撤销。",
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
  },

  // Reader Toolbar
  readerToolbar: {
    single: "单页",
    double: "双页",
    webtoon: "长条",
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
    noResults: "未找到结果",
    apply: "应用",
    applied: "已应用",
    appliedFromArchive: "已从 ComicInfo.xml 应用元数据",
    author: "作者",
    publisher: "出版社",
    year: "年份",
    description: "简介",
    genre: "类型",
    series: "系列",
    language: "语言",
    metadataSource: "数据来源",
    scrapeMetadata: "刮削元数据",
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
    sameGroup: "同一分组",
  },

  // Plugins
  plugins: {
    title: "插件",
    noPlugins: "暂无已安装插件",
    author: "作者",
    permissions: "权限",
    settings: "设置",
  },

  // Settings
  settings: {
    title: "设置",
    sync: "同步",
    plugins: "插件",
    pwa: "应用",
    about: "关于",
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
  };
  statsBar: {
    total: string;
    unit: string;
    filtered: string;
    recentUpdate: string;
  };
  tagFilter: {
    label: string;
  };
  groupFilter: {
    label: string;
    ungrouped: string;
  };
  batch: {
    selected: string;
    items: string;
    favorite: string;
    unfavorite: string;
    tags: string;
    group: string;
    tagInputPlaceholder: string;
    groupInputPlaceholder: string;
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
    groupLabel: string;
    ungrouped: string;
    clickToEdit: string;
    groupInputPlaceholder: string;
    confirmDelete: string;
    confirmDeleteMsg: string;
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
  };
  readerToolbar: {
    single: string;
    double: string;
    webtoon: string;
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
    noResults: string;
    apply: string;
    applied: string;
    appliedFromArchive: string;
    author: string;
    publisher: string;
    year: string;
    description: string;
    genre: string;
    series: string;
    language: string;
    metadataSource: string;
    scrapeMetadata: string;
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
    sameGroup: string;
  };
  plugins: {
    title: string;
    noPlugins: string;
    author: string;
    permissions: string;
    settings: string;
  };
  settings: {
    title: string;
    sync: string;
    plugins: string;
    pwa: string;
    about: string;
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
}
