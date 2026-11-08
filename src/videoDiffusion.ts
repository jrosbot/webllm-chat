import type * as Ort from "onnxruntime-web";
import { initializeImageRuntime } from "./imageRuntime";
import { createStreamingSha256 } from "./streamingHash";
import { decoderPixelsToRgb } from "./videoOutput";
import type { VideoQuantizationSummary } from "./videoQuantization";

export const VIDEO_MODEL = "udgamlabs/Drishya-Tiny";
export const VIDEO_REVISION = "2676ae2764687ffadfdc238fdfe83d3b313a3e9c";
export const VIDEO_LICENSE = "CC BY-NC 4.0";
export const TOKENIZER_MODEL = "Xenova/flan-t5-base";
export const TOKENIZER_REVISION = "c6a1b98a4a35e1063d88edaceef4dc52cf3b2784";
const BASE = `https://huggingface.co/${VIDEO_MODEL}/resolve/${VIDEO_REVISION}/onnx`;
const CACHE_NAME = "video-studio-drishya-q4-v1";
const PART_BYTES = 64 * 1024 * 1024;
const STORAGE_MARGIN_BYTES = 48 * 1024 * 1024;
const LATENT_CHANNELS = 48;
const LATENT_FRAMES = 5;
const LATENT_SIZE = 16;
const LATENT_PLANE = LATENT_SIZE * LATENT_SIZE;
const LATENT_VALUES = LATENT_CHANNELS * LATENT_FRAMES * LATENT_PLANE;
const TEXT_LENGTH = 77;
const TEXT_WIDTH = 768;
const VIDEO_WIDTH = 256;
const VIDEO_HEIGHT = 256;
const FRAME_COUNT = 17;

const FILES = {
  dit: {
    name: "drishya_tiny_dit_cond.onnx", size: 425_712_830,
    sha256: "8749987ebaf06f770fa77909dc6f396b851aac4cf0ebf39c513dd96331e3dfd6",
  },
  text: {
    name: "flan_t5_base_encoder.onnx", size: 219_487_367,
    sha256: "2fa92b849690520ea6c87f9b56259202aa8666127e01f0ea107fab8ac10cbe77",
  },
  decoder: {
    name: "taew2_2_decoder.onnx", size: 19_903_284,
    sha256: "09f96fb5d36c09691837d8876cd141c944d094e7341b4cce79079decce59c06c",
  },
  encoder: {
    name: "taew2_2_encoder.onnx", size: 3_039_523,
    sha256: "0ec575d19cc977f3082e973a67f344b0243bc57d894f8b1ca0131c0032901789",
  },
} as const;

export const MODEL_SOURCE_BYTES = FILES.dit.size + FILES.text.size + FILES.decoder.size;
export const PHOTO_ENCODER_BYTES = FILES.encoder.size;

export interface VideoMetrics {
  model: string;
  revision: string;
  license: string;
  tokenizerModel: string;
  tokenizerRevision: string;
  sourceModelBytes: number;
  q4ModelBytes: number | null;
  quantizedParameters: number | null;
  q4MatMulNodes: number | null;
  q4GemmNodes: number | null;
  modelFetchedBytes: number;
  modelCacheBytes: number;
  fetchMs: number;
  cacheReadMs: number;
  cacheWriteMs: number;
  verificationMs: number;
  quantizationMs: number | null;
  sessionLoadMs: number;
  tokenizerLoadMs: number | null;
  textEncodingMs: number | null;
  imageEncodingMs: number | null;
  generationMs: number | null;
  decodeMs: number | null;
  videoEncodingMs: number | null;
  totalMs: number | null;
  peakObservedJsHeapBytes: number | null;
  estimatedDeviceMemoryGb: number | null;
  webgpuCheck: "not-run" | "passed" | "failed";
  webgpuCheckMs: number | null;
  prompt: string;
  seed: number;
  steps: number;
  mode: "text-to-video" | "image-to-video" | null;
  status: "not-started" | "loading" | "generating" | "completed" | "failed";
  error?: string;
  notes: string[];
}

