import { lcmStep, lcmTimesteps, pixelsFromPlanarRGB, seededNoise } from "./diffusionMath";
import type * as Ort from "onnxruntime-web";
import { initializeImageRuntime } from "./imageRuntime";
import { createStreamingSha256 } from "./streamingHash";

export const IMAGE_MODEL = "akameswa/lcm-tiny-sd-onnx-fp16";
export const IMAGE_REVISION = "3b423c4e1d61d50c56efdde24592862be68c8574";
export const TOKENIZER_REVISION = "d15189d7028b43f1d3e65039190477f6af591c2a";
const BASE = `https://huggingface.co/${IMAGE_MODEL}/resolve/${IMAGE_REVISION}`;
const CACHE = "vocabulary-diffusion-v1";
const FILES = {
  text: { path: "text_encoder/model.onnx", size: 246537314, sha: "a927a821041e928990120442d8ab6a20b8a11e2b5ebe1c4770cd481a931bd0fd" },
  unet: { path: "unet/model.onnx", size: 354685, sha: "4d4758e738c8375b77b8cbe3f85e59264caebb8ac0bdfb72a3d8e8122e68495a" },
  unetData: { path: "unet/model.onnx_data", size: 646809600, sha: "29196647b26ee2a8568149efe27cc2e5ac9bb70190e7bfb32c479b2ddf564ed3" },
  vae: { path: "vae_decoder/model.onnx", size: 157826, sha: "3bd0fa2a6121c5818812119706e4f3971c8d07cebfcb005797564c0ba624b124" },
  vaeData: { path: "vae_decoder/model.onnx_data", size: 98965248, sha: "f0cecf2ce224497f153817a786371082860e110408bc17424c499137e31b9515" },
};
export const MODEL_BYTES = Object.values(FILES).reduce((n, file) => n + file.size, 0);
export interface ImageMetrics {
  model: string; revision: string; tokenizerRevision: string;
  modelArtifactBytes: number; modelFetchedBytes: number; modelCacheBytes: number;
  fetchMs: number; verificationMs: number; sessionLoadMs: number; tokenizerLoadMs: number; generationMs: number | null; totalMs: number | null;
  runtimeInitMs: number | null; runtimeCheck: "not-run" | "passed" | "failed";
  peakObservedJsHeapBytes: number | null; gpuMemoryBytes: null;
  prompt: string; seed: number; steps: number; outputSize: number; grayscale: boolean;
  status: "not-started" | "loading" | "generating" | "completed" | "failed";
  error?: string;
  notes: string[];
}

export async function imageCapability() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> } }).gpu;
  const adapter = await gpu?.requestAdapter();
  if (!adapter) throw new Error("This experiment requires WebGPU. Use a recent browser on a compatible computer.");
  if (!adapter.features.has("shader-f16")) throw new Error("Your WebGPU adapter does not support shader-f16, required by this model.");
}

export function observeHeap(metrics: ImageMetrics) {
  const bytes = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  if (bytes !== undefined) metrics.peakObservedJsHeapBytes = Math.max(metrics.peakObservedJsHeapBytes ?? 0, bytes);
}

export class ImageDiffusion {
  private ort!: typeof Ort;
  private text?: Ort.InferenceSession;
  private unet?: Ort.InferenceSession;
  private vae?: Ort.InferenceSession;
  private tokenizer?: Awaited<ReturnType<typeof import("@huggingface/transformers").AutoTokenizer.from_pretrained>>;

  get loaded() { return Boolean(this.text && this.unet && this.vae && this.tokenizer); }

