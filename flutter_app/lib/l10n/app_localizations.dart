import 'package:flutter/material.dart';

/// 应用国际化支持
/// 基于轻量级自定义方案，不依赖额外的 l10n 包
class AppLocalizations {
  final Locale locale;

  AppLocalizations(this.locale);

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations) ??
        AppLocalizations(const Locale('zh'));
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  static const List<Locale> supportedLocales = [
    Locale('zh'), // 简体中文
    Locale('en'), // English
  ];

  /// 获取当前语言的翻译表
  Map<String, String> get _localizedStrings {
    switch (locale.languageCode) {
      case 'en':
        return _enStrings;
      case 'zh':
      default:
        return _zhStrings;
    }
  }

  /// 获取翻译文本，找不到时返回 key
  String translate(String key) {
    return _localizedStrings[key] ?? key;
  }

  // ============================================================
  // 通用
  // ============================================================
  String get appTitle => translate('app_title');
  String get cancel => translate('cancel');
  String get confirm => translate('confirm');
  String get save => translate('save');
  String get delete => translate('delete');
  String get edit => translate('edit');
  String get create => translate('create');
  String get refresh => translate('refresh');
  String get search => translate('search');
  String get close => translate('close');
  String get loading => translate('loading');
  String get noData => translate('no_data');
  String get error => translate('error');
  String get retry => translate('retry');
  String get selectAll => translate('select_all');
  String get batchDelete => translate('batch_delete');

  // ============================================================
  // 导航
  // ============================================================
  String get navHome => translate('nav_home');
  String get navSearch => translate('nav_search');
  String get navStats => translate('nav_stats');
  String get navSettings => translate('nav_settings');

  // ============================================================
  // 首页
  // ============================================================
  String get sortAddedAt => translate('sort_added_at');
  String get sortTitle => translate('sort_title');
  String get sortLastRead => translate('sort_last_read');
  String get sortRating => translate('sort_rating');
  String get sortPageCount => translate('sort_page_count');
  String get filterAll => translate('filter_all');
  String get filterComic => translate('filter_comic');
  String get filterNovel => translate('filter_novel');
  String get filterFavorites => translate('filter_favorites');
  String get noContent => translate('no_content');

  // ============================================================
  // 设置
  // ============================================================
  String get settings => translate('settings');
  String get account => translate('account');
  String get admin => translate('admin');
  String get user => translate('user');
  String get serverAddress => translate('server_address');
  String get serverInfo => translate('server_info');
  String get about => translate('about');
  String get version => translate('version');
  String get dataManagement => translate('data_management');
  String get batchScrapeMetadata => translate('batch_scrape_metadata');
  String get batchScrapeDesc => translate('batch_scrape_desc');
  String get logout => translate('logout');
  String get logoutConfirm => translate('logout_confirm');
  String get switchServer => translate('switch_server');
  String get tagManager => translate('tag_manager');
  String get favorites => translate('favorites');

  // ============================================================
  // 标签管理
  // ============================================================
  String get tagManagerTitle => translate('tag_manager_title');
  String get tags => translate('tags');
  String get categories => translate('categories');
  String get searchTags => translate('search_tags');
  String get searchCategories => translate('search_categories');
  String get noTags => translate('no_tags');
  String get noCategories => translate('no_categories');
  String get noMatchingTags => translate('no_matching_tags');
  String get noMatchingCategories => translate('no_matching_categories');
  String get renameTag => translate('rename_tag');
  String get changeColor => translate('change_color');
  String get selectColor => translate('select_color');
  String get tagName => translate('tag_name');
  String get enterNewName => translate('enter_new_name');
  String get mergeTags => translate('merge_tags');
  String get mergeTagsDesc => translate('merge_tags_desc');
  String get createCategory => translate('create_category');
  String get categoryName => translate('category_name');
  String get editCategory => translate('edit_category');
  String get confirmDelete => translate('confirm_delete');
  String get deleteIrreversible => translate('delete_irreversible');

  // ============================================================
  // 收藏
  // ============================================================
  String get myFavorites => translate('my_favorites');
  String get noFavorites => translate('no_favorites');
  String get browsAndAdd => translate('brows_and_add');
  String get removedFromFavorites => translate('removed_from_favorites');

  // ============================================================
  // 认证
  // ============================================================
  String get login => translate('login');
  String get register => translate('register');
  String get username => translate('username');
  String get password => translate('password');
  String get nickname => translate('nickname');
  String get loginFailed => translate('login_failed');
  String get registerFailed => translate('register_failed');
  String get serverConfig => translate('server_config');
  String get cannotConnectServer => translate('cannot_connect_server');

  // ============================================================
  // 阅读器
  // ============================================================
  String get novel => translate('novel');
  String get viewChapterRecap => translate('view_chapter_recap');
  String get chapterRecapTitle => translate('chapter_recap_title');
  String get generatingChapterRecap => translate('generating_chapter_recap');
  String get noChapterRecap => translate('no_chapter_recap');
  String get chapterRecapFailed => translate('chapter_recap_failed');
  String get regenerate => translate('regenerate');
  String get collapse => translate('collapse');
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) {
    return ['zh', 'en'].contains(locale.languageCode);
  }

  @override
  Future<AppLocalizations> load(Locale locale) async {
    return AppLocalizations(locale);
  }

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