export function newVideoMetrics(): VideoMetrics {
  return {
    model: VIDEO_MODEL, revision: VIDEO_REVISION, license: VIDEO_LICENSE,
    tokenizerModel: TOKENIZER_MODEL, tokenizerRevision: TOKENIZER_REVISION,
    sourceModelBytes: MODEL_SOURCE_BYTES, q4ModelBytes: null, quantizedParameters: null,
    q4MatMulNodes: null, q4GemmNodes: null,
    modelFetchedBytes: 0, modelCacheBytes: 0, fetchMs: 0, cacheReadMs: 0, cacheWriteMs: 0, verificationMs: 0,
    quantizationMs: null, sessionLoadMs: 0, tokenizerLoadMs: null, textEncodingMs: null,
    imageEncodingMs: null, generationMs: null, decodeMs: null, videoEncodingMs: null, totalMs: null,
    peakObservedJsHeapBytes: null,
    estimatedDeviceMemoryGb: typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === "number" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory! : null,
    webgpuCheck: "not-run", webgpuCheckMs: null, prompt: "", seed: 42, steps: 10, mode: null, status: "not-started",
    notes: [
      "The 212M-parameter generator is converted in this browser to ONNX Runtime MatMulNBits Q4 weights (block size 32). Dense matrix weights are packed at 4 bits; scales, biases and compute remain higher precision.",
      "The Q4 conversion starts from the published FP16 ONNX file, so the first run downloads 425.7 MB for conversion. The published Flan-T5 encoder and TAEW2.2 decoder add 239.4 MB; the optional image encoder adds 3.0 MB.",
      "Tokenizer files are fetched separately through Transformers.js and its cache; their download bytes and time are not included in the Video Studio model-file counters.",
      "The generator checkpoint is CC BY-NC 4.0. Prompts and photos stay in this tab. The TAEW2.2 decoder produces a softer preview than the full Wan2.2 VAE.",
      "Peak JS heap and navigator.deviceMemory are browser-specific estimates. They do not report WebGPU allocations, ONNX native/WASM memory, or total phone RAM.",
    ],
  };
}

export function observeVideoHeap(metrics: VideoMetrics) {
  const bytes = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  if (bytes !== undefined) metrics.peakObservedJsHeapBytes = Math.max(metrics.peakObservedJsHeapBytes ?? 0, bytes);
}

function cacheBase(name: string) { return `https://webllm.local/video-studio/${name}`; }
function cachePart(name: string, index: number) { return `${cacheBase(name)}?part=${index}`; }
function cacheMeta(name: string) { return `${cacheBase(name)}?meta`; }

async function getCache() {
  try { return await caches.open(CACHE_NAME); }
  catch { throw new Error("Chrome could not open model storage for Video Studio. Check the browser's site storage and retry."); }
}

async function checkStorage(requiredBytes: number) {
  try {
    const estimate = await navigator.storage?.estimate();
    if (Number.isFinite(estimate?.quota) && Number.isFinite(estimate?.usage)) {
      const available = Math.max(0, estimate!.quota! - estimate!.usage!);
      if (available < requiredBytes) {
        throw new Error(`Chrome estimates ${Math.floor(available / 1e6)} MB of site storage is available; about ${Math.ceil(requiredBytes / 1e6)} MB is needed for the cached Q4 generator and its helper models. Free site storage or phone storage, then retry.`);
      }
    }
  } catch (reason) {
    if (reason instanceof Error && reason.message.includes("needed for the cached Q4")) throw reason;
    // Storage estimates are not exposed in some browser modes; the cache write
    // below still reports a useful error if the origin has no remaining space.
  }
}

