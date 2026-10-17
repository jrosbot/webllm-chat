import { ImageDiffusion, IMAGE_MODEL, IMAGE_REVISION, TOKENIZER_REVISION, MODEL_BYTES, imageCapability, observeHeap, type ImageMetrics } from "./imageDiffusion";
import "./style.css";
import "./imageStudio.css";
import { initializeImageRuntime } from "./imageRuntime";

document.querySelector<HTMLDivElement>("#image-app")!.innerHTML = `
  <header class="site-header"><a class="brand" href="./index.html">WEBLLM</a><nav class="app-nav" aria-label="Applications"><a href="./index.html">Text applications</a><a href="#image-studio" aria-current="page">Image vocabulary studio</a></nav><div class="local-pill">RUNS LOCALLY</div></header>
  <main>
    <section class="hero"><p class="eyebrow">EXPERIMENTAL · LOCAL IMAGE GENERATION</p><h1>Picture the phrase.</h1><p class="lede">Create a small visual cue for a word or phrase. Images are generated on this device; prompts are not sent to an image service.</p></section>
    <section class="workspace" id="image-studio" aria-labelledby="image-title">
      <div class="workspace-head"><h2 id="image-title">Image vocabulary studio</h2><span class="image-badge">LCM Tiny-SD · ONNX WebGPU</span></div>
      <p class="image-notice">First use downloads about <strong>993 MB</strong> of model files, plus the tokenizer and browser runtime; Chrome needs roughly 1 GB of free site storage to cache them. Requires WebGPU with shader-f16 and several GB of available memory. Models may misrepresent words or relationships; check each picture before using it as a learning cue.</p>
      <label for="image-prompt">WORD OR PHRASE · ENGLISH WORKS BEST</label>
      <textarea id="image-prompt" rows="3" maxlength="300">A cat sleeping under a wooden table, simple illustration, plain background</textarea>
      <div class="examples"><span>TRY AN EXAMPLE</span><button type="button" data-image-example="A red apple on a wooden table, simple illustration, plain background">An apple</button><button type="button" data-image-example="A cat sleeping under a wooden table, simple illustration, plain background">Under the table</button><button type="button" data-image-example="A woman drinking a glass of water, simple illustration, plain background">Drinking water</button></div>
      <div class="image-options">
        <label for="image-seed">Seed<input id="image-seed" type="number" min="0" max="4294967295" step="1" value="42"></label>
        <label for="image-steps">Inference steps<select id="image-steps"><option value="1">1 · fastest</option><option value="2">2</option><option value="4" selected>4 · default</option><option value="8">8</option></select></label>
        <label for="image-size">Saved image size<select id="image-size"><option value="128" selected>128 × 128</option><option value="256">256 × 256</option><option value="512">512 × 512</option></select></label>
        <label class="image-checkbox"><input id="image-grayscale" type="checkbox" checked>Black and white</label>
      </div>
      <p class="text-hint">The model generates at 512 × 512, then resizes locally. A smaller saved image does not reduce model size or inference memory. Seed repeats are best-effort across devices.</p>
      <div class="action-row"><p id="image-status" role="status" aria-live="polite">Checking WebGPU…</p><div class="image-actions"><button id="image-cancel" type="button" hidden>Cancel</button><button id="image-generate" class="generate" type="button" disabled>Generate image →</button></div></div>
      <progress id="image-progress" aria-label="Model files read" max="${MODEL_BYTES}" value="0" hidden></progress>
      <p id="image-error" class="error" role="alert"></p>
      <figure id="image-result" hidden><canvas id="image-canvas" width="128" height="128" role="img" aria-label="Generated vocabulary illustration"></canvas><figcaption id="image-caption"></figcaption><a id="image-save" download="vocabulary-image.png">Download PNG</a></figure>
      <details class="image-measurements" open><summary>Measurements on this device</summary><dl id="image-metrics"></dl><p class="text-hint">Fetched bytes count model response bodies, excluding tokenizer/runtime and HTTP overhead. Cached bytes are reported separately. JS heap is a sampled, browser-specific estimate; it excludes GPU memory and may omit native/WASM memory. Total memory is unavailable.</p><div class="image-actions"><button id="image-report" type="button">Download JSON report</button><button id="image-check-runtime" type="button">Check WebGPU runtime</button></div><p id="image-runtime-status" role="status" aria-live="polite">You can test the runtime without downloading image model weights.</p></details>
      <div class="image-actions image-maintenance"><button id="image-release" type="button">Release image model</button><button id="image-clear" type="button">Clear image model cache</button></div>
      <p class="text-hint">The cache controls affect only this studio’s model files. Tokenizer/runtime caches may remain. Closing this tab releases its sessions. <a href="https://huggingface.co/akameswa/lcm-tiny-sd-onnx-fp16" target="_blank" rel="noreferrer">Model source</a> · <a href="https://huggingface.co/segmind/tiny-sd" target="_blank" rel="noreferrer">Base model and license</a></p>
    </section>
  </main>`;