// ============================================================
// 简体中文翻译
// ============================================================
const Map<String, String> _zhStrings = {
  // 通用
  'app_title': 'NowenReader',
  'cancel': '取消',
  'confirm': '确定',
  'save': '保存',
  'delete': '删除',
  'edit': '编辑',
  'create': '创建',
  'refresh': '刷新',
  'search': '搜索',
  'close': '关闭',
  'loading': '加载中...',
  'no_data': '暂无数据',
  'error': '出错了',
  'retry': '重试',
  'select_all': '全选',
  'batch_delete': '批量删除',

  // 导航
  'nav_home': '首页',
  'nav_search': '搜索',
  'nav_stats': '统计',
  'nav_settings': '设置',

  // 首页
  'sort_added_at': '添加时间',
  'sort_title': '标题',
  'sort_last_read': '最近阅读',
  'sort_rating': '评分',
  'sort_page_count': '页数',
  'filter_all': '全部',
  'filter_comic': '漫画',
  'filter_novel': '小说',
  'filter_favorites': '⭐ 收藏',
  'no_content': '暂无内容',

  // 设置
  'settings': '设置',
  'account': '账户',
  'admin': '管理员',
  'user': '普通用户',
  'server_address': '服务器地址',
  'server_info': '服务器信息',
  'about': '关于',
  'version': '版本',
  'data_management': '数据管理',
  'batch_scrape_metadata': '批量刮削元数据',
  'batch_scrape_desc': '从在线数据源自动获取元数据',
  'logout': '退出登录',
  'logout_confirm': '确定要退出登录吗？',
  'switch_server': '切换服务器',
  'tag_manager': '标签与分类管理',
  'favorites': '我的收藏',

  // 标签管理
  'tag_manager_title': '标签与分类管理',
  'tags': '标签',
  'categories': '分类',
  'search_tags': '搜索标签...',
  'search_categories': '搜索分类...',
  'no_tags': '暂无标签',
  'no_categories': '暂无分类',
  'no_matching_tags': '未找到匹配的标签',
  'no_matching_categories': '未找到匹配的分类',
  'rename_tag': '重命名标签',
  'change_color': '修改颜色',
  'select_color': '选择颜色',
  'tag_name': '标签名称',
  'enter_new_name': '输入新名称',
  'merge_tags': '合并标签',
  'merge_tags_desc': '选择要保留的目标标签（其他标签将合并到该标签）：',
  'create_category': '新建分类',
  'category_name': '分类名称',
  'edit_category': '编辑分类',
  'confirm_delete': '确认删除',
  'delete_irreversible': '此操作不可撤销。',

  // 收藏
  'my_favorites': '我的收藏',
  'no_favorites': '暂无收藏',
  'brows_and_add': '浏览书架并添加收藏',
  'removed_from_favorites': '已取消收藏',

  // 认证
  'login': '登录',
  'register': '注册',
  'username': '用户名',
  'password': '密码',
  'nickname': '昵称',
  'login_failed': '登录失败',
  'register_failed': '注册失败',
  'server_config': '服务器配置',
  'cannot_connect_server': '无法连接到服务器',

  // 阅读器
  'novel': '小说',
  'view_chapter_recap': '查看前情提要',
  'chapter_recap_title': '前情提要',
  'generating_chapter_recap': '生成前情提要中...',
  'no_chapter_recap': '暂无前情提要',
  'chapter_recap_failed': '生成前情提要失败',
  'regenerate': '重新生成',
  'collapse': '收起',
};