async function cacheBytes(cache: Cache, key: string, data: Uint8Array, sha256: string, metadata: Record<string, unknown>) {
  const parts = Math.ceil(data.byteLength / PART_BYTES);
  try {
    for (let i = 0; i < parts; i++) {
      const chunk = data.subarray(i * PART_BYTES, Math.min(data.byteLength, (i + 1) * PART_BYTES));
      await cache.put(cachePart(key, i), new Response(chunk.slice().buffer, { headers: { "Content-Type": "application/octet-stream" } }));
    }
    await cache.put(cacheMeta(key), new Response(JSON.stringify({ size: data.byteLength, parts, sha256, ...metadata }), { headers: { "Content-Type": "application/json" } }));
  } catch (reason) {
    for (let i = 0; i < parts; i++) await cache.delete(cachePart(key, i)).catch(() => false);
    await cache.delete(cacheMeta(key)).catch(() => false);
    const detail = reason instanceof Error ? reason.message : String(reason);
    throw new Error(`Chrome could not cache ${Math.ceil(data.byteLength / 1e6)} MB of Video Studio model data (${detail}). Free phone/site storage and retry.`);
  }
}

async function readCached(cache: Cache, key: string, expectedBytes: number | null, expectedSha: string, metrics: VideoMetrics, update: (message: string) => void) {
  const cacheStarted = performance.now();
  const metaResponse = await cache.match(cacheMeta(key));
  if (!metaResponse) return null;
  let meta: { size?: number; parts?: number; sha256?: string; quantization?: VideoQuantizationSummary };
  try { meta = await metaResponse.json(); }
  catch { await clearParts(cache, key); return null; }
  if (!Number.isInteger(meta.size) || !meta.size || (expectedBytes !== null && meta.size !== expectedBytes) ||
      !Number.isInteger(meta.parts) || !meta.parts || !/^[a-f0-9]{64}$/.test(meta.sha256 ?? "") ||
      (expectedSha && meta.sha256 !== expectedSha)) {
    await clearParts(cache, key); return null;
  }
  const data = new Uint8Array(meta.size);
  const hasher = createStreamingSha256();
  let offset = 0;
  for (let i = 0; i < meta.parts; i++) {
    const response = await cache.match(cachePart(key, i));
    if (!response) { await clearParts(cache, key); return null; }
    const chunk = new Uint8Array(await response.arrayBuffer());
    if (offset + chunk.byteLength > data.byteLength) { await clearParts(cache, key); return null; }
    data.set(chunk, offset);
    const hashStarted = performance.now(); hasher.update(chunk); metrics.verificationMs += performance.now() - hashStarted;
    offset += chunk.byteLength;
    metrics.modelCacheBytes += chunk.byteLength;
    update(`Reading cached ${key} · ${Math.round(offset / meta.size * 100)}%`);
    observeVideoHeap(metrics);
  }
  const digestStarted = performance.now();
  const digest = hasher.digest(); metrics.verificationMs += performance.now() - digestStarted;
  metrics.cacheReadMs += performance.now() - cacheStarted;
  if (offset !== meta.size || digest !== meta.sha256) {
    await clearParts(cache, key);
    throw new Error(`Cached ${key} failed its size or SHA-256 check and was removed. Retry the download.`);
  }
  return { data, metadata: meta };
}

async function clearParts(cache: Cache, key: string) {
  const response = await cache.match(cacheMeta(key));
  let parts = 0;
  try { parts = Number((await response?.json())?.parts) || 0; } catch { /* Invalid metadata. */ }
  for (let i = 0; i < parts; i++) await cache.delete(cachePart(key, i)).catch(() => false);
  await cache.delete(cacheMeta(key));
}

