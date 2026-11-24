import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/api/comic_api.dart';

void main() {
  test('uses the 1.2.4 series order and the next indexed chapter', () async {
    final requests = <String>[];
    final dio = Dio(BaseOptions(baseUrl: 'https://reader.test/api'));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (request, handler) {
      requests.add(request.path);
      final Object data;
      switch (request.path) {
        case '/series':
          expect(request.queryParameters, {'libraryIds': 'comics'});
          data = {
            'series': [
              {'id': 'other', 'rootRelativePath': '作品2', 'libraryId': 'comics'},
              {'id': 'work', 'rootRelativePath': '作品', 'libraryId': 'comics'},
            ],
          };
        case '/series/work':
          data = {
            'sections': [
              {
                'items': [_item('10', 2), _item('2', 1)],
              },
            ],
            'unsectioned': [_item('1', 0)],
          };
        default:
          throw StateError('Unexpected path ${request.path}');
      }
      handler.resolve(Response(requestOptions: request, data: data));
    }));

    final chapters = await ComicApi(dio).getComicSeriesReadingOrder(
      comicId: '2',
      libraryId: 'comics',
      relativePath: '作品/第一季/2.cbz',
    );
    expect(chapters.map((chapter) => chapter.comicId), ['1', '2', '10']);
    expect(requests, ['/series', '/series/work']);
  });

  test('checks exact membership and recognizes a collapsed edition', () async {
    final requests = <String>[];
    final dio = Dio(BaseOptions(baseUrl: 'https://reader.test/api'));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (request, handler) {
      requests.add(request.path);
      final data = switch (request.path) {
        '/series' => {
            'series': [
              {
                'id': 'other',
                'rootRelativePath': '作品/套装',
                'libraryId': 'other'
              },
              {
                'id': 'deep',
                'rootRelativePath': '作品/套装',
                'libraryId': 'comics'
              },
              {'id': 'work', 'rootRelativePath': '作品', 'libraryId': 'comics'},
            ],
          },
        '/series/deep' => {
            'unsectioned': [_item('unrelated', 0)],
          },
        '/series/work' => {
            'unsectioned': [
              {
                ..._item('1-pdf', 0),
                'editions': [
                  {'comicId': '1-cbz'}
                ]
              },
              _item('2-cbz', 1),
            ],
          },
        _ => throw StateError('Unexpected path ${request.path}'),
      };
      handler.resolve(Response(requestOptions: request, data: data));
    }));
    final api = ComicApi(dio);
    final chapters = await api.getComicSeriesReadingOrder(
      comicId: '1-cbz',
      libraryId: 'comics',
      relativePath: '作品/套装/1.cbz',
    );
    expect(chapters.first.matchesComic('1-cbz'), isTrue);
    expect(chapters.last.comicId, '2-cbz');
    expect(requests, ['/series', '/series/deep', '/series/work']);

    requests.clear();
    expect(
      await api.getComicSeriesReadingOrder(
        comicId: 'missing',
        libraryId: 'comics',
        relativePath: '作品/9.cbz',
      ),
      isEmpty,
    );
    expect(requests, ['/series', '/series/work']);

    requests.clear();
    expect(
      await api.getComicSeriesReadingOrder(
        comicId: 'root',
        libraryId: 'comics',
        relativePath: '1.cbz',
      ),
      isEmpty,
    );
    expect(requests, isEmpty);
  });
}

Map<String, Object> _item(String id, int index) => {
      'comic': {'id': id},
      'sortIndex': index,
    };
