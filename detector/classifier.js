let modelLoading;
const thresholds = { low: 0.42, normal: 0.24, high: 0.12 };
const hornCategory = 302;

function loadModel() {
  if (modelLoading) return modelLoading;

  modelLoading = (async () => {
    const { AudioClassifier } = await import('./audio_bundle.mjs');
    // A tiny WebAssembly module using SIMD instructions selects the matching runtime.
    const simdModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
    const runtimeName = WebAssembly.validate(simdModule) ? 'audio_wasm_internal' : 'audio_wasm_nosimd_internal';
    const runtime = {
      wasmLoaderPath: new URL(`./wasm/${runtimeName}.js`, self.location.href).href,
      wasmBinaryPath: new URL(`./wasm/${runtimeName}.wasm`, self.location.href).href,
    };
    return AudioClassifier.createFromOptions(runtime, {
      baseOptions: { modelAssetPath: new URL('./yamnet.tflite', self.location.href).href },
      maxResults: 12,
    });
  })().catch((failure) => {
    modelLoading = undefined;
    console.error(failure);
    throw new Error('声音识别模型加载失败，请重试。');
  });
  return modelLoading;
}

self.onmessage = async ({ data }) => {
  const { id, type, samples, sampleRate, sensitivity } = data;
  try {
    const model = await loadModel();
    const result = [];
    if (type === 'classify') {
      const threshold = thresholds[sensitivity] ?? thresholds.normal;
      const durationMs = (samples.length / sampleRate) * 1000;
      for (const frame of model.classify(samples, sampleRate)) {
        // Ignore residual windows dominated by padding at the end of a clip.
        if (frame.timestampMs > 0 && durationMs - frame.timestampMs < 200) continue;
        const categories = frame.classifications[0]?.categories ?? [];
        const match = categories.find((category) => category.index === hornCategory);
        if (!match || match.score < threshold) continue;
        result.push({ confidence: match.score, label: match.categoryName, offsetMs: frame.timestampMs });
      }
      result.sort((first, second) => second.confidence - first.confidence);
    }
    self.postMessage({ id, result });
  } catch (failure) {
    self.postMessage({ id, error: failure.message || '声音识别出错，请重试。' });
  }
};