async function fetchModelFile(file: (typeof FILES)[keyof typeof FILES], metrics: VideoMetrics, update: (message: string) => void, signal: AbortSignal) {
  const url = `${BASE}/${file.name}`;
  const started = performance.now();
  const response = await fetch(url, { signal, mode: "cors" });
  if (!response.ok || !response.body) throw new Error(`${file.name}: HTTP ${response.status}. Check your connection and the Hugging Face model source.`);
  const data = new Uint8Array(file.size);
  const reader = response.body.getReader();
  const hasher = createStreamingSha256();
  let offset = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > data.byteLength) throw new Error(`Unexpected size for ${file.name}; the file was rejected.`);
      data.set(value, offset);
      const hashStarted = performance.now(); hasher.update(value); metrics.verificationMs += performance.now() - hashStarted;
      offset += value.byteLength;
      metrics.modelFetchedBytes += value.byteLength;
      update(`Downloading ${file.name} · ${Math.round(offset / data.byteLength * 100)}% · ${Math.round(metrics.modelFetchedBytes / 1e6)} MB received`);
      observeVideoHeap(metrics);
    }
  } finally { await reader.cancel().catch(() => {}); }
  metrics.fetchMs += performance.now() - started;
  if (offset !== file.size) throw new Error(`The download of ${file.name} stopped at ${Math.round(offset / file.size * 100)}%. Check the connection and retry.`);
  const verifyStarted = performance.now();
  if (hasher.digest() !== file.sha256) throw new Error(`SHA-256 mismatch for ${file.name}; the model file was rejected.`);
  metrics.verificationMs += performance.now() - verifyStarted;
  return data;
}

async function loadFile(cache: Cache, key: string, file: (typeof FILES)[keyof typeof FILES], metrics: VideoMetrics, update: (message: string) => void, signal: AbortSignal) {
  const cached = await readCached(cache, key, file.size, file.sha256, metrics, update);
  if (cached) return cached.data;
  const data = await fetchModelFile(file, metrics, update, signal);
  const cacheStart = performance.now();
  await cacheBytes(cache, key, data, file.sha256, {});
  metrics.cacheWriteMs += performance.now() - cacheStart;
  return data;
}

async function loadQ4(cache: Cache, metrics: VideoMetrics, update: (message: string) => void, signal: AbortSignal) {
  const cached = await readCached(cache, "drishya-q4", null, "", metrics, update);
  // The exact output size is learned during conversion. A metadata lookup lets
  // this path load the genuine packed model without fetching the FP16 source.
  if (cached) return { data: cached.data, summary: cached.metadata.quantization ?? null };

  await checkStorage(150_000_000 + FILES.text.size + FILES.decoder.size + STORAGE_MARGIN_BYTES);
  update("Downloading the published 425.7 MB FP16 ONNX generator for local Q4 conversion…");
  const source = await fetchModelFile(FILES.dit, metrics, update, signal);
  signal.throwIfAborted();
  update("Packing dense generator weights into genuine Q4 blocks in a background worker…");
  const started = performance.now();
  const worker = new Worker(new URL("./videoQuantizationWorker.ts", import.meta.url), { type: "module" });
  const converted = await new Promise<{ model: ArrayBuffer; summary: VideoQuantizationSummary }>((resolve, reject) => {
    const onAbort = () => { worker.terminate(); reject(new DOMException("Cancelled", "AbortError")); };
    signal.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<{ type: string; percent?: number; model?: ArrayBuffer; summary?: VideoQuantizationSummary; message?: string }>) => {
      if (event.data.type === "progress") update(`Converting generator weights to Q4 · ${event.data.percent ?? 0}%`);
      else if (event.data.type === "complete" && event.data.model && event.data.summary) {
        signal.removeEventListener("abort", onAbort); worker.terminate(); resolve({ model: event.data.model, summary: event.data.summary });
      } else if (event.data.type === "error") {
        signal.removeEventListener("abort", onAbort); worker.terminate(); reject(new Error(event.data.message ?? "Q4 conversion failed."));
      }
    };
    worker.onerror = (event) => {
      signal.removeEventListener("abort", onAbort); worker.terminate(); reject(new Error(event.message || "Q4 conversion worker failed."));
    };
    worker.postMessage(source.buffer, [source.buffer]);
  });
  metrics.quantizationMs = performance.now() - started;
  metrics.q4ModelBytes = converted.model.byteLength;
  metrics.quantizedParameters = converted.summary.quantizedParameters;
  metrics.q4MatMulNodes = converted.summary.quantizedMatmuls;
  metrics.q4GemmNodes = converted.summary.quantizedGemm;
  const q4 = new Uint8Array(converted.model);
  const q4Hash = createStreamingSha256();
  const hashStarted = performance.now(); q4Hash.update(q4); metrics.verificationMs += performance.now() - hashStarted;
  const cacheStarted = performance.now();
  const q4Sha = q4Hash.digest();
  await cacheBytes(cache, "drishya-q4", q4, q4Sha, { quantization: converted.summary });
  metrics.cacheWriteMs += performance.now() - cacheStarted;
  return { data: q4, summary: converted.summary };
}