const get = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const button = get<HTMLButtonElement>("#image-generate");
const cancel = get<HTMLButtonElement>("#image-cancel");
const status = get<HTMLParagraphElement>("#image-status");
const error = get<HTMLParagraphElement>("#image-error");
const prompt = get<HTMLTextAreaElement>("#image-prompt");
const progress = get<HTMLProgressElement>("#image-progress");
const result = get<HTMLElement>("#image-result");
const diffusion = new ImageDiffusion();
let abort: AbortController | undefined;
let supported = false;
let imageUrl: string | undefined;
let metrics = newMetrics();

function newMetrics(): ImageMetrics {
  return {
    model: IMAGE_MODEL, revision: IMAGE_REVISION, tokenizerRevision: TOKENIZER_REVISION, modelArtifactBytes: MODEL_BYTES,
    modelFetchedBytes: 0, modelCacheBytes: 0, fetchMs: 0, verificationMs: 0, sessionLoadMs: 0, tokenizerLoadMs: 0, generationMs: null, totalMs: null,
    runtimeInitMs: null, runtimeCheck: "not-run",
    peakObservedJsHeapBytes: null, gpuMemoryBytes: null, prompt: "", seed: 42, steps: 4, outputSize: 128, grayscale: true, status: "not-started",
    notes: ["Experimental LCM Tiny-SD browser pipeline; image quality requires human review.", "The model generates at 512×512 before optional resizing and grayscale conversion.", "Model transfer sizes exclude tokenizer/runtime and HTTP overhead.", "Sampled JS heap is not total RAM or GPU VRAM; unsupported browsers report null."],
  };
}
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
const seconds = (n: number | null) => n === null ? "Not measured" : `${(n / 1000).toFixed(2)} s`;
function renderMetrics() {
  const rows = {
    "Model files fetched": mb(metrics.modelFetchedBytes), "Model files read from cache": mb(metrics.modelCacheBytes),
    "Fetch / cache read": seconds(metrics.fetchMs), "Checksum verification": seconds(metrics.verificationMs),
    "Session creation": seconds(metrics.sessionLoadMs), "Tokenizer load": seconds(metrics.tokenizerLoadMs),
    "Image generation": seconds(metrics.generationMs), "Total run time": seconds(metrics.totalMs),
    "WebGPU runtime check": metrics.runtimeCheck, "Runtime initialization": seconds(metrics.runtimeInitMs),
    "Peak observed JS heap": metrics.peakObservedJsHeapBytes === null ? "Unavailable" : mb(metrics.peakObservedJsHeapBytes),
    "GPU / total memory": "Unavailable",
  };
  get<HTMLElement>("#image-metrics").replaceChildren(...Object.entries(rows).flatMap(([name, value]) => {
    const key = document.createElement("dt"); key.textContent = name;
    const val = document.createElement("dd"); val.textContent = value;
    return [key, val];
  }));
  progress.value = metrics.modelFetchedBytes + metrics.modelCacheBytes;
}
function setBusy(busy: boolean) {
  button.disabled = busy || !supported;
  cancel.hidden = !busy;
  progress.hidden = !busy;
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(".image-options input, .image-options select, #image-prompt, [data-image-example], .image-maintenance button, #image-check-runtime").forEach(el => { el.disabled = busy; });
}

get<HTMLButtonElement>("#image-check-runtime").addEventListener("click", async () => {
  setBusy(true); cancel.hidden = true; progress.hidden = true;
  const start = performance.now();
  const runtimeStatus = get<HTMLParagraphElement>("#image-runtime-status");
  runtimeStatus.textContent = "Running a small calculation with the WebGPU backend…";
  try {
    await initializeImageRuntime(); metrics.runtimeCheck = "passed";
    runtimeStatus.textContent = "Runtime check passed: WebGPU calculated [1, 2] + [1, 2] = [2, 4]. Full image generation also requires shader-f16 and enough memory.";
  } catch (reason) {
    metrics.runtimeCheck = "failed"; metrics.error = reason instanceof Error ? reason.message : String(reason);
    runtimeStatus.textContent = `Runtime check failed: ${metrics.error}. Download the JSON report for diagnosis.`;
  } finally { metrics.runtimeInitMs = performance.now() - start; renderMetrics(); setBusy(false); }
});

