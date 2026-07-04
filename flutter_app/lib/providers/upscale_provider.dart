import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/upscale_service.dart';
import '../services/model_manager.dart';
import '../data/api/api_client.dart';

// ============================================================
// State 类型
// ============================================================

/// 模型就绪状态
enum ModelProviderStatus {
  unknown,
  notDownloaded,
  downloading,
  ready,
  error,
}

/// 推理状态
enum InferenceProviderStatus {
  idle,
  running,
  completed,
  failed,
}

/// 模型状态
class ModelState {
  final ModelProviderStatus status;
  final String? errorMessage;
  final double downloadProgress; // 0.0 ~ 1.0
  final String currentModelId;
  final int currentScale;

  const ModelState({
    this.status = ModelProviderStatus.unknown,
    this.errorMessage,
    this.downloadProgress = 0.0,
    this.currentModelId = 'realesrgan-anime',
    this.currentScale = 2,
  });

  ModelState copyWith({
    ModelProviderStatus? status,
    String? errorMessage,
    double? downloadProgress,
    String? currentModelId,
    int? currentScale,
  }) {
    return ModelState(
      status: status ?? this.status,
      errorMessage: errorMessage ?? this.errorMessage,
      downloadProgress: downloadProgress ?? this.downloadProgress,
      currentModelId: currentModelId ?? this.currentModelId,
      currentScale: currentScale ?? this.currentScale,
    );
  }
}

/// 推理状态
class InferenceState {
  final InferenceProviderStatus status;
  final String? errorMessage;

  const InferenceState({
    this.status = InferenceProviderStatus.idle,
    this.errorMessage,
  });

  InferenceState copyWith({
    InferenceProviderStatus? status,
    String? errorMessage,
  }) {
    return InferenceState(
      status: status ?? this.status,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

// ============================================================
// Providers
// ============================================================

/// 模型状态 provider
class ModelStateNotifier extends StateNotifier<ModelState> {
  final ModelManager _modelManager;

  ModelStateNotifier(this._modelManager) : super(const ModelState());

  /// 初始化时检查模型状态
  Future<void> checkModel(String modelId, int scale) async {
    try {
      final ready = await _modelManager.isModelReady(modelId, scale);
      state = state.copyWith(
        status: ready ? ModelProviderStatus.ready : ModelProviderStatus.notDownloaded,
        currentModelId: modelId,
        currentScale: scale,
      );
    } catch (e) {
      state = state.copyWith(
        status: ModelProviderStatus.error,
        errorMessage: e.toString(),
      );
    }
  }

  /// 开始下载模型
  Future<void> downloadModel(String url, String md5) async {
    state = state.copyWith(
      status: ModelProviderStatus.downloading,
      downloadProgress: 0.0,
      errorMessage: null,
    );

    try {
      await _modelManager.downloadModel(
        modelId: state.currentModelId,
        scale: state.currentScale,
        url: url,
        expectedMd5: md5,
        onProgress: (progress) {
          state = state.copyWith(downloadProgress: progress);
        },
      );
      state = state.copyWith(
        status: ModelProviderStatus.ready,
        downloadProgress: 1.0,
      );
    } catch (e) {
      state = state.copyWith(
        status: ModelProviderStatus.error,
        errorMessage: e.toString(),
      );
    }
  }
}

final modelStateProvider = StateNotifierProvider<ModelStateNotifier, ModelState>((ref) {
  final dio = ref.read(dioClientProvider);
  final modelManager = ModelManager(dio);
  return ModelStateNotifier(modelManager);
});

/// 推理状态 provider
class InferenceStateNotifier extends StateNotifier<InferenceState> {
  InferenceStateNotifier() : super(const InferenceState());

  void setRunning() {
    state = const InferenceState(status: InferenceProviderStatus.running);
  }

  void setCompleted() {
    state = const InferenceState(status: InferenceProviderStatus.completed);
  }

  void setFailed(String error) {
    state = InferenceState(
      status: InferenceProviderStatus.failed,
      errorMessage: error,
    );
  }

  void reset() {
    state = const InferenceState();
  }
}

final inferenceStateProvider = StateNotifierProvider<InferenceStateNotifier, InferenceState>((ref) {
  return InferenceStateNotifier();
});
