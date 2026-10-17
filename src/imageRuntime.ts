import type * as Ort from "onnxruntime-web";

let initialized: Promise<typeof Ort> | undefined;

// ONNX IR 8 / opset 13: float32 x[2] -> Add(x, x) -> y[2]. No model weights.
const PROBE_MODEL = new Uint8Array([
  8, 8, 58, 64, 10, 14, 10, 1, 120, 10, 1, 120, 18, 1, 121, 34, 3, 65, 100, 100,
  18, 12, 119, 101, 98, 103, 112, 117, 45, 99, 104, 101, 99, 107, 90, 15, 10, 1,
  120, 18, 10, 10, 8, 8, 1, 18, 4, 10, 2, 8, 2, 98, 15, 10, 1, 121, 18, 10, 10,
  8, 8, 1, 18, 4, 10, 2, 8, 2, 66, 4, 10, 0, 16, 13,
]);

export function initializeImageRuntime() {
  return initialized ??= (async () => {
    const ort = await import("onnxruntime-web/webgpu");
    // This ORT version's WebGPU build disables JSEP and expects the native
    // asyncify bridge. A JSEP module lacks webgpuInit and cannot initialize it.
    // Both assets must come from the same installed version as the JS runtime.
    const [{ default: wasm }, { default: mjs }] = await Promise.all([
      import("onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url"),
      import("onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url"),
    ]);
    ort.env.wasm.wasmPaths = { wasm, mjs };
    ort.env.wasm.numThreads = 1;
    // Initialize and actually run the selected backend before downloading weights.
    const session = await ort.InferenceSession.create(PROBE_MODEL, { executionProviders: ["webgpu"] });
    const input = new ort.Tensor("float32", new Float32Array([1, 2]), [2]);
    let outputs: Ort.InferenceSession.ReturnType | undefined;
    try {
      outputs = await session.run({ x: input });
      if (outputs.y.data[0] !== 2 || outputs.y.data[1] !== 4) throw new Error("WebGPU runtime self-test returned an incorrect result.");
    } finally {
      input.dispose(); Object.values(outputs ?? {}).forEach(t => t.dispose()); await session.release();
    }
    return ort;
  })();
}
