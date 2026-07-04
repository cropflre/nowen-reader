import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nowen_reader/providers/upscale_provider.dart';

void main() {
  test('ModelState copyWith works', () {
    final state = ModelState(
      status: ModelProviderStatus.downloading,
      downloadProgress: 0.5,
    );
    final updated = state.copyWith(
      status: ModelProviderStatus.ready,
      downloadProgress: 1.0,
    );
    expect(updated.status, ModelProviderStatus.ready);
    expect(updated.downloadProgress, 1.0);
    expect(updated.currentModelId, state.currentModelId); // 未修改字段保持不变
  });

  test('InferenceState transitions', () {
    final notifier = InferenceStateNotifier();
    expect(notifier.state.status, InferenceProviderStatus.idle);

    notifier.setRunning();
    expect(notifier.state.status, InferenceProviderStatus.running);

    notifier.setCompleted();
    expect(notifier.state.status, InferenceProviderStatus.completed);

    notifier.reset();
    expect(notifier.state.status, InferenceProviderStatus.idle);
  });
}
