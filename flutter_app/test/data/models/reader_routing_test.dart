import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/models/comic.dart';

void main() {
  group('reader routing', () {
    test('PDF in a novel library still uses the PDF reader', () {
      const pdfFilename = '文学/长篇小说.pdf';
      final comic = Comic(
        id: 'pdf-in-novel-library',
        filename: pdfFilename,
        title: '长篇小说',
        comicType: 'novel',
        lastReadPage: 12,
      );

      expect(comic.isPdf, isTrue);
      expect(comic.isNovel, isFalse);
      expect(
        comic.readerRoute(),
        '/pdf/pdf-in-novel-library?page=12',
      );
    });

    test('chapter novels keep using the novel reader', () {
      final comic = Comic(
        id: 'epub-novel',
        filename: '文学/小说.epub',
        title: '小说',
        comicType: 'novel',
        lastReadPage: 3,
      );

      expect(comic.isPdf, isFalse);
      expect(comic.isNovel, isTrue);
      expect(comic.readerRoute(), '/novel/epub-novel?chapter=3');
    });

    test('image comics keep using the comic reader', () {
      final comic = Comic(
        id: 'comic-book',
        filename: '漫画/第一卷.cbz',
        title: '第一卷',
        comicType: 'comic',
        lastReadPage: 8,
      );

      expect(comic.isPdf, isFalse);
      expect(comic.isNovel, isFalse);
      expect(comic.readerRoute(), '/reader/comic-book?page=8');
    });
  });
}