  async load(metrics: ImageMetrics, update: (message: string) => void, signal: AbortSignal) {
    if (this.loaded) return;
    await imageCapability();
    update("Checking the WebGPU runtime before downloading model weights…");
    const runtimeStart = performance.now();
    try { this.ort = await initializeImageRuntime(); metrics.runtimeCheck = "passed"; }
    catch (error) { metrics.runtimeCheck = "failed"; throw error; }
    finally { metrics.runtimeInitMs = performance.now() - runtimeStart; }
    signal.throwIfAborted();
    const cache = await caches.open(CACHE).catch(() => undefined);
    if (!cache) throw new Error("This browser could not open local storage for the model. Check Chrome site storage and free space, then reload.");
    const read = async (file: typeof FILES.text) => {
      signal.throwIfAborted();
      const url = `${BASE}/${file.path}`;
      const start = performance.now();
      let response = await cache.match(url);
      const cached = Boolean(response);
      if (!response) {
        // StorageManager estimates the origin's remaining quota. It is only a
        // hint, but it can prevent Chrome from stopping a large mobile download
        // after most of the bytes have already transferred.
        let estimate: StorageEstimate | undefined;
        try { estimate = await navigator.storage?.estimate(); } catch { /* Unsupported or unavailable. */ }
        if (Number.isFinite(estimate?.quota) && Number.isFinite(estimate?.usage)) {
          const available = Math.max(0, estimate!.quota! - estimate!.usage!);
          const required = file.size + 32 * 1024 * 1024;
          if (available < required) {
            throw new Error(`Chrome estimates only ${Math.floor(available / 1e6)} MB of site storage is available; about ${Math.ceil(required / 1e6)} MB is needed to cache ${file.path}. Free Chrome site storage or phone storage, then retry.`);
          }
        }
        response = await fetch(url, { signal });
      }
      if (!response.ok || !response.body) throw new Error(`${file.path}: HTTP ${response.status}. Check your connection and Hugging Face access.`);
      let offset = 0;
      const hasher = createStreamingSha256();
      let data: Uint8Array;
      if (!cached) {
        // Stream the network response straight into CacheStorage while counting
        // bytes and hashing each chunk. Avoid holding the 647 MB UNet file in JS
        // memory alongside a second Cache API copy during download.
        const source = response.body.getReader();
        let sourceError: unknown;
        const progressStream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              signal.throwIfAborted();
              const { done, value } = await source.read();
              if (done) { controller.close(); return; }
              if (offset + value.length > file.size) throw new Error(`Unexpected size for ${file.path}.`);
              offset += value.length;
              hasher.update(value);
              metrics.modelFetchedBytes += value.length;
              update(`Downloading · ${file.path} · ${Math.round(offset / file.size * 100)}%`);
              controller.enqueue(value);
            } catch (error) {
              sourceError = error;
              controller.error(error);
            }
          },
          async cancel(reason) { await source.cancel(reason).catch(() => {}); },
        });
        try {
          await cache.put(url, new Response(progressStream, { headers: { "Content-Type": "application/octet-stream" } }));
        } catch (cause) {
          await source.cancel(cause).catch(() => {});
          await cache.delete(url);
          if (signal.aborted) signal.throwIfAborted();
          if (sourceError || offset < file.size) {
            const detail = cause instanceof Error ? cause.message : String(cause);
            throw new Error(`The download of ${file.path} stopped at ${Math.round(offset / file.size * 100)}%. Check your connection and free phone storage, then retry. ${detail}`);
          }
          const detail = cause instanceof Error ? cause.message : String(cause);
          throw new Error(`Chrome could not save the ${Math.round(file.size / 1e6)} MB ${file.path} in local storage (${detail}). Free phone storage or site storage, then retry.`);
        }
        metrics.fetchMs += performance.now() - start;
        if (offset !== file.size) { await cache.delete(url); throw new Error(`The download of ${file.path} was incomplete. Retry when the connection is stable.`); }
        response = (await cache.match(url))!;
        if (!response) throw new Error(`Chrome could not retain ${file.path} in local storage. Check free storage and retry.`);
        update(`Verifying ${file.path}…`);
        const verifyStart = performance.now();
        const hash = hasher.digest();
        metrics.verificationMs += performance.now() - verifyStart;
        if (hash !== file.sha) { await cache.delete(url); throw new Error(`Checksum mismatch for ${file.path}; the file was rejected.`); }
        signal.throwIfAborted();
        // Allocate one JS buffer only after the verified response is safely cached.
        data = new Uint8Array(await response.arrayBuffer());
      } else {
        data = new Uint8Array(file.size);
        const reader = response.body.getReader();
        try {
          while (true) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            if (offset + value.length > file.size) throw new Error(`Unexpected size for ${file.path}.`);
            data.set(value, offset); offset += value.length;
            hasher.update(value);
            metrics.modelCacheBytes += value.length;
            update(`Reading cache · ${file.path} · ${Math.round(offset / file.size * 100)}%`);
            observeHeap(metrics);
          }
        } finally { await reader.cancel().catch(() => {}); }
        metrics.fetchMs += performance.now() - start;
        if (offset !== file.size) { await cache.delete(url); throw new Error(`Cached ${file.path} was incomplete and has been removed. Retry the download.`); }
        update(`Verifying ${file.path}…`);
        const verifyStart = performance.now();
        const hash = hasher.digest();
        metrics.verificationMs += performance.now() - verifyStart;
        if (hash !== file.sha) { await cache.delete(url); throw new Error(`Checksum mismatch for cached ${file.path}; the file was removed.`); }
      }
      if (data.length !== file.size) { await cache.delete(url); throw new Error(`Cached ${file.path} had an unexpected size and was removed.`); }
      return data;
    };
    const session = async (graph: typeof FILES.text, weights?: typeof FILES.text) => {
      const model = await read(graph);
      const data = weights ? await read(weights) : undefined;
      signal.throwIfAborted();
      update(`Loading ${graph.path} on WebGPU…`);
      const start = performance.now();
      const result = await this.ort.InferenceSession.create(model, {
        executionProviders: ["webgpu"],
        ...(data ? { externalData: [{ path: "model.onnx_data", data }] } : {}),
      });
      metrics.sessionLoadMs += performance.now() - start;
      return result;
    };
    try {
      this.text = await session(FILES.text);
      this.unet = await session(FILES.unet, FILES.unetData);
      this.vae = await session(FILES.vae, FILES.vaeData);
      signal.throwIfAborted();
      update("Loading the CLIP tokenizer…");
      const start = performance.now();
      const { AutoTokenizer } = await import("@huggingface/transformers");
      this.tokenizer = await AutoTokenizer.from_pretrained("Xenova/clip-vit-base-patch32", { revision: TOKENIZER_REVISION });
      metrics.tokenizerLoadMs = performance.now() - start;
      signal.throwIfAborted();
    } catch (error) { await this.release(); throw error; }
  }

  async generate(prompt: string, seed: number, steps: number, signal: AbortSignal, update: (message: string) => void) {
    if (!this.loaded) throw new Error("Load the image model first.");
    const { Tensor } = this.ort;
    const encoded = await this.tokenizer!(prompt, { padding: "max_length", max_length: 77, truncation: true, return_tensor: false });
    const ids = new Tensor("int32", Int32Array.from(encoded.input_ids.flat().map(Number)), [1, 77]);
    let hidden: Ort.Tensor | undefined;
    try {
      signal.throwIfAborted();
      const outputs = await this.text!.run({ input_ids: ids }, ["last_hidden_state"]);
      hidden = outputs.last_hidden_state;
      const noise = seededNoise(seed);
      let latent = Float32Array.from({ length: 4 * 64 * 64 }, noise);
      const timesteps = lcmTimesteps(steps);
      for (let i = 0; i < timesteps.length; i++) {
        signal.throwIfAborted();
        update(`Generating · step ${i + 1} of ${steps}`);
        const sample = new Tensor("float32", latent, [1, 4, 64, 64]);
        const timestep = new Tensor("float32", new Float32Array([timesteps[i]]), [1]);
        let output: Ort.InferenceSession.ReturnType | undefined;
        try {
          output = await this.unet!.run({ sample, timestep, encoder_hidden_states: hidden });
          if (!(output.out_sample.data instanceof Float32Array)) throw new Error("Unexpected UNet output type.");
          latent = lcmStep(latent, output.out_sample.data, timesteps[i], timesteps[i + 1], noise);
        } finally { sample.dispose(); timestep.dispose(); Object.values(output ?? {}).forEach(t => t.dispose()); }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      signal.throwIfAborted();
      update("Decoding the image…");
      const latentTensor = new Tensor("float32", latent.map(x => x / 0.18215), [1, 4, 64, 64]);
      let decoded: Ort.InferenceSession.ReturnType | undefined;
      try {
        decoded = await this.vae!.run({ latent_sample: latentTensor });
        signal.throwIfAborted();
        const image = decoded.sample;
        if (!(image.data instanceof Float32Array) || image.dims.join(",") !== "1,3,512,512") throw new Error("Unexpected decoder output shape or type.");
        return new ImageData(pixelsFromPlanarRGB(image.data, 512, 512), 512, 512);
      } finally { latentTensor.dispose(); Object.values(decoded ?? {}).forEach(t => t.dispose()); }
    } finally { ids.dispose(); hidden?.dispose(); }
  }

  async release() {
    for (const session of [this.text, this.unet, this.vae]) await session?.release().catch(() => {});
    this.text = this.unet = this.vae = undefined;
    this.tokenizer = undefined;
  }

  async clearCache() {
    await this.release();
    await caches.delete(CACHE);
  }
}
