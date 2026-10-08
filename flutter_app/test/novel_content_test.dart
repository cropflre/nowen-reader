import 'package:flutter_test/flutter_test.dart';
import 'package:html/parser.dart' as html;
import 'package:nowen_reader/features/reader/novel_content.dart';

void main() {
  test('recognizes server HTML MIME types with charset', () {
    expect(isNovelHtml('章节正文', 'text/html; charset=utf-8'), isTrue);
    expect(isNovelHtml('<p>正文</p>', null), isTrue);
    expect(isNovelHtml('纯文本章节', 'text/plain; charset=utf-8'), isFalse);
  });

  test('resolves protected images under a server subpath', () {
    const base = 'https://reader.example/nowen';
    expect(
        resolveNovelResourceUrl(
            '/api/comics/book/epub-resource/图%20片.jpg', base),
        '$base/api/comics/book/epub-resource/%E5%9B%BE%20%E7%89%87.jpg');
    expect(resolveNovelResourceUrl('api/comics/book/image.png', '$base/'),
        '$base/api/comics/book/image.png');
    expect(resolveNovelResourceUrl('/nowen/api/image.png', base),
        '$base/api/image.png');
    expect(resolveNovelResourceUrl('https://cdn.example/image.png', base),
        'https://cdn.example/image.png');
    expect(resolveNovelResourceUrl('//cdn.example/image.png', base),
        'https://cdn.example/image.png');
    expect(resolveNovelResourceUrl('data:image/png;base64,AA==', base),
        'data:image/png;base64,AA==');
  });

  test('preserves prose and image order including EPUB 2 SVG covers', () {
    final prepared = prepareNovelHtml('''
      <h2>第一章</h2><p>插图前<strong>粗体</strong></p>
      <img src="/api/comics/book/epub-resource/OEBPS/Images/插图.jpg">
      <svg viewBox="0 0 600 800"><image xlink:href="/api/comics/book/epub-resource/OEBPS/cover.jpg" /></svg>
      <p>插图后</p>
      <svg viewBox="0 0 10 10"><path d="M0 0L10 10" /></svg>
      ''', 'https://reader.example/nowen');
    final fragment = html.parseFragment(prepared);
    expect(fragment.querySelectorAll('img').map((e) => e.attributes['src']), [
      'https://reader.example/nowen/api/comics/book/epub-resource/OEBPS/Images/%E6%8F%92%E5%9B%BE.jpg',
      'https://reader.example/nowen/api/comics/book/epub-resource/OEBPS/cover.jpg',
    ]);
    expect(fragment.querySelectorAll('svg'), hasLength(1));
    expect(fragment.querySelector('strong')?.text, '粗体');
    expect(prepared.indexOf('插图前'), lessThan(prepared.indexOf('<img')));
    expect(prepared.indexOf('插图后'), greaterThan(prepared.lastIndexOf('<img')));
  });

  test('search and speech text decode entities and preserve boundaries', () {
    expect(
        novelPlainText(
            '<h2>章名</h2><p>甲&#x4e59;&nbsp;&amp;</p><p>丙<br/>丁</p><script>bad()</script>'),
        '章名\n甲乙 &\n丙\n丁');
    expect(novelPlainText('正文含 1 < 2 和 &amp; 字面值'), '正文含 1 < 2 和 &amp; 字面值');
  });

  test('TOC collapse keeps server chapter indexes and nested ancestry', () {
    final entries = normalizeNovelToc([
      {'title': '第一卷', 'level': 0, 'hasChildren': true},
      {'title': '第一章', 'level': 1, 'parentIndex': 0},
      {'title': '第一节', 'level': 2},
      {'title': '第二章', 'level': 1},
      {'title': '第二卷', 'level': 0},
      {'title': '第三章', 'level': 1},
    ]);
    expect(entries.map((e) => e.parentIndex), [null, 0, 1, 0, null, 4]);
    expect(visibleNovelToc(entries, {0}).map((e) => e.index), [0, 4, 5]);
    expect(visibleNovelToc(entries, {1}).map((e) => e.index), [0, 1, 3, 4, 5]);
    expect(entries[4].hasChildren, isTrue);
  });
}
