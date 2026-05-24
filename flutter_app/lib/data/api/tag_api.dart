import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';

/// 标签管理 API
class TagApi {
  final Dio _dio;
  TagApi(this._dio);

  /// 获取标签列表
  Future<List<dynamic>> listTags() async {
    final res = await _dio.get('/tags');
    return res.data['tags'] ?? [];
  }

  /// 更新标签颜色
  Future<void> updateColor(int tagId, String color) async {
    await _dio.put('/tags/color', data: {
      'id': tagId,
      'color': color,
    });
  }

  /// 重命名标签
  Future<void> rename(int tagId, String newName) async {
    await _dio.put('/tags/rename', data: {
      'id': tagId,
      'name': newName,
    });
  }

  /// 删除标签
  Future<void> delete(int tagId) async {
    await _dio.delete('/tags', data: {'id': tagId});
  }

  /// 合并标签
  Future<void> merge(List<int> sourceIds, int targetId) async {
    await _dio.post('/tags/merge', data: {
      'sourceIds': sourceIds,
      'targetId': targetId,
    });
  }
}

/// 分类管理 API
class CategoryApi {
  final Dio _dio;
  CategoryApi(this._dio);

  /// 获取分类列表
  Future<List<dynamic>> listCategories() async {
    final res = await _dio.get('/categories');
    return res.data['categories'] ?? [];
  }

  /// 创建分类
  Future<Map<String, dynamic>> create(String name, {String? slug}) async {
    final res = await _dio.post('/categories/create', data: {
      'name': name,
      if (slug != null) 'slug': slug,
    });
    return res.data;
  }

  /// 更新分类
  Future<void> update(String slug, {String? name, String? newSlug}) async {
    await _dio.put('/categories/$slug', data: {
      if (name != null) 'name': name,
      if (newSlug != null) 'slug': newSlug,
    });
  }

  /// 删除分类
  Future<void> delete(String slug) async {
    await _dio.delete('/categories/$slug');
  }

  /// 重新排序分类
  Future<void> reorder(List<Map<String, dynamic>> categories) async {
    await _dio.put('/categories/reorder', data: {
      'categories': categories,
    });
  }
}

final tagApiProvider = Provider<TagApi>((ref) {
  return TagApi(ref.watch(dioProvider));
});

final categoryApiProvider = Provider<CategoryApi>((ref) {
  return CategoryApi(ref.watch(dioProvider));
});
