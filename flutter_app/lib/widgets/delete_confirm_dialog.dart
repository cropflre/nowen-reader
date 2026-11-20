import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

class DeleteConfirmResult {
  final bool confirmed;
  final bool deleteFiles;
  final bool deleteEditions;

  const DeleteConfirmResult({
    required this.confirmed,
    required this.deleteFiles,
    required this.deleteEditions,
  });
}

String extractDeleteErrorMessage(Object error) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map && data['error'] != null) {
      return data['error'].toString();
    }
    if (error.response?.statusCode == 403) {
      return '权限不足：仅全局管理员可执行删除操作';
    }
    return error.message ?? '请求失败';
  }
  return error.toString();
}

Future<DeleteConfirmResult?> showDeleteConfirmDialog(
  BuildContext context, {
  required String title,
  required String description,
  bool showEditionOption = false,
  int editionCount = 0,
  bool initialDeleteEditions = true,
}) {
  bool deleteFiles = false;
  bool deleteEditions = initialDeleteEditions;

  return showDialog<DeleteConfirmResult>(
    context: context,
    builder: (ctx) {
      return StatefulBuilder(
        builder: (ctx, setState) {
          final cs = Theme.of(ctx).colorScheme;
          return AlertDialog(
            title: Text(title),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    description,
                    style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
                  ),
                  const SizedBox(height: 14),
                  RadioListTile<bool>(
                    value: false,
                    groupValue: deleteFiles,
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: const Text('仅移除记录', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                    subtitle: const Text('从书库移除并忽略自动扫描，保留磁盘源文件', style: TextStyle(fontSize: 12)),
                    onChanged: (v) {
                      if (v != null) setState(() => deleteFiles = v);
                    },
                  ),
                  RadioListTile<bool>(
                    value: true,
                    groupValue: deleteFiles,
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    activeColor: cs.error,
                    title: Text(
                      '同时删除磁盘源文件',
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: cs.error),
                    ),
                    subtitle: const Text('彻底删除源文件并自动清理空子目录（不可恢复）', style: TextStyle(fontSize: 12)),
                    onChanged: (v) {
                      if (v != null) setState(() => deleteFiles = v);
                    },
                  ),
                  if (showEditionOption) ...[
                    const SizedBox(height: 6),
                    CheckboxListTile(
                      value: deleteEditions,
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      controlAffinity: ListTileControlAffinity.leading,
                      title: Text(
                        editionCount > 1
                            ? '同时删除关联的全部 $editionCount 个格式版本'
                            : '多格式作品同时删除关联的所有格式版本',
                        style: const TextStyle(fontSize: 12.5),
                      ),
                      onChanged: (v) => setState(() => deleteEditions = v ?? true),
                    ),
                  ],
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(null),
                child: const Text('取消'),
              ),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: deleteFiles ? cs.error : cs.primary,
                ),
                onPressed: () => Navigator.of(ctx).pop(
                  DeleteConfirmResult(
                    confirmed: true,
                    deleteFiles: deleteFiles,
                    deleteEditions: deleteEditions,
                  ),
                ),
                child: Text(deleteFiles ? '删除源文件' : '确认移除'),
              ),
            ],
          );
        },
      );
    },
  );
}
