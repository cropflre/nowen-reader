import type { Translations } from "./zh-CN";

const en: Translations = {
  // Common
  common: {
    confirm: "Confirm",
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    back: "Back",
    all: "All",
    loading: "Loading...",
    noData: "No data",
  },

  // Navbar
  navbar: {
    searchPlaceholder: "Search comics by title, tag or author...",
    selectAll: "Select All",
    batch: "Batch",
    exitBatch: "Exit Batch",
    upload: "Upload",
    uploading: "Uploading...",
    stats: "Reading Stats",
  },

  // Home page
  home: {
    mockDataNotice: "Currently showing mock data. Place",
    mockDataNotice2: "comic files in the",
    mockDataNotice3: "directory, or click upload to add comics.",
    favorites: "Favorites",
    sortByTitle: "By Title",
    sortByLastRead: "By Last Read",
    sortByRating: "By Rating",
    sortByCustom: "Custom Order",
    ascending: "Ascending",
    descending: "Descending",
    emptyLibrary: "Library is empty",
    noMatchingComics: "No matching comics found",
    emptyLibraryHint: "Click upload or place .zip/.cbz files in the comics/ directory",
    noMatchingHint: "Try different keywords or clear tag filters",
    uploadFailed: "Upload failed, please retry",
    firstPage: "First Page",
    prevPage: "Previous Page",
    nextPage: "Next Page",
    lastPage: "Last Page",
  },

  // Stats Bar
  statsBar: {
    total: "Total",
    unit: "",
    filtered: "Filtered",
    recentUpdate: "Recently Updated",
  },

  // Tag Filter
  tagFilter: {
    label: "Tags",
  },

  // Group Filter
  groupFilter: {
    label: "Groups",
    ungrouped: "Ungrouped",
  },

  // Batch Toolbar
  batch: {
    selected: "Selected",
    items: "items",
    favorite: "Favorite",
    unfavorite: "Unfavorite",
    tags: "Tags",
    group: "Group",
    tagInputPlaceholder: "Enter tags (comma separated), press Enter...",
    groupInputPlaceholder: "Enter group name, leave empty to ungroup...",
    confirmDelete: "Confirm Delete",
    confirmDeleteMsg: "Are you sure you want to delete {count} selected comics? This cannot be undone.",
  },

  // Comic Card
  comicCard: {
    detail: "Details",
  },

  // Comic Detail Page
  comicDetail: {
    comicNotFound: "Comic not found",
    backToShelf: "Back to Shelf",
    continueReading: "Continue Reading (Page {page})",
    startReading: "Start Reading",
    deleteComic: "Delete Comic",
    rating: "Rating",
    pages: "Pages",
    fileSize: "File Size",
    addedAt: "Added",
    readTime: "Read Time",
    readProgress: "Progress",
    lastRead: "Last Read",
    tagsLabel: "Tags",
    noTags: "No tags",
    addTagPlaceholder: "Add tag...",
    groupLabel: "Group",
    ungrouped: "Ungrouped",
    clickToEdit: "(click to edit)",
    groupInputPlaceholder: "Enter group name...",
    confirmDelete: "Confirm Delete",
    confirmDeleteMsg: "Are you sure you want to delete \"{title}\"? This will also delete the file on disk and cannot be undone.",
  },

  // Stats Page
  stats: {
    title: "Reading Stats",
    totalReadTime: "Total Read Time",
    readingSessions: "Sessions",
    comicsRead: "Comics Read",
    dailyChart: "Last 30 Days Reading Time",
    recentRecords: "Recent Reading Records",
    noRecords: "No reading records yet",
    cannotLoadStats: "Cannot load statistics",
    page: "Page",
    pageArrow: "→",
    pageSuffix: "",
  },

  // Reader Page
  reader: {
    unknownComic: "Unknown Comic",
    comicNotFound: "Comic not found",
    backToShelf: "Back to Shelf",
    favorited: "Favorited",
    addFavorite: "Add Favorite",
    rating: "Rating",
    tagsLabel: "Tags",
    noTags: "No tags",
    addTagPlaceholder: "Add tag...",
    readingInfo: "Reading Info",
    currentPage: "Current Page",
    readProgress: "Progress",
    lastRead: "Last Read",
    shortcuts: "Shortcuts",
    turnPage: "Turn Page",
    fullscreen: "Fullscreen",
    infoPanel: "Info Panel",
    goBack: "Back",
    reachedLastPage: "Reached the last page",
  },

  // Reader Toolbar
  readerToolbar: {
    single: "Single",
    double: "Double",
    webtoon: "Scroll",
    rtl: "R→L",
    ltr: "L→R",
    dayMode: "Day",
    nightMode: "Night",
  },

  // Duration formatting
  duration: {
    seconds: "{n}s",
    minutes: "{m}m {s}s",
    hours: "{h}h {m}m",
    shortSeconds: "{n}s",
    shortMinutes: "{n}m",
    shortHours: "{n}h",
  },

  // Auth
  auth: {
    setupTitle: "Create Admin Account",
    setupDesc: "Set up the first administrator account to get started",
    loginTitle: "Sign In",
    registerTitle: "Create Account",
    username: "Username",
    password: "Password",
    nickname: "Nickname (optional)",
    login: "Login",
    register: "Register",
    logout: "Logout",
    settings: "Settings",
    createAccount: "Create Account",
    hasAccount: "Already have an account? Sign in",
    noAccount: "Don't have an account? Register",
  },

  // Metadata
  metadata: {
    searchPlaceholder: "Search metadata...",
    search: "Search",
    scanArchive: "Scan archive for ComicInfo.xml",
    noResults: "No results found",
    apply: "Apply",
    applied: "Applied",
    appliedFromArchive: "Metadata applied from ComicInfo.xml",
    author: "Author",
    publisher: "Publisher",
    year: "Year",
    description: "Description",
    genre: "Genre",
    series: "Series",
    language: "Language",
    metadataSource: "Source",
    scrapeMetadata: "Scrape Metadata",
  },

  // PWA
  pwa: {
    installTitle: "Install NowenReader",
    installDesc: "Add to home screen for a better experience",
    install: "Install",
    updateAvailable: "Update Available",
    updateDesc: "A new version is ready",
    update: "Update",
    appSettings: "App Settings",
    installStatus: "Install Status",
    installed: "Installed",
    notInstalled: "Not installed",
    offlineSupport: "Offline Support",
    enabled: "Enabled",
    clearCache: "Clear Offline Cache",
    cacheCleared: "Cache cleared",
  },

  // Cloud Sync
  sync: {
    title: "Cloud Sync",
    export: "Export Data",
    import: "Import Data",
    syncNow: "Sync Now",
    syncing: "Syncing...",
    syncComplete: "Sync complete",
    syncFailed: "Sync failed",
    itemsUpdated: "items updated",
    lastSync: "Last sync",
    webdavUrl: "WebDAV URL",
    username: "Username",
    password: "Password",
    testConnection: "Test Connection",
    testing: "Testing...",
    connectionSuccess: "Connection successful",
    connectionFailed: "Connection failed",
    exportSuccess: "Data exported",
    exportFailed: "Export failed",
    importSuccess: "Imported",
    importFailed: "Import failed",
  },

  // Recommendations
  recommend: {
    title: "Recommended for You",
    refresh: "Refresh",
    seeMore: "See more",
    similar: "Similar Comics",
    tagMatch: "Similar tags",
    genreMatch: "Similar genre",
    sameAuthor: "Same author",
    seriesContinuation: "Series continuation",
    seriesInProgress: "Continue series",
    highlyRated: "Highly rated",
    unread: "Unread",
    similarTags: "Similar tags",
    similarGenre: "Similar genre",
    sameSeries: "Same series",
    sameGroup: "Same group",
  },

  // Plugins
  plugins: {
    title: "Plugins",
    noPlugins: "No plugins installed",
    author: "Author",
    permissions: "Permissions",
    settings: "Settings",
  },

  // Settings
  settings: {
    title: "Settings",
    sync: "Sync",
    plugins: "Plugins",
    pwa: "App",
    about: "About",
  },

  // Duplicates
  duplicates: {
    title: "Duplicate Detection",
    detect: "Find Duplicates",
    detecting: "Detecting...",
    noDuplicates: "No duplicates found",
    foundGroups: "Found {count} duplicate groups",
    sameFile: "Identical file content",
    sameSize: "Same file size and page count",
    sameName: "Similar title",
    fileSize: "Size",
    pageCount: "Pages",
    addedAt: "Added",
    keepThis: "Keep",
    deleteThis: "Delete",
    close: "Close",
    confirmDelete: "Confirm Delete",
    confirmDeleteMsg: "Are you sure you want to delete \"{title}\"? This will also delete the file on disk and cannot be undone.",
    keepSelected: "Keep selected",
    deleteAllDuplicates: "Delete All Duplicates",
    deletingAll: "Deleting...",
    confirmDeleteAll: "Confirm Batch Delete",
    confirmDeleteAllMsg: "This will delete {count} duplicate files (keeping one selected per group). This cannot be undone.",
    deletedCount: "Deleted {count} files",
    selectToKeep: "Click to select the item to keep",
  },
};

export default en;
