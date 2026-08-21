import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../data/api/api_client.dart';
import '../../data/api/comic_api.dart';
import '../../data/models/comic.dart';
import '../../data/providers/auth_provider.dart';
import '../../data/providers/comic_provider.dart';
import '../../widgets/authenticated_image.dart';
import '../../widgets/animations.dart';

/// 排序字段
enum CollectionSortField { name, comicCount, updatedAt, createdAt }

/// 合集管理页面 — 极简优雅风格
class CollectionsScreen extends ConsumerStatefulWidget {
  const CollectionsScreen({super.key});

  @override
  ConsumerState<CollectionsScreen> createState() => _CollectionsScreenState();
}

class _CollectionsScreenState extends ConsumerState<CollectionsScreen> {
  List<ComicGroup> _groups = [];
  bool _loading = true;
  bool _isGridView = true;
  String _searchQuery = '';
  String _contentFilter = '';
  CollectionSortField _sortField = CollectionSortField.name;
  bool _sortAsc = true;

  final _createController = TextEditingController();
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadGroups();
  }

  @override
  void dispose() {
    _createController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _invalidateGroupCaches() {
    ref.invalidate(groupsProvider);
    ref.invalidate(groupedComicMapProvider);
  }

  Future<void> _loadGroups() async {
    setState(() => _loading = true);
    try {
      final api = ref.read(comicApiProvider);
      final data = await api.getGroups(contentType: _contentFilter.isEmpty ? null : _contentFilter);
      setState(() {
        _groups = data.map((e) => ComicGroup.fromJson(e)).toList();
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  List<ComicGroup> get _filteredAndSorted {
    var result = List<ComicGroup>.from(_groups);

    if (_searchQuery.isNotEmpty) {
      final q = _searchQuery.toLowerCase();
      result = result.where((g) => g.name.toLowerCase().contains(q)).toList();
    }

    result.sort((a, b) {
      int cmp;
      switch (_sortField) {
        case CollectionSortField.name:
          cmp = a.name.compareTo(b.name);
        case CollectionSortField.comicCount:
          cmp = a.comicCount.compareTo(b.comicCount);
        case CollectionSortField.updatedAt:
          cmp = a.updatedAt.compareTo(b.updatedAt);
        case CollectionSortField.createdAt:
          cmp = a.createdAt.compareTo(b.createdAt);
      }
      return _sortAsc ? cmp : -cmp;
    });

    return result;
  }

  Future<void> _createCollection(String name) async {
    if (name.trim().isEmpty) return;
    try {
      final api = ref.read(comicApiProvider);
      await api.createGroup(name.trim());
      _createController.clear();
      _invalidateGroupCaches();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('合集已创建')),
        );
      }
      _loadGroups();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('创建失败: $e')),
        );
      }
    }
  }

  Future<void> _deleteCollection(int groupId, String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('确认删除'),
        content: Text('确定要删除合集「$name」吗？\n合集内的作品不会被删除。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      final api = ref.read(comicApiProvider);
      await api.deleteGroup(groupId);
      _invalidateGroupCaches();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('合集已删除')),
        );
      }
      _loadGroups();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('删除失败: $e')),
        );
      }
    }
  }

  Future<void> _showEditCollectionDialog(ComicGroup group) async {
    final nameController = TextEditingController(text: group.name);
    final coverController = TextEditingController();
    var resetCover = false;

    final shouldSave = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('编辑合集'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: nameController,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: '合集名称',
                    hintText: '输入合集名称',
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: coverController,
                  enabled: !resetCover,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: '封面图片 URL',
                    hintText: 'https://example.com/cover.jpg',
                    helperText: '留空保持当前封面；支持 HTTP/HTTPS 图片地址',
                  ),
                ),
                const SizedBox(height: 8),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: resetCover,
                  controlAffinity: ListTileControlAffinity.leading,
                  title: const Text('恢复默认封面'),
                  subtitle: const Text('清除自定义封面，自动使用合集第一本作品的封面'),
                  onChanged: (value) {
                    setDialogState(() {
                      resetCover = value ?? false;
                      if (resetCover) coverController.clear();
                    });
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('保存'),
            ),
          ],
        ),
      ),
    );

    final name = nameController.text.trim();
    final coverUrl = coverController.text.trim();
    nameController.dispose();
    coverController.dispose();

    if (shouldSave != true) return;
    if (name.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('合集名称不能为空')),
        );
      }
      return;
    }
    if (!resetCover &&
        coverUrl.isNotEmpty &&
        !coverUrl.startsWith('http://') &&
        !coverUrl.startsWith('https://')) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('封面地址需以 http:// 或 https:// 开头')),
        );
      }
      return;
    }

    final payload = <String, dynamic>{'name': name};
    if (resetCover) {
      payload['coverUrl'] = '';
    } else if (coverUrl.isNotEmpty) {
      payload['coverUrl'] = coverUrl;
    }

    try {
      await ref.read(apiClientProvider).put(
            '/groups/${group.id}',
            data: payload,
          );
      _invalidateGroupCaches();
      await _loadGroups();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(resetCover ? '合集已更新，封面已恢复默认' : '合集已更新')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('更新失败: $e')),
        );
      }
    }
  }

  void _showCreateDialog() {
    _createController.clear();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('新建合集'),
        content: TextField(
          controller: _createController,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: '输入合集名称...',
          ),
          onSubmitted: (val) {
            Navigator.pop(ctx);
            _createCollection(val);
          },
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('取消')),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              _createCollection(_createController.text);
            },
            child: const Text('创建'),
          ),
        ],
      ),
    );
  }

  void _showSortMenu() {
    final cs = Theme.of(context).colorScheme;
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: Row(
                children: [
                  Text(
                    '排序方式',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                      color: cs.onSurface,
                    ),
                  ),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: () {
                      setState(() => _sortAsc = !_sortAsc);
                      Navigator.pop(ctx);
                    },
                    icon: Icon(
                      _sortAsc ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded,
                      size: 16,
                    ),
                    label: Text(_sortAsc ? '升序' : '降序'),
                  ),
                ],
              ),
            ),
            Divider(height: 0.5, color: cs.outlineVariant.withOpacity(0.3)),
            _buildSortOption('按名称', CollectionSortField.name, Icons.sort_by_alpha_rounded),
            _buildSortOption('按作品数', CollectionSortField.comicCount, Icons.library_books_outlined),
            _buildSortOption('按更新时间', CollectionSortField.updatedAt, Icons.update_rounded),
            _buildSortOption('按创建时间', CollectionSortField.createdAt, Icons.schedule_rounded),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Widget _buildSortOption(String label, CollectionSortField field, IconData icon) {
    final isSelected = _sortField == field;
    final cs = Theme.of(context).colorScheme;
    return ListTile(
      leading: Icon(icon, size: 20, color: isSelected ? cs.primary : cs.onSurfaceVariant.withOpacity(0.5)),
      title: Text(
        label,
        style: TextStyle(
          fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
          color: isSelected ? cs.primary : cs.onSurface,
        ),
      ),
      trailing: isSelected ? Icon(Icons.check_rounded, size: 18, color: cs.primary) : null,
      onTap: () {
        setState(() => _sortField = field);
        Navigator.pop(context);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final serverUrl = ref.watch(authProvider).serverUrl;
    final filtered = _filteredAndSorted;

    return Scaffold(
      appBar: AppBar(
        title: const Text('合集'),
        actions: [
          IconButton(
            icon: Icon(_isGridView ? Icons.view_agenda_outlined : Icons.grid_view_rounded),
            tooltip: _isGridView ? '列表视图' : '网格视图',
            onPressed: () {
              HapticFeedback.lightImpact();
              setState(() => _isGridView = !_isGridView);
            },
          ),
          IconButton(
            icon: const Icon(Icons.swap_vert_rounded),
            tooltip: '排序',
            onPressed: _showSortMenu,
          ),
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: '新建合集',
            onPressed: _showCreateDialog,
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: Column(
        children: [
          // ─── 搜索栏 ───
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: '搜索合集...',
                prefixIcon: Icon(Icons.search_rounded,
                    color: cs.onSurfaceVariant.withOpacity(0.5)),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: Icon(Icons.close_rounded,
                            size: 20, color: cs.onSurfaceVariant.withOpacity(0.5)),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _searchQuery = '');
                        },
                      )
                    : null,
              ),
              onChanged: (val) => setState(() => _searchQuery = val),
            ),
          ),

          // ─── 筛选 Chips ───
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Row(
              children: [
                _buildFilterChip('漫画', 'comic'),
                const SizedBox(width: 8),
                _buildFilterChip('小说', 'novel'),
                const Spacer(),
                Text(
                  '${filtered.length} 个合集',
                  style: TextStyle(
                    fontSize: 12,
                    color: cs.onSurfaceVariant.withOpacity(0.4),
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),

          // ─── 内容区域 ───
          Expanded(
            child: _loading
                ? const Center(
                    child: SizedBox(
                      width: 28,
                      height: 28,
                      child: CircularProgressIndicator(strokeWidth: 2.5),
                    ),
                  )
                : filtered.isEmpty
                    ? _buildEmptyState()
                    : RefreshIndicator(
                        onRefresh: _loadGroups,
                        child: _isGridView
                            ? _buildGridView(filtered, serverUrl)
                            : _buildListView(filtered, serverUrl),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, String value) {
    final isSelected = _contentFilter == value;
    final cs = Theme.of(context).colorScheme;
    return FilterChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (_) {
        HapticFeedback.selectionClick();
        setState(() => _contentFilter = isSelected ? '' : value);
        _loadGroups();
      },
      visualDensity: VisualDensity.compact,
      showCheckmark: false,
      selectedColor: cs.primary.withOpacity(0.12),
      labelStyle: TextStyle(
        fontSize: 12,
        color: isSelected ? cs.primary : cs.onSurfaceVariant,
        fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
      ),
    );
  }

  Widget _buildEmptyState() {
    final cs = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: cs.primaryContainer.withOpacity(0.3),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Icon(
              Icons.collections_bookmark_outlined,
              size: 32,
              color: cs.primary.withOpacity(0.5),
            ),
          ),
          const SizedBox(height: 20),
          Text(
            '还没有合集',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: cs.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '点击右上角 + 创建合集来整理书库',
            style: TextStyle(
              fontSize: 13,
              color: cs.onSurfaceVariant.withOpacity(0.5),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildGridView(List<ComicGroup> groups, String serverUrl) {
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 0.72,
        crossAxisSpacing: 14,
        mainAxisSpacing: 14,
      ),
      itemCount: groups.length,
      itemBuilder: (context, index) => StaggeredFadeSlide(
        index: index,
        child: _buildGridItem(groups[index], serverUrl),
      ),
    );
  }

  Widget _buildGridItem(ComicGroup group, String serverUrl) {
    final cs = Theme.of(context).colorScheme;
    return PressableScale(
      onTap: () => context.push('/group/${group.id}'),
      onLongPress: () => _showGroupActions(group),
      scaleDown: 0.95,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 封面
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.08),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    group.coverUrl.isNotEmpty
                        ? AuthenticatedImage(
                            imageUrl: group.coverUrl.startsWith('http')
                                ? group.coverUrl
                                : '$serverUrl${group.coverUrl}',
                            fit: BoxFit.cover,
                          )
                        : Container(
                            color: cs.surfaceContainerHighest,
                            child: Icon(
                              Icons.collections_bookmark_rounded,
                              size: 40,
                              color: cs.onSurfaceVariant.withOpacity(0.2),
                            ),
                          ),
                    // 底部渐变
                    Positioned(
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 50,
                      child: Container(
                        decoration: const BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.bottomCenter,
                            end: Alignment.topCenter,
                            colors: [Colors.black54, Colors.transparent],
                          ),
                        ),
                      ),
                    ),
                    // 作品数量
                    Positioned(
                      bottom: 8,
                      right: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.black.withOpacity(0.4),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          '${group.comicCount}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // 信息
          Padding(
            padding: const EdgeInsets.fromLTRB(2, 10, 2, 0),
            child: Text(
              group.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: cs.onSurface,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(2, 3, 2, 0),
            child: Text(
              '${group.comicCount} 部作品',
              style: TextStyle(
                fontSize: 11,
                color: cs.onSurfaceVariant.withOpacity(0.5),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildListView(List<ComicGroup> groups, String serverUrl) {
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: groups.length,
      separatorBuilder: (_, __) => const SizedBox(height: 6),
      itemBuilder: (context, index) => _buildListItem(groups[index], serverUrl),
    );
  }

  Widget _buildListItem(ComicGroup group, String serverUrl) {
    final cs = Theme.of(context).colorScheme;
    return Material(
      color: Theme.of(context).cardTheme.color ?? cs.surface,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => context.push('/group/${group.id}'),
        onLongPress: () => _showGroupActions(group),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(10),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.06),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: SizedBox(
                    width: 50,
                    height: 50,
                    child: group.coverUrl.isNotEmpty
                        ? AuthenticatedImage(
                            imageUrl: group.coverUrl.startsWith('http')
                                ? group.coverUrl
                                : '$serverUrl${group.coverUrl}',
                            fit: BoxFit.cover,
                          )
                        : Container(
                            color: cs.surfaceContainerHighest,
                            child: Icon(
                              Icons.collections_bookmark_rounded,
                              size: 22,
                              color: cs.onSurfaceVariant.withOpacity(0.3),
                            ),
                          ),
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      group.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: cs.onSurface,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${group.comicCount} 部作品${group.author.isNotEmpty ? ' · ${group.author}' : ''}',
                      style: TextStyle(
                        fontSize: 12,
                        color: cs.onSurfaceVariant.withOpacity(0.5),
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded,
                  size: 20, color: cs.onSurfaceVariant.withOpacity(0.3)),
            ],
          ),
        ),
      ),
    );
  }

  void _showGroupActions(ComicGroup group) {
    final cs = Theme.of(context).colorScheme;
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: Text(
                group.name,
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: cs.onSurface,
                ),
              ),
            ),
            Divider(height: 0.5, color: cs.outlineVariant.withOpacity(0.3)),
            ListTile(
              leading: Icon(Icons.open_in_new_rounded, color: cs.primary),
              title: const Text('查看详情'),
              onTap: () {
                Navigator.pop(ctx);
                context.push('/group/${group.id}');
              },
            ),
            ListTile(
              leading: Icon(Icons.edit_outlined, color: cs.primary),
              title: const Text('编辑合集'),
              subtitle: const Text('修改名称或设置自定义封面'),
              onTap: () {
                Navigator.pop(ctx);
                _showEditCollectionDialog(group);
              },
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline_rounded, color: Color(0xFFFF6B6B)),
              title: const Text('删除合集', style: TextStyle(color: Color(0xFFFF6B6B))),
              onTap: () {
                Navigator.pop(ctx);
                _deleteCollection(group.id, group.name);
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