function browserStorageAvailable() {
  return typeof caches !== "undefined";
}

export function gaussianNoise(seed: number, length = LATENT_VALUES) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 2) {
    const radius = Math.sqrt(-2 * Math.log(1 - random()));
    const angle = 2 * Math.PI * random();
    output[i] = radius * Math.cos(angle);
    if (i + 1 < length) output[i + 1] = radius * Math.sin(angle);
  }
  return output;
}

export function videoTimesteps(steps: number, shift = 5) {
  const timesteps = [];
  for (let i = 0; i <= steps; i++) {
    const time = 1 - i / steps;
    timesteps.push(shift * time / (1 + (shift - 1) * time));
  }
  return timesteps;
}

export async function prepareVideoImage(file: Blob) {
  const image = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const side = Math.min(image.width, image.height);
  const left = Math.floor((image.width - side) / 2);
  const top = Math.floor((image.height - side) / 2);
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = VIDEO_WIDTH;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not prepare the first frame.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, left, top, side, side, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  const rgba = context.getImageData(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT).data;
  const rgb = new Uint8Array(VIDEO_WIDTH * VIDEO_HEIGHT * 3);
  for (let pixel = 0; pixel < VIDEO_WIDTH * VIDEO_HEIGHT; pixel++) {
    rgb[pixel * 3] = rgba[pixel * 4]; rgb[pixel * 3 + 1] = rgba[pixel * 4 + 1]; rgb[pixel * 3 + 2] = rgba[pixel * 4 + 2];
  }
  image.close();
  return rgb;
}

export function createVideoFrames(rgb: Uint8Array) {
  if (rgb.length !== FRAME_COUNT * VIDEO_WIDTH * VIDEO_HEIGHT * 3) throw new Error("The decoder returned an unexpected number of video pixels.");
  const canvas = document.createElement("canvas"); canvas.width = VIDEO_WIDTH; canvas.height = VIDEO_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not display decoded video frames.");
  const frames: ImageData[] = [];
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const pixels = context.createImageData(VIDEO_WIDTH, VIDEO_HEIGHT);
    const start = frame * VIDEO_WIDTH * VIDEO_HEIGHT * 3;
    for (let pixel = 0; pixel < VIDEO_WIDTH * VIDEO_HEIGHT; pixel++) {
      pixels.data[pixel * 4] = rgb[start + pixel * 3];
      pixels.data[pixel * 4 + 1] = rgb[start + pixel * 3 + 1];
      pixels.data[pixel * 4 + 2] = rgb[start + pixel * 3 + 2];
      pixels.data[pixel * 4 + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    context.font = "11px system-ui, sans-serif"; context.textBaseline = "alphabetic";
    const label = "AI-generated · Drishya Tiny Q4";
    const measure = context.measureText(label);
    const height = Math.ceil(measure.actualBoundingBoxAscent + measure.actualBoundingBoxDescent);
    context.fillStyle = "rgba(0,0,0,.62)"; context.fillRect(4, VIDEO_HEIGHT - height - 12, Math.ceil(measure.width) + 8, height + 8);
    context.fillStyle = "rgba(255,255,255,.94)"; context.fillText(label, 8, VIDEO_HEIGHT - 8 - Math.ceil(measure.actualBoundingBoxDescent));
    frames.push(context.getImageData(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT));
  }
  return frames;
}

export async function recordVideoWebM(frames: ImageData[]) {
  if (!("MediaRecorder" in window)) throw new Error("This browser cannot encode a local WebM preview.");
  const canvas = document.createElement("canvas"); canvas.width = VIDEO_WIDTH; canvas.height = VIDEO_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a video canvas.");
  const stream = canvas.captureStream(8);
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) { stream.getTracks().forEach(track => track.stop()); throw new Error("This browser does not support WebM recording."); }
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener("dataavailable", event => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: mimeType })));
    recorder.addEventListener("error", event => reject(new Error(`WebM recording failed: ${String(event)}`)));
  });
  recorder.start();
  for (const frame of frames) {
    context.putImageData(frame, 0, 0);
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  recorder.stop();
  stream.getTracks().forEach(track => track.stop());
  return stopped;
}

