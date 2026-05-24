import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/tag_api.dart';
import '../models/comic.dart';

/// 标签管理状态
class TagManagerState {
  final List<Tag> tags;
  final List<Category> categories;
  final bool isLoading;
  final String? error;
  final Set<int> selectedTagIds;
  final Set<int> selectedCategoryIds;

  const TagManagerState({
    this.tags = const [],
    this.categories = const [],
    this.isLoading = false,
    this.error,
    this.selectedTagIds = const {},
    this.selectedCategoryIds = const {},
  });

  TagManagerState copyWith({
    List<Tag>? tags,
    List<Category>? categories,
    bool? isLoading,
    String? error,
    Set<int>? selectedTagIds,
    Set<int>? selectedCategoryIds,
    bool clearError = false,
  }) {
    return TagManagerState(
      tags: tags ?? this.tags,
      categories: categories ?? this.categories,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      selectedTagIds: selectedTagIds ?? this.selectedTagIds,
      selectedCategoryIds: selectedCategoryIds ?? this.selectedCategoryIds,
    );
  }
}

/// 标签管理 Notifier
class TagManagerNotifier extends StateNotifier<TagManagerState> {
  final Ref _ref;

  TagManagerNotifier(this._ref) : super(const TagManagerState()) {
    loadAll();
  }

  /// 加载全部标签和分类
  Future<void> loadAll() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final tagApi = _ref.read(tagApiProvider);
      final catApi = _ref.read(categoryApiProvider);

      final tagData = await tagApi.listTags();
      final catData = await catApi.listCategories();

      final tags = tagData.map((e) => Tag.fromJson(e)).toList();
      final categories = catData.map((e) => Category.fromJson(e)).toList();

      state = state.copyWith(
        tags: tags,
        categories: categories,
        isLoading: false,
        selectedTagIds: {},
        selectedCategoryIds: {},
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: '加载失败: $e');
    }
  }

  // ============================================================
  // 标签操作
  // ============================================================

  /// 重命名标签
  Future<bool> renameTag(int tagId, String newName) async {
    try {
      final api = _ref.read(tagApiProvider);
      await api.rename(tagId, newName);
      state = state.copyWith(
        tags: state.tags.map((t) {
          if (t.id == tagId) return Tag(id: t.id, name: newName, color: t.color);
          return t;
        }).toList(),
      );
      return true;
    } catch (e) {
      state = state.copyWith(error: '重命名失败: $e');
      return false;
    }
  }

  /// 更新标签颜色
  Future<bool> updateTagColor(int tagId, String color) async {
    try {
      final api = _ref.read(tagApiProvider);
      await api.updateColor(tagId, color);
      state = state.copyWith(
        tags: state.tags.map((t) {
          if (t.id == tagId) return Tag(id: t.id, name: t.name, color: color);
          return t;
        }).toList(),
      );
      return true;
    } catch (e) {
      state = state.copyWith(error: '更新颜色失败: $e');
      return false;
    }
  }

  /// 删除标签
  Future<bool> deleteTag(int tagId) async {
    try {
      final api = _ref.read(tagApiProvider);
      await api.delete(tagId);
      state = state.copyWith(
        tags: state.tags.where((t) => t.id != tagId).toList(),
        selectedTagIds: Set.from(state.selectedTagIds)..remove(tagId),
      );
      return true;
    } catch (e) {
      state = state.copyWith(error: '删除失败: $e');
      return false;
    }
  }

  /// 批量删除标签
  Future<bool> deleteSelectedTags() async {
    final ids = state.selectedTagIds.toList();
    if (ids.isEmpty) return false;
    try {
      final api = _ref.read(tagApiProvider);
      for (final id in ids) {
        await api.delete(id);
      }
      state = state.copyWith(
        tags: state.tags.where((t) => !ids.contains(t.id)).toList(),
        selectedTagIds: {},
      );
      return true;
    } catch (e) {
      state = state.copyWith(error: '批量删除失败: $e');
      return false;
    }
  }

  /// 合并标签（将选中的标签合并到目标标签）
  Future<bool> mergeTags(int targetId) async {
    final sourceIds = state.selectedTagIds.where((id) => id != targetId).toList();
    if (sourceIds.isEmpty) return false;
    try {
      final api = _ref.read(tagApiProvider);
      await api.merge(sourceIds, targetId);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: '合并失败: $e');
      return false;
    }
  }

  // ============================================================
  // 分类操作
  // ============================================================

  /// 创建分类
  Future<bool> createCategory(String name) async {
    try {
      final api = _ref.read(categoryApiProvider);
      await api.create(name);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: '创建失败: $e');
      return false;
    }
  }

  /// 更新分类
  Future<bool> updateCategory(String slug, {String? name, String? newSlug}) async {
    try {
      final api = _ref.read(categoryApiProvider);
      await api.update(slug, name: name, newSlug: newSlug);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: '更新失败: $e');
      return false;
    }
  }

  /// 删除分类
  Future<bool> deleteCategory(String slug) async {
    try {
      final api = _ref.read(categoryApiProvider);
      await api.delete(slug);
      state = state.copyWith(
        categories: state.categories.where((c) => c.slug != slug).toList(),
      );
      return true;
    } catch (e) {
      state = state.copyWith(error: '删除失败: $e');
      return false;
    }
  }

  /// 批量删除分类
  Future<bool> deleteSelectedCategories() async {
    final ids = state.selectedCategoryIds.toList();
    if (ids.isEmpty) return false;
    try {
      final api = _ref.read(categoryApiProvider);
      final slugs = state.categories
          .where((c) => ids.contains(c.id))
          .map((c) => c.slug)
          .toList();
      for (final slug in slugs) {
        await api.delete(slug);
      }
      state = state.copyWith(
        categories: state.categories.where((c) => !ids.contains(c.id)).toList(),
        selectedCategoryIds: {},
      );
      return true;
    } catch (e) {
      state = state.copyWith(error: '批量删除失败: $e');
      return false;
    }
  }

  // ============================================================
  // 选择操作
  // ============================================================

  void toggleTagSelection(int tagId) {
    final selected = Set<int>.from(state.selectedTagIds);
    if (selected.contains(tagId)) {
      selected.remove(tagId);
    } else {
      selected.add(tagId);
    }
    state = state.copyWith(selectedTagIds: selected);
  }

  void toggleCategorySelection(int catId) {
    final selected = Set<int>.from(state.selectedCategoryIds);
    if (selected.contains(catId)) {
      selected.remove(catId);
    } else {
      selected.add(catId);
    }
    state = state.copyWith(selectedCategoryIds: selected);
  }

  void selectAllTags() {
    state = state.copyWith(
      selectedTagIds: state.tags.map((t) => t.id).toSet(),
    );
  }

  void selectAllCategories() {
    state = state.copyWith(
      selectedCategoryIds: state.categories.map((c) => c.id).toSet(),
    );
  }

  void clearTagSelection() {
    state = state.copyWith(selectedTagIds: {});
  }

  void clearCategorySelection() {
    state = state.copyWith(selectedCategoryIds: {});
  }

  void clearError() {
    state = state.copyWith(clearError: true);
  }
}

final tagManagerProvider =
    StateNotifierProvider<TagManagerNotifier, TagManagerState>((ref) {
  return TagManagerNotifier(ref);
});
