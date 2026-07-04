import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/services/upscale_service.dart';

void main() {
  group('UpscaleService', () {
    test('service is a singleton', () {
      final s1 = UpscaleService();
      final s2 = UpscaleService();
      expect(identical(s1, s2), true);
    });

    test('clearPrefetchQueue is idempotent and does not throw', () {
      final service = UpscaleService();
      // Should not throw on empty queue
      expect(() => service.clearPrefetchQueue(), returnsNormally);
      // Should not throw when called twice
      expect(() => service.clearPrefetchQueue(), returnsNormally);
    });

    test('enqueuePrefetch and clearPrefetchQueue cycle works without crash', () {
      final service = UpscaleService();
      final items = [
        PrefetchItem(comicId: 'test', pageIndex: 0, scale: 2),
        PrefetchItem(comicId: 'test', pageIndex: 1, scale: 2),
      ];

      // Enqueue then clear — should not throw
      expect(() => service.enqueuePrefetch(items), returnsNormally);
      expect(() => service.clearPrefetchQueue(), returnsNormally);

      // Enqueue more items after clear — should work
      expect(() => service.enqueuePrefetch(items), returnsNormally);
      expect(() => service.clearPrefetchQueue(), returnsNormally);
    });

    test('enqueuePrefetch with empty items does not throw', () {
      final service = UpscaleService();
      expect(() => service.enqueuePrefetch([]), returnsNormally);
    });

    test('initial state has no model loaded', () {
      final service = UpscaleService();
      expect(service.isSessionReady, false);
      expect(service.currentModelId, '');
      expect(service.currentScale, 2);
    });

    test('unloadSession clears session state', () async {
      final service = UpscaleService();
      // Initial state
      expect(service.currentScale, 2);
      expect(service.currentModelId, '');

      // unloadSession on empty state should not throw
      await service.unloadSession();
      expect(service.isSessionReady, false);
      expect(service.currentModelId, '');
      expect(service.currentScale, 2);
    });

    test('dispose on initialized service does not throw', () async {
      final service = UpscaleService();
      // Should not throw even if never initialized
      await service.dispose();
    });
  });
}