// ============================================================
// English 翻译
// ============================================================
const Map<String, String> _enStrings = {
  // Common
  'app_title': 'NowenReader',
  'cancel': 'Cancel',
  'confirm': 'OK',
  'save': 'Save',
  'delete': 'Delete',
  'edit': 'Edit',
  'create': 'Create',
  'refresh': 'Refresh',
  'search': 'Search',
  'close': 'Close',
  'loading': 'Loading...',
  'no_data': 'No data',
  'error': 'Error',
  'retry': 'Retry',
  'select_all': 'Select All',
  'batch_delete': 'Batch Delete',

  // Navigation
  'nav_home': 'Home',
  'nav_search': 'Search',
  'nav_stats': 'Stats',
  'nav_settings': 'Settings',

  // Home
  'sort_added_at': 'Date Added',
  'sort_title': 'Title',
  'sort_last_read': 'Last Read',
  'sort_rating': 'Rating',
  'sort_page_count': 'Pages',
  'filter_all': 'All',
  'filter_comic': 'Comics',
  'filter_novel': 'Novels',
  'filter_favorites': '⭐ Favorites',
  'no_content': 'No content',

  // Settings
  'settings': 'Settings',
  'account': 'Account',
  'admin': 'Admin',
  'user': 'User',
  'server_address': 'Server Address',
  'server_info': 'Server Info',
  'about': 'About',
  'version': 'Version',
  'data_management': 'Data Management',
  'batch_scrape_metadata': 'Batch Scrape Metadata',
  'batch_scrape_desc': 'Auto-fetch metadata from online sources',
  'logout': 'Log Out',
  'logout_confirm': 'Are you sure you want to log out?',
  'switch_server': 'Switch Server',
  'tag_manager': 'Tags & Categories',
  'favorites': 'My Favorites',

  // Tag Manager
  'tag_manager_title': 'Tags & Categories',
  'tags': 'Tags',
  'categories': 'Categories',
  'search_tags': 'Search tags...',
  'search_categories': 'Search categories...',
  'no_tags': 'No tags',
  'no_categories': 'No categories',
  'no_matching_tags': 'No matching tags',
  'no_matching_categories': 'No matching categories',
  'rename_tag': 'Rename Tag',
  'change_color': 'Change Color',
  'select_color': 'Select Color',
  'tag_name': 'Tag Name',
  'enter_new_name': 'Enter new name',
  'merge_tags': 'Merge Tags',
  'merge_tags_desc': 'Select the target tag to keep (others will be merged into it):',
  'create_category': 'New Category',
  'category_name': 'Category Name',
  'edit_category': 'Edit Category',
  'confirm_delete': 'Confirm Delete',
  'delete_irreversible': 'This action cannot be undone.',

  // Favorites
  'my_favorites': 'My Favorites',
  'no_favorites': 'No favorites yet',
  'brows_and_add': 'Browse and add favorites',
  'removed_from_favorites': 'Removed from favorites',

  // Auth
  'login': 'Log In',
  'register': 'Register',
  'username': 'Username',
  'password': 'Password',
  'nickname': 'Nickname',
  'login_failed': 'Login failed',
  'register_failed': 'Registration failed',
  'server_config': 'Server Configuration',
  'cannot_connect_server': 'Cannot connect to server',

  // Reader
  'novel': 'Novel',
  'view_chapter_recap': 'Previously On...',
  'chapter_recap_title': 'Previously On...',
  'generating_chapter_recap': 'Generating recap...',
  'no_chapter_recap': 'No recap available',
  'chapter_recap_failed': 'Failed to generate recap',
  'regenerate': 'Regenerate',
  'collapse': 'Collapse',
};