document.querySelectorAll<HTMLButtonElement>("[data-image-example]").forEach(example => example.addEventListener("click", () => { prompt.value = example.dataset.imageExample!; }));
cancel.addEventListener("click", () => { abort?.abort(); cancel.disabled = true; status.textContent = "Cancelling after the current GPU operation…"; });
button.addEventListener("click", async () => {
  const seed = Number(get<HTMLInputElement>("#image-seed").value);
  if (!prompt.value.trim()) { error.textContent = "Enter a word or phrase first."; return; }
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) { error.textContent = "Seed must be an integer from 0 to 4294967295."; return; }
  metrics = newMetrics();
  metrics.status = "loading";
  Object.assign(metrics, { prompt: prompt.value.trim(), seed, steps: Number(get<HTMLSelectElement>("#image-steps").value), outputSize: Number(get<HTMLSelectElement>("#image-size").value), grayscale: get<HTMLInputElement>("#image-grayscale").checked });
  if (diffusion.loaded) metrics.notes.push("Sessions were reused from the previous run; no model fetch or session creation was needed.");
  abort = new AbortController();
  const signal = abort.signal;
  result.hidden = true; error.textContent = ""; cancel.disabled = false;
  if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = undefined; }
  setBusy(true); renderMetrics();
  const runStarted = performance.now();
  const sampleTimer = window.setInterval(() => { observeHeap(metrics); renderMetrics(); }, 500);
  let started: number | undefined;
  try {
    await diffusion.load(metrics, message => { if (!signal.aborted) status.textContent = message; }, signal);
    signal.throwIfAborted();
    metrics.status = "generating";
    started = performance.now();
    const generated = await diffusion.generate(metrics.prompt, metrics.seed, metrics.steps, signal, message => { if (!signal.aborted) status.textContent = message; });
    metrics.generationMs = performance.now() - started;
    const source = document.createElement("canvas"); source.width = source.height = 512;
    source.getContext("2d")!.putImageData(generated, 0, 0);
    const canvas = get<HTMLCanvasElement>("#image-canvas"); canvas.width = canvas.height = metrics.outputSize;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (metrics.grayscale) {
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < image.data.length; i += 4) {
        const gray = Math.round(image.data[i] * 0.2126 + image.data[i + 1] * 0.7152 + image.data[i + 2] * 0.0722);
        image.data[i] = image.data[i + 1] = image.data[i + 2] = gray;
      }
      ctx.putImageData(image, 0, 0);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("Could not encode the PNG.")), "image/png"));
    imageUrl = URL.createObjectURL(blob); get<HTMLAnchorElement>("#image-save").href = imageUrl;
    get<HTMLElement>("#image-caption").textContent = `${metrics.prompt} · seed ${seed} · ${metrics.steps} steps · ${canvas.width} × ${canvas.height}`;
    result.hidden = false; metrics.status = "completed";
    status.textContent = "Image generated locally. Review the picture and download the measurements.";
  } catch (reason) {
    if (started !== undefined && metrics.generationMs === null) metrics.generationMs = performance.now() - started;
    metrics.status = "failed";
    metrics.error = signal.aborted ? "Cancelled. GPU operations finish before sessions can be released." : reason instanceof Error ? reason.message : String(reason);
    error.textContent = metrics.error; status.textContent = signal.aborted ? "Cancelled." : "Image generation failed. The report includes the error.";
    await diffusion.release();
  } finally {
    metrics.totalMs = performance.now() - runStarted;
    clearInterval(sampleTimer); observeHeap(metrics); renderMetrics(); abort = undefined; setBusy(false);
  }
});

get<HTMLButtonElement>("#image-report").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ recordedAt: new Date().toISOString(), browser: navigator.userAgent, ...metrics }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "image-vocabulary-benchmark.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
get<HTMLButtonElement>("#image-release").addEventListener("click", async () => {
  setBusy(true);
  try { await diffusion.release(); status.textContent = "Image model released. Cached files remain available."; }
  finally { setBusy(false); }
});
get<HTMLButtonElement>("#image-clear").addEventListener("click", async () => {
  setBusy(true);
  try { await diffusion.clearCache(); status.textContent = "Image model cache cleared. The next run will download the model again."; }
  catch (reason) { error.textContent = reason instanceof Error ? reason.message : String(reason); }
  finally { setBusy(false); }
});
renderMetrics();
void imageCapability().then(() => {
  supported = true; button.disabled = false; status.textContent = "WebGPU with shader-f16 detected. The model loads only when you generate.";
}).catch(reason => {
  metrics.status = "failed"; metrics.error = reason instanceof Error ? reason.message : String(reason);
  error.textContent = metrics.error!; status.textContent = "This device cannot run the image model. No model weights downloaded.";
});