export class VideoDiffusion {
  private ort?: typeof Ort;
  private dit?: Ort.InferenceSession;
  private text?: Ort.InferenceSession;
  private decoder?: Ort.InferenceSession;
  private encoder?: Ort.InferenceSession;
  private tokenizer?: Awaited<ReturnType<typeof import("@huggingface/transformers").AutoTokenizer.from_pretrained>>;
  private unconditional?: { hidden: Float32Array; mask: Uint8Array };
  private q4Summary?: VideoQuantizationSummary;

  get loaded() { return Boolean(this.dit && this.text && this.decoder && this.tokenizer); }

  async checkWebGpu() {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
    if (!gpu || !(await gpu.requestAdapter())) throw new Error("This video model requires WebGPU. Use a recent Chrome browser with WebGPU enabled; no model files were downloaded.");
  }

  async checkQ4Runtime() {
    await this.checkWebGpu();
    this.ort ??= await initializeImageRuntime();
    const { quantizeVideoOnnx, createQ4ConversionProbe } = await import("./videoQuantization");
    const { model } = quantizeVideoOnnx(createQ4ConversionProbe());
    const session = await this.ort.InferenceSession.create(model, { executionProviders: ["webgpu"] });
    const input = new this.ort.Tensor("float32", Float32Array.from({ length: 32 }, (_, i) => i === 0 ? 2 : i === 1 ? 3 : 0), [1, 32]);
    let outputs: Ort.InferenceSession.ReturnType | undefined;
    try {
      outputs = await session.run({ x: input });
      const result = outputs.y.data;
      if (result[0] !== 2 || result[1] !== 3) throw new Error("The Q4 WebGPU probe returned incorrect values.");
    } finally {
      input.dispose(); Object.values(outputs ?? {}).forEach(tensor => tensor.dispose()); await session.release();
    }
  }

