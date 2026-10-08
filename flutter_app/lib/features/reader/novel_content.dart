import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html;

bool isNovelHtml(String content, String? mimeType) =>
    (mimeType ?? '').toLowerCase().contains('html') ||
    content.trimLeft().startsWith('<');

/// 服务端返回 /api/...，服务器地址可能包含反向代理的子路径。
String resolveNovelResourceUrl(String source, String serverUrl) {
  final uri = Uri.parse(source.trim());
  if (uri.hasScheme) return uri.toString();
  final base = Uri.parse('${serverUrl.replaceFirst(RegExp(r'/+$'), '')}/');
  if (source.startsWith('//')) return base.resolveUri(uri).toString();
  if (uri.path.startsWith('/api/')) {
    return base.resolveUri(Uri.parse(uri.toString().substring(1))).toString();
  }
  return base.resolveUri(uri).toString();
}

/// EPUB 2 封面经常用 SVG 包裹一张位图；提取后仍通过同一认证链路加载。
String prepareNovelHtml(String content, String serverUrl) {
  final fragment = html.parseFragment(content);
  for (final svg in fragment.querySelectorAll('svg')) {
    final images = svg.querySelectorAll('image');
    final hasVectorContent = svg.querySelectorAll('*').any((element) => !{
          'image',
          'g',
          'title',
          'desc',
          'metadata'
        }.contains(element.localName));
    if (images.isEmpty || hasVectorContent) continue;
    final replacement = dom.Element.tag('div');
    for (final image in images) {
      final source = image.attributes['href'] ??
          image.attributes['xlink:href'] ??
          image.attributes.entries
              .where((entry) => entry.key.toString().endsWith(':href'))
              .map((entry) => entry.value)
              .firstOrNull;
      if (source == null || source.isEmpty) continue;
      replacement.append(dom.Element.tag('img')..attributes['src'] = source);
    }
    svg.replaceWith(replacement);
  }
  for (final image in fragment.querySelectorAll('img')) {
    final source = image.attributes['src'];
    if (source != null && source.isNotEmpty) {
      image.attributes['src'] = resolveNovelResourceUrl(source, serverUrl);
    }
  }
  // HTML 渲染器不支持 text-indent；用全角空格保留 Web 的首行缩进。
  for (final paragraph in fragment.querySelectorAll('p')) {
    if (paragraph.text.trim().isNotEmpty &&
        paragraph.querySelector('img, svg') == null) {
      paragraph.nodes.insert(0, dom.Text('\u3000\u3000'));
    }
  }
  return fragment.outerHtml;
}

/// 仅供搜索、听书等纯文本功能使用，正文显示保留原始 HTML。
String novelPlainText(String content, [String? mimeType]) {
  if (!isNovelHtml(content, mimeType)) return content;
  final fragment = html.parseFragment(content);
  for (final element in fragment.querySelectorAll('script, style')) {
    element.remove();
  }
  for (final element in fragment.querySelectorAll(
      'br, p, div, h1, h2, h3, h4, h5, h6, li, blockquote, tr, figcaption')) {
    element.append(dom.Text('\n'));
  }
  return (fragment.text ?? '')
      .replaceAll('\u00a0', ' ')
      .replaceAll(RegExp(r'\n{3,}'), '\n\n')
      .trim();
}

class NovelTocEntry {
  final int index;
  final Map<String, dynamic> chapter;
  final int level;
  final int? parentIndex;
  final bool hasChildren;

  const NovelTocEntry(
      this.index, this.chapter, this.level, this.parentIndex, this.hasChildren);
}

/// 与 Web 相同：缺少 parentIndex 时由 level 推导父目录，保留原始章节索引。
List<NovelTocEntry> normalizeNovelToc(List<Map<String, dynamic>> chapters) {
  final ancestors = <int>[];
  final entries = <NovelTocEntry>[];
  for (var index = 0; index < chapters.length; index++) {
    final chapter = chapters[index];
    final level =
        ((chapter['level'] as num?)?.toInt() ?? 0).clamp(0, ancestors.length);
    while (ancestors.length > level) {
      ancestors.removeLast();
    }
    final rawParent = (chapter['parentIndex'] as num?)?.toInt();
    final parent = rawParent != null && rawParent >= 0 && rawParent < index
        ? rawParent
        : level > 0 && ancestors.isNotEmpty
            ? ancestors.last
            : null;
    entries.add(NovelTocEntry(index, chapter, level, parent, false));
    ancestors.add(index);
  }
  return [
    for (final entry in entries)
      NovelTocEntry(
        entry.index,
        entry.chapter,
        entry.level,
        entry.parentIndex,
        entry.chapter['hasChildren'] as bool? ??
            (entry.index + 1 < entries.length &&
                entries[entry.index + 1].level > entry.level),
      ),
  ];
}

List<NovelTocEntry> visibleNovelToc(
    List<NovelTocEntry> entries, Set<int> collapsed) {
  return entries.where((entry) {
    var parent = entry.parentIndex;
    while (parent != null) {
      if (collapsed.contains(parent)) return false;
      parent = entries[parent].parentIndex;
    }
    return true;
  }).toList();
}
