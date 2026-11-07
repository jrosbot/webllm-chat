import { VIDEO_MODEL, VIDEO_REVISION, VIDEO_LICENSE, MODEL_SOURCE_BYTES, PHOTO_ENCODER_BYTES, VideoDiffusion, newVideoMetrics, observeVideoHeap, prepareVideoImage, createVideoFrames, recordVideoWebM, type VideoMetrics } from "./videoDiffusion";
import "./style.css";
import "./videoStudio.css";

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
const seconds = (milliseconds: number | null) => milliseconds === null ? "Not measured" : `${(milliseconds / 1000).toFixed(2)} s`;

document.querySelector<HTMLDivElement>("#video-app")!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="./index.html">WEBLLM</a>
    <nav class="app-nav" aria-label="Applications"><a href="./index.html">Text applications</a><a href="./image.html">Image vocabulary studio</a><a href="./audio.html">Audio vocabulary studio</a><a href="#video-studio" aria-current="page">Video studio</a></nav>
    <div class="local-pill">RUNS LOCALLY</div>
  </header>
  <main>
    <section class="hero"><p class="eyebrow">EXPERIMENTAL · LOCAL VIDEO GENERATION</p><h1>Give a scene<br><em>a little motion.</em></h1><p class="lede">Make a short video from a prompt, or let a photo set the first frame. The generator runs in this browser with WebGPU; your prompt and photo stay on this device.</p></section>
    <section class="workspace" id="video-studio" aria-labelledby="video-title">
      <div class="workspace-head"><h2 id="video-title">Video studio</h2><span class="video-badge">Drishya Tiny · Q4 · ONNX WebGPU</span></div>
      <p class="video-notice">The available browser model is a 212M-parameter video generator. On first use, Video Studio downloads <strong>425.7 MB</strong> of FP16 generator weights, converts its dense weights to genuine 4-bit blocks in a background worker, then downloads the <strong>239.4 MB</strong> text encoder and video decoder. The optional photo encoder adds ${mb(PHOTO_ENCODER_BYTES)}. Cached files use about 380 MB plus the tokenizer. The Q4 conversion briefly holds a large model buffer in memory; Chrome Android may stop a tab when memory is low.</p>
      <div class="video-variants" aria-label="Verified quantized model availability">
        <article class="video-variant available"><strong>4-bit · available</strong><span>Q4 MatMulNBits, block size 32. The app creates packed Q4 weights from the published FP16 ONNX checkpoint on this device.</span></article>
        <article class="video-variant unavailable"><strong>1-bit · unavailable</strong><span>No verified 1-bit video checkpoint with an executable browser pipeline was found. There is no 1-bit model selector or conversion mode.</span></article>
      </div>
      <label for="video-prompt">SCENE DESCRIPTION</label>
      <textarea id="video-prompt" rows="3" maxlength="500">Ocean waves rolling onto a sandy beach on a sunny day, blue sky with white clouds, the camera is static.</textarea>
      <div class="examples"><span>TRY AN EXAMPLE</span><button type="button" data-video-example="Ocean waves rolling onto a sandy beach on a sunny day, blue sky with white clouds, the camera is static.">Ocean waves</button><button type="button" data-video-example="A slow sunset over snowy mountains, thin clouds drift across the clear sky, a quiet static camera.">Snowy mountains</button><button type="button" data-video-example="Small orange flames flicker in a stone fireplace while the camera stays still.">Firelight</button></div>
      <div class="video-photo">
        <label for="video-photo">FIRST FRAME · OPTIONAL PHOTO STAYS ON THIS DEVICE</label>
        <input id="video-photo" type="file" accept="image/*">
        <canvas id="video-photo-preview" width="128" height="128" hidden aria-label="Preview of the selected first frame"></canvas>
        <button id="video-photo-clear" type="button" hidden>Remove photo</button>
        <p id="video-photo-status" class="text-hint">Leave empty for text-to-video, or add a photo to animate its first frame. The photo encoder downloads only when it is first needed (${mb(PHOTO_ENCODER_BYTES)}).</p>
      </div>
      <div class="video-options">
        <label for="video-seed">Seed<input id="video-seed" type="number" min="0" max="4294967295" step="1" value="42"></label>
        <label for="video-steps">Denoising steps<select id="video-steps"><option value="5">5 · quick preview</option><option value="10" selected>10 · default</option><option value="25">25 · slower</option></select></label>
      </div>
      <p class="text-hint">Output is 17 frames at 256 × 256 pixels, 8 fps. Repeat a prompt with the same seed to compare runs. More steps can take longer and do not guarantee better motion.</p>
      <div class="action-row"><p id="video-status" role="status" aria-live="polite">Checking WebGPU…</p><div class="video-actions"><button id="video-cancel" type="button" hidden>Cancel</button><button id="video-generate" class="generate" type="button" disabled>Generate local video →</button></div></div>
      <progress id="video-progress" aria-label="Model data fetched or read from cache" max="${MODEL_SOURCE_BYTES}" value="0" hidden></progress>
      <p id="video-error" class="error" role="alert"></p>
      <figure id="video-result" hidden><video id="video-preview" controls loop playsinline></video><figcaption id="video-caption"></figcaption><a id="video-save" download="drishya-tiny-q4.webm">Download WebM</a></figure>
      <details class="video-measurements" open><summary>Measurements on this device</summary><dl id="video-metrics"></dl><p class="text-hint">Fetched bytes count the model-file responses listed above; Transformers.js tokenizer fetches use its own cache and are not counted here. Cached bytes count verified model data read from Video Studio storage. Sampled JS heap and Chrome's deviceMemory hint are estimates; they exclude worker, WebGPU and native/WASM memory allocations, and do not report total phone RAM. No Android phone measurement is implied by the compatibility check.</p><div class="video-actions"><button id="video-report" type="button">Download JSON report</button><button id="video-check-runtime" type="button">Check Q4 WebGPU runtime</button></div><p id="video-runtime-status" role="status" aria-live="polite">The Q4 check runs a tiny packed-weight calculation without downloading the video model.</p></details>
      <div class="video-actions video-maintenance"><button id="video-release" type="button">Release video model</button><button id="video-clear" type="button">Clear Video Studio model cache</button></div>
      <p class="text-hint">Model: <a href="https://huggingface.co/${VIDEO_MODEL}/tree/${VIDEO_REVISION}" target="_blank" rel="noreferrer">${VIDEO_MODEL}</a> · revision <code>${VIDEO_REVISION}</code> · <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer">${VIDEO_LICENSE}</a>. The tokenizer is Flan-T5-Base (Apache-2.0); the compact TAEW2.2 decoder is from <a href="https://github.com/madebyollin/taehv" target="_blank" rel="noreferrer">TAEHV</a>. See the <a href="https://github.com/jrosbot/webllm-chat/blob/main/docs/video-studio-models.md" target="_blank" rel="noreferrer">model and quantization research</a>.</p>
    </section>
  </main>
  <footer><span>VIDEO STUDIO / LOCAL Q4 INFERENCE</span><span>No prompt or photo upload</span></footer>`;

const get = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const diffusion = new VideoDiffusion();
const generateButton = get<HTMLButtonElement>("#video-generate");
const cancelButton = get<HTMLButtonElement>("#video-cancel");
const status = get<HTMLParagraphElement>("#video-status");
const error = get<HTMLParagraphElement>("#video-error");
const prompt = get<HTMLTextAreaElement>("#video-prompt");
const progress = get<HTMLProgressElement>("#video-progress");
const result = get<HTMLElement>("#video-result");
const fileInput = get<HTMLInputElement>("#video-photo");
const photoCanvas = get<HTMLCanvasElement>("#video-photo-preview");
let metrics = newVideoMetrics();
let abort: AbortController | undefined;
let supported = false;
let photoFile: File | undefined;
let videoUrl: string | undefined;

function renderMetrics() {
  const rows: Record<string, string> = {
    "Model source": `${metrics.model} · ${metrics.revision.slice(0, 12)}`,
    "License": metrics.license,
    "Model data fetched": mb(metrics.modelFetchedBytes),
    "Model data read from cache": mb(metrics.modelCacheBytes),
    "Q4 generator artifact": metrics.q4ModelBytes === null ? "Not prepared" : mb(metrics.q4ModelBytes),
    "Q4 dense parameters": metrics.quantizedParameters === null ? "Not prepared" : metrics.quantizedParameters.toLocaleString(),
    "Packed MatMulNBits / Gemm nodes": metrics.q4MatMulNodes === null ? "Not prepared" : `${metrics.q4MatMulNodes} / ${metrics.q4GemmNodes}`,
    "Network fetch": seconds(metrics.fetchMs),
    "Cache read": seconds(metrics.cacheReadMs),
    "Cache write": seconds(metrics.cacheWriteMs),
    "SHA-256 checks": seconds(metrics.verificationMs),
    "FP16 → Q4 conversion": seconds(metrics.quantizationMs),
    "ONNX session creation": seconds(metrics.sessionLoadMs),
    "Tokenizer load": seconds(metrics.tokenizerLoadMs),
    "Prompt encoding": seconds(metrics.textEncodingMs),
    "First-frame encoding": seconds(metrics.imageEncodingMs),
    "Denoising": seconds(metrics.generationMs),
    "Frame decoding": seconds(metrics.decodeMs),
    "WebM encoding": seconds(metrics.videoEncodingMs),
    "Total run time": seconds(metrics.totalMs),
    "WebGPU + Q4 operator check": metrics.webgpuCheck,
    "Q4 check duration": seconds(metrics.webgpuCheckMs),
    "Peak observed JS heap": metrics.peakObservedJsHeapBytes === null ? "Unavailable" : mb(metrics.peakObservedJsHeapBytes),
    "Chrome deviceMemory hint": metrics.estimatedDeviceMemoryGb === null ? "Unavailable" : `about ${metrics.estimatedDeviceMemoryGb} GB`,
    "GPU / total phone memory": "Unavailable",
    "Run status": metrics.status,
  };
  const list = get<HTMLElement>("#video-metrics");
  list.replaceChildren(...Object.entries(rows).flatMap(([name, value]) => {
    const key = document.createElement("dt"); key.textContent = name;
    const val = document.createElement("dd"); val.textContent = value;
    return [key, val];
  }));
  progress.value = Math.min(MODEL_SOURCE_BYTES, metrics.modelFetchedBytes + metrics.modelCacheBytes);
}

function setBusy(busy: boolean) {
  generateButton.disabled = busy || !supported;
  cancelButton.hidden = !busy;
  progress.hidden = !busy;
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("#video-prompt, #video-photo, #video-seed, #video-steps, [data-video-example], #video-photo-clear, .video-maintenance button, #video-check-runtime").forEach(el => { el.disabled = busy; });
}

document.querySelectorAll<HTMLButtonElement>("[data-video-example]").forEach(button => button.addEventListener("click", () => { prompt.value = button.dataset.videoExample!; }));

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) { photoFile = undefined; photoCanvas.hidden = true; return; }
  photoFile = file;
  const localUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const context = photoCanvas.getContext("2d");
    if (context) {
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, Math.floor((image.naturalWidth - side) / 2), Math.floor((image.naturalHeight - side) / 2), side, side, 0, 0, 128, 128);
      photoCanvas.hidden = false;
    }
    URL.revokeObjectURL(localUrl);
  };
  image.onerror = () => { URL.revokeObjectURL(localUrl); error.textContent = "The selected image could not be previewed."; };
  image.src = localUrl;
  get<HTMLButtonElement>("#video-photo-clear").hidden = false;
  get<HTMLParagraphElement>("#video-photo-status").textContent = "Photo selected. It is used locally as the first frame and is never sent to a server.";
});

get<HTMLButtonElement>("#video-photo-clear").addEventListener("click", () => {
  photoFile = undefined; fileInput.value = ""; photoCanvas.hidden = true;
  get<HTMLButtonElement>("#video-photo-clear").hidden = true;
  get<HTMLParagraphElement>("#video-photo-status").textContent = `Leave empty for text-to-video, or add a photo to animate its first frame. The photo encoder downloads only when it is first needed (${mb(PHOTO_ENCODER_BYTES)}).`;
});

cancelButton.addEventListener("click", () => {
  abort?.abort(); cancelButton.disabled = true;
  status.textContent = "Cancelling after the current model or GPU operation…";
});

generateButton.addEventListener("click", async () => {
  if (!prompt.value.trim()) { error.textContent = "Enter a scene description first."; return; }
  const seed = Number(get<HTMLInputElement>("#video-seed").value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) { error.textContent = "Seed must be an integer from 0 to 4294967295."; return; }
  const steps = Number(get<HTMLSelectElement>("#video-steps").value);
  metrics = newVideoMetrics();
  Object.assign(metrics, { status: "loading", prompt: prompt.value.trim(), seed, steps, mode: photoFile ? "image-to-video" : "text-to-video" });
  abort = new AbortController();
  const signal = abort.signal;
  const runStarted = performance.now();
  result.hidden = true; error.textContent = ""; cancelButton.disabled = false;
  if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = undefined; }
  setBusy(true); renderMetrics();
  const sampleTimer = window.setInterval(() => { observeVideoHeap(metrics); renderMetrics(); }, 500);
  try {
    await diffusion.load(metrics, message => { if (!signal.aborted) status.textContent = message; }, signal);
    signal.throwIfAborted();
    let photo: Uint8Array | undefined;
    if (photoFile) {
      status.textContent = "Preparing the selected photo locally…";
      photo = await prepareVideoImage(photoFile);
    }
    metrics.status = "generating"; renderMetrics();
    const generated = await diffusion.generate(metrics.prompt, seed, steps, signal, message => { if (!signal.aborted) status.textContent = message; }, metrics, photo);
    metrics.mode = generated.mode;
    const frames = createVideoFrames(generated.rgb);
    status.textContent = "Encoding the short WebM preview…";
    const encodeStarted = performance.now();
    const blob = await recordVideoWebM(frames);
    metrics.videoEncodingMs = performance.now() - encodeStarted;
    videoUrl = URL.createObjectURL(blob);
    const video = get<HTMLVideoElement>("#video-preview"); video.src = videoUrl; video.load();
    const save = get<HTMLAnchorElement>("#video-save"); save.href = videoUrl; save.download = `drishya-tiny-q4-seed${seed}.webm`;
    get<HTMLElement>("#video-caption").textContent = `${metrics.mode} · ${steps} steps · seed ${seed} · 17 frames · 256 × 256 · Q4 dense weights`;
    result.hidden = false; metrics.status = "completed";
    status.textContent = "Video generated locally. Review the clip, then download the WebM and benchmark report.";
  } catch (reason) {
    metrics.status = "failed";
    metrics.error = signal.aborted ? "Cancelled. Browser storage and model caches are kept if they were completed." : reason instanceof Error ? reason.message : String(reason);
    error.textContent = metrics.error;
    status.textContent = signal.aborted ? "Cancelled." : "Video generation failed. Download the JSON report for measurements and the error.";
    await diffusion.release();
  } finally {
    metrics.totalMs = performance.now() - runStarted;
    clearInterval(sampleTimer); observeVideoHeap(metrics); renderMetrics(); abort = undefined; setBusy(false);
  }
});

get<HTMLButtonElement>("#video-check-runtime").addEventListener("click", async () => {
  setBusy(true); cancelButton.hidden = true;
  const started = performance.now();
  const runtimeStatus = get<HTMLParagraphElement>("#video-runtime-status");
  runtimeStatus.textContent = "Running a tiny packed-Q4 MatMulNBits calculation on WebGPU; no video weights are downloaded…";
  try {
    await diffusion.checkQ4Runtime();
    metrics.webgpuCheck = "passed";
    runtimeStatus.textContent = "Q4 runtime check passed: packed 4-bit weights on WebGPU returned [2, 3]. No video model files were requested.";
  } catch (reason) {
    metrics.webgpuCheck = "failed";
    metrics.error = reason instanceof Error ? reason.message : String(reason);
    runtimeStatus.textContent = `Q4 runtime check failed: ${metrics.error}. No video model files were downloaded.`;
  } finally {
    metrics.webgpuCheckMs = performance.now() - started; renderMetrics(); setBusy(false);
  }
});

get<HTMLButtonElement>("#video-report").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ recordedAt: new Date().toISOString(), browser: navigator.userAgent, ...metrics }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "video-studio-q4-benchmark.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

get<HTMLButtonElement>("#video-release").addEventListener("click", async () => {
  setBusy(true);
  try { await diffusion.release(); status.textContent = "Video model sessions released. Verified model files remain cached."; }
  finally { setBusy(false); }
});

get<HTMLButtonElement>("#video-clear").addEventListener("click", async () => {
  setBusy(true);
  try { await diffusion.clearCache(); status.textContent = "Video Studio model cache cleared. The next run will download and convert the generator again."; }
  catch (reason) { error.textContent = reason instanceof Error ? reason.message : String(reason); }
  finally { setBusy(false); }
});

renderMetrics();
void diffusion.checkWebGpu().then(() => {
  supported = true; generateButton.disabled = false;
  status.textContent = "WebGPU detected. No model files will download until you choose Generate.";
}).catch(reason => {
  const detail = reason instanceof Error ? reason.message : String(reason);
  error.textContent = detail; status.textContent = "This browser cannot run the local Q4 video model. No model weights were downloaded.";
});