  async load(metrics: VideoMetrics, update: (message: string) => void, signal: AbortSignal) {
    if (this.loaded) return;
    await this.checkWebGpu();
    if (!browserStorageAvailable()) throw new Error("This browser cannot use local model storage. Open Video Studio in a regular Chrome tab, not private browsing.");
    const runtimeStart = performance.now();
    update("Testing ONNX Runtime WebGPU and its real Q4 MatMulNBits kernel…");
    await this.checkQ4Runtime(); metrics.webgpuCheck = "passed";
    metrics.webgpuCheckMs = performance.now() - runtimeStart;
    signal.throwIfAborted();

    const cache = await getCache();
    let q4: { data: Uint8Array; summary: VideoQuantizationSummary | null } | undefined;
    q4 = await loadQ4(cache, metrics, update, signal);
    signal.throwIfAborted();
    metrics.q4ModelBytes = q4.data.byteLength;
    if (q4.summary) {
      metrics.quantizedParameters = q4.summary.quantizedParameters;
      metrics.q4MatMulNodes = q4.summary.quantizedMatmuls;
      metrics.q4GemmNodes = q4.summary.quantizedGemm;
    }
    update("Loading the converted 4-bit generator on WebGPU…");
    let started = performance.now();
    this.dit = await this.ort!.InferenceSession.create(q4.data, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
    metrics.sessionLoadMs += performance.now() - started;
    q4.data = new Uint8Array();
    signal.throwIfAborted();

    const text = await loadFile(cache, "flan-t5-base-encoder", FILES.text, metrics, update, signal);
    update("Loading the Flan-T5 text encoder on WebAssembly…");
    started = performance.now();
    this.text = await this.ort!.InferenceSession.create(text, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    metrics.sessionLoadMs += performance.now() - started;
    signal.throwIfAborted();

    const decoder = await loadFile(cache, "taew2-2-decoder", FILES.decoder, metrics, update, signal);
    update("Loading the compact TAEW2.2 video decoder on WebGPU…");
    started = performance.now();
    this.decoder = await this.ort!.InferenceSession.create(decoder, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
    metrics.sessionLoadMs += performance.now() - started;
    signal.throwIfAborted();

    update("Loading the Flan-T5 tokenizer…");
    started = performance.now();
    const { AutoTokenizer, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    this.tokenizer = await AutoTokenizer.from_pretrained(TOKENIZER_MODEL, { revision: TOKENIZER_REVISION });
    metrics.tokenizerLoadMs = performance.now() - started;
  }

  async loadImageEncoder(metrics: VideoMetrics, update: (message: string) => void, signal: AbortSignal) {
    if (this.encoder) return;
    const cache = await getCache();
    const data = await loadFile(cache, "taew2-2-encoder", FILES.encoder, metrics, update, signal);
    update("Loading the optional first-frame encoder on WebGPU…");
    const started = performance.now();
    this.encoder = await this.ort!.InferenceSession.create(data, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
    metrics.sessionLoadMs += performance.now() - started;
  }

  private async encodeText(text: string) {
    const encoded = await this.tokenizer!(text, { padding: "max_length", max_length: TEXT_LENGTH, truncation: true });
    const ids = new BigInt64Array(TEXT_LENGTH);
    const mask = new BigInt64Array(TEXT_LENGTH);
    for (let i = 0; i < TEXT_LENGTH; i++) {
      ids[i] = BigInt(Number(encoded.input_ids.data[i]));
      mask[i] = BigInt(Number(encoded.attention_mask.data[i]));
    }
    const idsTensor = new this.ort!.Tensor("int64", ids, [1, TEXT_LENGTH]);
    const maskTensor = new this.ort!.Tensor("int64", mask, [1, TEXT_LENGTH]);
    let output: Ort.InferenceSession.ReturnType | undefined;
    try {
      output = await this.text!.run({ input_ids: idsTensor, attention_mask: maskTensor });
      const hidden = output.last_hidden_state.data as Float32Array;
      return { hidden: hidden.slice(), mask: Uint8Array.from(mask, Number) };
    } finally {
      idsTensor.dispose(); maskTensor.dispose(); Object.values(output ?? {}).forEach(tensor => tensor.dispose());
    }
  }

  async generate(prompt: string, seed: number, steps: number, signal: AbortSignal, update: (message: string) => void, metrics: VideoMetrics, image?: Uint8Array) {
    if (!this.loaded) throw new Error("Load the local Q4 generator first.");
    const textStarted = performance.now();
    const conditioned = await this.encodeText(prompt);
    this.unconditional ??= await this.encodeText("");
    const text = new Float32Array(2 * TEXT_LENGTH * TEXT_WIDTH);
    text.set(conditioned.hidden); text.set(this.unconditional.hidden, TEXT_LENGTH * TEXT_WIDTH);
    const mask = new Uint8Array(2 * TEXT_LENGTH);
    mask.set(conditioned.mask); mask.set(this.unconditional.mask, TEXT_LENGTH);
    metrics.textEncodingMs = performance.now() - textStarted;

    let first: Float32Array | undefined;
    if (image) {
      if (!this.encoder) await this.loadImageEncoder(metrics, update, signal);
      const imageStarted = performance.now();
      const input = new this.ort!.Tensor("float32", Float32Array.from(image), [VIDEO_HEIGHT, VIDEO_WIDTH, 3]);
      let encoded: Ort.InferenceSession.ReturnType | undefined;
      try {
        encoded = await this.encoder!.run({ image: input });
        const latent = encoded.first.data as Float32Array;
        first = latent.slice();
      } finally { input.dispose(); Object.values(encoded ?? {}).forEach(tensor => tensor.dispose()); }
      metrics.imageEncodingMs = performance.now() - imageStarted;
    }

    const { Tensor } = this.ort!;
    const textTensor = new Tensor("float32", text, [2, TEXT_LENGTH, TEXT_WIDTH]);
    const maskTensor = new Tensor("bool", mask, [2, TEXT_LENGTH]);
    const cfgTensor = new Tensor("float32", Float32Array.of(5), [1]);
    const condTensor = new Tensor("float32", Float32Array.of(first ? 1 : 0), [1]);
    const latent = gaussianNoise(seed);
    const times = videoTimesteps(steps);
    const stepMs: number[] = [];
    const pinFirstFrame = () => {
      if (!first) return;
      for (let channel = 0; channel < LATENT_CHANNELS; channel++) {
        latent.set(first.subarray(channel * LATENT_PLANE, (channel + 1) * LATENT_PLANE), channel * LATENT_FRAMES * LATENT_PLANE);
      }
    };
    const generationStarted = performance.now();
    try {
      for (let i = 0; i < steps; i++) {
        signal.throwIfAborted();
        update(`Generating locally · step ${i + 1} of ${steps}`);
        pinFirstFrame();
        const xTensor = new Tensor("float32", latent, [1, LATENT_CHANNELS, LATENT_FRAMES, LATENT_SIZE, LATENT_SIZE]);
        const tTensor = new Tensor("float32", Float32Array.of(times[i]), [1]);
        let output: Ort.InferenceSession.ReturnType | undefined;
        const stepStarted = performance.now();
        try {
          output = await this.dit!.run({
            x: xTensor, t: tTensor, txt: textTensor, mask: maskTensor, cfg: cfgTensor, cond: condTensor,
          });
          const velocity = output.v.data as Float32Array;
          const delta = times[i + 1] - times[i];
          for (let j = 0; j < LATENT_VALUES; j++) latent[j] += delta * velocity[j];
          stepMs.push(performance.now() - stepStarted);
        } finally {
          xTensor.dispose(); tTensor.dispose(); Object.values(output ?? {}).forEach(tensor => tensor.dispose());
        }
        observeVideoHeap(metrics);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      pinFirstFrame();
      metrics.generationMs = performance.now() - generationStarted;
      signal.throwIfAborted();
      update("Decoding 17 preview frames…");
      const latentTensor = new Tensor("float32", latent, [1, LATENT_CHANNELS, LATENT_FRAMES, LATENT_SIZE, LATENT_SIZE]);
      let decoded: Ort.InferenceSession.ReturnType | undefined;
      const decodeStarted = performance.now();
      try {
        decoded = await this.decoder!.run({ z: latentTensor });
        const frames = decoderPixelsToRgb(decoded.frames.data, decoded.frames.dims);
        metrics.decodeMs = performance.now() - decodeStarted;
        return { rgb: frames, stepMs, totalGenerationMs: performance.now() - generationStarted, mode: first ? "image-to-video" as const : "text-to-video" as const };
      } finally { latentTensor.dispose(); Object.values(decoded ?? {}).forEach(tensor => tensor.dispose()); }
    } finally {
      textTensor.dispose(); maskTensor.dispose(); cfgTensor.dispose(); condTensor.dispose();
      observeVideoHeap(metrics);
    }
  }

  async release() {
    for (const session of [this.dit, this.text, this.decoder, this.encoder]) await session?.release().catch(() => {});
    this.dit = this.text = this.decoder = this.encoder = undefined;
    this.tokenizer = undefined; this.unconditional = undefined; this.q4Summary = undefined;
  }

  async clearCache() {
    await this.release();
    await caches.delete(CACHE_NAME);
  }
}
