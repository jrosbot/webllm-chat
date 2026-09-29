import * as webllm from "@mlc-ai/web-llm";
import { pipeline, type Text2TextGenerationPipeline, type TextGenerationPipeline } from "@huggingface/transformers";
import { CacheManager, LoggerWithoutDebug, Wllama } from "@wllama/wllama";
import wllamaWasmUrl from "@wllama/wllama/esm/wasm/wllama.wasm?url";
import { createSearchPrompt, MAX_GENERATED_TOKENS, MAX_REQUEST_LENGTH, type SearchPlatform } from "./searchPrompt";
import { renderOperatorReference } from "./operatorReference";
import { PerformanceLog, performancePanel } from "./performanceLog";
import { createSearchQuery, createSearchUrl } from "./searchQuery";
import { createTransformersInput, type TransformersPromptStyle } from "./transformersPrompt";
import "./style.css";

type Backend = "webllm" | "transformers";
type Model = {
  id: string;
  label: string;
  note: string;
  runtime: "webllm" | "gguf" | "transformers";
  file?: string;
  device?: "wasm" | "webgpu";
  dtype?: "q4" | "q8" | "q4f16";
  pipelineTask?: "text-generation" | "text2text-generation";
  promptStyle?: TransformersPromptStyle;
  requiresShaderF16?: boolean;
};

const MODELS: Record<Backend, Model[]> = {
  webllm: [
    { id: "SmolLM2-360M-Instruct-q4f32_1-MLC", runtime: "webllm", label: "SmolLM2 360M Q4 · recommended", note: "Small and capable · broad WebGPU compatibility" },
    { id: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC", runtime: "webllm", label: "Qwen 2.5 0.5B Q4 · compact", note: "Quantized instruction model · broad WebGPU compatibility" },
    { id: "Qwen2.5-Coder-0.5B-Instruct-q4f32_1-MLC", runtime: "webllm", label: "Qwen 2.5 Coder 0.5B Q4 · compact", note: "Small code-specialized model · broad WebGPU compatibility" },
    { id: "Qwen3-0.6B-q4f32_1-MLC", runtime: "webllm", label: "Qwen 3 0.6B Q4 · compact", note: "Newer quantized model · broad WebGPU compatibility" },
    { id: "Qwen3.5-0.8B-q4f32_1-MLC", runtime: "webllm", label: "Qwen 3.5 0.8B Q4 · balanced", note: "More capable quantized model · moderate download" },
    { id: "TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC-1k", runtime: "webllm", label: "TinyLlama 1.1B Q4 · chat", note: "Quantized chat model · 1,024-token context" },
    { id: "Llama-3.2-1B-Instruct-q4f32_1-MLC", runtime: "webllm", label: "Llama 3.2 1B Q4 · quality", note: "Strong results · larger download" },
    { id: "gemma3-1b-it-q4f16_1-MLC", runtime: "webllm", requiresShaderF16: true, label: "Gemma 3 1B Q4/F16 · instruction", note: "Compact instruction model · requires shader-f16" },
    { id: "SmolLM2-1.7B-Instruct-q4f32_1-MLC", runtime: "webllm", label: "SmolLM2 1.7B Q4 · quality", note: "Larger quantized model · broad WebGPU compatibility" },
    { id: "Qwen3-1.7B-q4f32_1-MLC", runtime: "webllm", label: "Qwen 3 1.7B Q4 · quality", note: "More capable quantized model · larger download" },
    { id: "SmolLM2-135M-Instruct-q0f16-MLC", runtime: "webllm", requiresShaderF16: true, label: "SmolLM2 135M F16 · smallest", note: "Fewest parameters · requires shader-f16" },
  ],
  transformers: [
    { id: "unsloth/SmolLM2-135M-Instruct-GGUF", file: "SmolLM2-135M-Instruct-Q2_K.gguf", runtime: "gguf", label: "SmolLM2 135M Q2_K · CPU", note: "Smallest model · 88.2 MB · works without WebGPU" },
    { id: "HuggingFaceTB/SmolLM2-135M-Instruct", runtime: "transformers", device: "wasm", dtype: "q4", label: "SmolLM2 135M Q4 · CPU", note: "Higher-precision 135M model · works without WebGPU" },
    { id: "fbaldassarri/HuggingFaceTB_SmolLM2-135M-auto_round-int4-gs128-sym", runtime: "transformers", device: "wasm", dtype: "q4", promptStyle: "completion", label: "SmolLM2 135M AutoRound INT4 · CPU", note: "Group-size 128 symmetric 4-bit model · works without WebGPU" },
    { id: "cisco-ai/mini-bart-g2p", runtime: "transformers", device: "wasm", dtype: "q8", pipelineTask: "text2text-generation", promptStyle: "completion", label: "Mini-BART G2P · CPU", note: "Compact encoder-decoder model · experimental query quality" },
    { id: "Squeal-Studio/squeal_ai_20m-instruct", runtime: "transformers", device: "wasm", dtype: "q8", promptStyle: "completion", label: "Squeal AI 20M Instruct · CPU", note: "Tiny instruction model · experimental query quality" },
    { id: "AlgorithmicResearchGroup/gpt2-xs", runtime: "transformers", device: "wasm", dtype: "q8", promptStyle: "completion", label: "GPT-2 XS · CPU", note: "Extra-small completion model · experimental query quality" },
    { id: "glassbox/gpt-alpha-bg-14m-onnx", runtime: "transformers", device: "wasm", dtype: "q8", promptStyle: "completion", label: "GPT Alpha BG 14M ONNX · CPU", note: "Tiny ONNX completion model · experimental query quality" },
    { id: "onnx-community/gemma-3-270m-ONNX", runtime: "transformers", device: "wasm", dtype: "q4", promptStyle: "gemma", label: "Gemma 3 270M Q4 · CPU", note: "Compact 4-bit instruction model · works without WebGPU" },
    { id: "Xenova/gpt2", runtime: "transformers", device: "wasm", dtype: "q8", promptStyle: "completion", label: "GPT-2 124M Q8 · CPU", note: "Tiny completion model · experimental query quality" },
    { id: "unsloth/Qwen3.5-0.8B-GGUF", file: "Qwen3.5-0.8B-UD-IQ2_XXS.gguf", runtime: "gguf", label: "Qwen3.5 0.8B IQ2 XXS · CPU", note: "Smallest 2-bit GGUF · 338 MB · works without WebGPU" },
    { id: "onnx-community/gemma-3-270m-ONNX", runtime: "transformers", device: "webgpu", dtype: "q4f16", promptStyle: "gemma", requiresShaderF16: true, label: "Gemma 3 270M Q4/F16 · WebGPU", note: "Compact 4-bit weights and F16 compute · requires shader-f16" },
    { id: "onnx-community/Qwen3-0.6B-ONNX", runtime: "transformers", device: "webgpu", dtype: "q4f16", requiresShaderF16: true, label: "Qwen 3 0.6B Q4/F16 · WebGPU", note: "4-bit weights and F16 compute · requires shader-f16" },
    { id: "onnx-community/Llama-3.2-1B-Instruct-ONNX", runtime: "transformers", device: "webgpu", dtype: "q4f16", requiresShaderF16: true, label: "Llama 3.2 1B Q4/F16 · WebGPU", note: "4-bit weights and F16 compute · requires shader-f16" },
    { id: "HuggingFaceTB/SmolLM2-360M-Instruct", runtime: "transformers", device: "webgpu", dtype: "q4", label: "SmolLM2 360M · balanced", note: "Better results · moderate download · requires WebGPU" },
    { id: "HuggingFaceTB/SmolLM2-1.7B-Instruct", runtime: "transformers", device: "webgpu", dtype: "q4", label: "SmolLM2 1.7B · quality", note: "Best results · largest download · requires WebGPU" },
  ],
};

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#" aria-label="Issue Query home"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span>ISSUE QUERY</span></a>
    <div class="local-pill"><span class="pulse"></span> RUNS LOCALLY</div>
  </header>
  <main>
    <section class="hero"><p class="eyebrow">AI-POWERED ISSUE SEARCH</p><h1>Find the signal.<br><em>Skip the noise.</em></h1><p class="lede">Describe what you're looking for in plain language. Get a precise search query for GitHub or GitLab — generated privately, right in your browser.</p></section>
    <section class="workspace" aria-labelledby="form-title">
      <div class="workspace-head"><div><span class="step">01</span><h2 id="form-title">What issues are you looking for?</h2></div><div class="platform" role="radiogroup" aria-label="Platform"><button class="platform-button active" data-platform="GitHub" role="radio" aria-checked="true">GitHub</button><button class="platform-button" data-platform="GitLab" role="radio" aria-checked="false">GitLab</button></div></div>
      <textarea id="description" rows="4" maxlength="${MAX_REQUEST_LENGTH}" placeholder="e.g. Open accessibility bugs assigned to me, created this month, with more than 5 comments…" aria-label="Issue description"></textarea>
      <div class="examples"><span>TRY AN EXAMPLE</span><button data-example="Good first issues in TypeScript repositories with no assignee">Good first issues</button><button data-example="Open security bugs created this month with more than 5 comments">Recent security bugs</button><button data-example="Documentation issues assigned to me that have not been updated in 30 days">Stale docs assigned to me</button></div>
      <details class="operator-reference"><summary>Real search operators <span>REFERENCE</span></summary><div id="operator-reference-content">${renderOperatorReference("GitHub")}</div></details>
      <div class="runtime-picker">
        <label for="backend">INFERENCE ENGINE</label>
        <div><select id="backend" aria-describedby="backend-note" disabled><option value="webllm">WebLLM · GPU</option><option value="transformers">Transformers.js · CPU / GPU</option></select><span id="backend-note">Checking WebGPU availability…</span></div>
      </div>
      <div class="model-picker"><label for="model">LOCAL MODEL</label><div><select id="model" aria-describedby="model-note"></select><span id="model-note"></span></div></div>
      <div class="action-row"><div class="status-wrap"><span id="status-dot" class="status-dot"></span><span id="status">Selecting the best engine for this device…</span></div><button id="generate" class="generate" disabled><span>Generate query</span><b aria-hidden="true">→</b></button></div>
      <div id="progress-wrap" class="progress-wrap" hidden><div id="progress" class="progress"></div></div>
      <div id="download-help" class="download-help" hidden><span id="download-detail">The first download may take a few minutes. Keep this tab open.</span><button id="reset-download" type="button" hidden>Clear download &amp; retry</button></div>
      <div id="result" class="result" hidden><div class="result-label"><span>02</span> YOUR SEARCH QUERY</div><div class="query-row"><code id="query"></code><button id="copy" aria-label="Copy query">COPY</button></div><a id="open-search" target="_blank" rel="noopener">Open search <span>↗</span></a></div>
      <p id="error" class="error" role="alert"></p>
    </section>
    ${performancePanel}
    <section class="trust-grid"><article><span>◈</span><div><h3>100% private</h3><p>Your text never leaves this device.</p></div></article><article><span>⌁</span><div><h3 id="engine-heading">Local inference</h3><p id="engine-description">The language model runs in your browser.</p></div></article><article><span>◎</span><div><h3>Works offline</h3><p>Once downloaded, the model is cached.</p></div></article></section>
  </main>
  <footer><span>ISSUE QUERY / 2026</span><span id="footer-engine">Local AI · No data collected</span></footer>`;

type LocalEngine = webllm.MLCEngineInterface | TextGenerationPipeline | Text2TextGenerationPipeline | Wllama;
let platform: SearchPlatform = "GitHub";
let backend: Backend = "transformers";
let engine: LocalEngine | null = null;
let loading: Promise<LocalEngine> | null = null;
let loadedRuntime: Model["runtime"] | null = null;
let ggufEngine: Wllama | null = null;
let stallTimer: number | undefined;
let hasWebGpu = false;
let hasShaderF16 = false;

const get = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const description = get<HTMLTextAreaElement>("#description");
const generate = get<HTMLButtonElement>("#generate");
const status = get<HTMLSpanElement>("#status");
const statusDot = get<HTMLSpanElement>("#status-dot");
const progressWrap = get<HTMLDivElement>("#progress-wrap");
const progress = get<HTMLDivElement>("#progress");
const result = get<HTMLDivElement>("#result");
const query = get<HTMLElement>("#query");
const error = get<HTMLParagraphElement>("#error");
const openSearch = get<HTMLAnchorElement>("#open-search");
const downloadHelp = get<HTMLDivElement>("#download-help");
const downloadDetail = get<HTMLSpanElement>("#download-detail");
const resetDownload = get<HTMLButtonElement>("#reset-download");
const backendSelect = get<HTMLSelectElement>("#backend");
const backendNote = get<HTMLSpanElement>("#backend-note");
const modelSelect = get<HTMLSelectElement>("#model");
const modelNote = get<HTMLSpanElement>("#model-note");
const operatorReference = get<HTMLDivElement>("#operator-reference-content");
const performanceLog = new PerformanceLog(get<HTMLElement>(".performance-panel"));

function selectedModel() { return MODELS[backend].find(({ id }) => id === modelSelect.value) ?? MODELS[backend][0]; }
function renderModels() {
  modelSelect.innerHTML = MODELS[backend].map(({ id, label, requiresShaderF16 }) =>
    `<option value="${id}"${requiresShaderF16 && !hasShaderF16 ? " disabled" : ""}>${label}${requiresShaderF16 && !hasShaderF16 ? " · unsupported" : ""}</option>`,
  ).join("");
  modelNote.textContent = selectedModel().note;
}
function updateBackendCopy() {
  const web = backend === "webllm";
  backendNote.textContent = web ? "WebGPU detected · WebLLM selected automatically" : hasWebGpu ? "Transformers.js selected manually" : "No WebGPU detected · CPU fallback selected automatically";
  get<HTMLElement>("#engine-heading").textContent = web ? "Powered by WebLLM" : "Powered by Transformers.js";
  get<HTMLElement>("#footer-engine").textContent = `Built with ${web ? "WebLLM" : "Transformers.js"} · No data collected`;
}
async function unloadEngine() {
  if (!engine) return;
  if (loadedRuntime === "webllm") await (engine as webllm.MLCEngineInterface).unload();
  else if (loadedRuntime === "gguf") await (engine as Wllama).exit();
  else await (engine as TextGenerationPipeline | Text2TextGenerationPipeline).dispose();
}
async function changeSelection(nextBackend = backend, refreshModels = true) {
  backendSelect.disabled = true; modelSelect.disabled = true; generate.disabled = true;
  status.textContent = "Switching inference engine…"; statusDot.classList.remove("ready"); error.textContent = "";
  try { await unloadEngine(); } catch { error.textContent = "The previous model could not be fully unloaded, but you can still continue."; }
  engine = null; loading = null; loadedRuntime = null; ggufEngine = null; backend = nextBackend;
  backendSelect.value = backend; if (refreshModels) renderModels(); updateBackendCopy();
  status.textContent = `${selectedModel().label} · loads on first use`;
  backendSelect.disabled = false; modelSelect.disabled = false; generate.disabled = false;
}
function armStallWarning() {
  window.clearTimeout(stallTimer);
  stallTimer = window.setTimeout(() => { downloadDetail.textContent = "No progress for a while. Check your connection, or clear the partial download and retry."; resetDownload.hidden = false; }, 45_000);
}

backendSelect.addEventListener("change", () => void changeSelection(backendSelect.value as Backend));
modelSelect.addEventListener("change", () => void changeSelection(backend, false));
document.querySelectorAll<HTMLButtonElement>(".platform-button").forEach((button) => button.addEventListener("click", () => {
  platform = button.dataset.platform as SearchPlatform; operatorReference.innerHTML = renderOperatorReference(platform);
  document.querySelectorAll<HTMLButtonElement>(".platform-button").forEach((item) => { const active = item === button; item.classList.toggle("active", active); item.setAttribute("aria-checked", String(active)); });
}));
document.querySelectorAll<HTMLButtonElement>("[data-example]").forEach((button) => button.addEventListener("click", () => { description.value = button.dataset.example!; description.focus(); }));

async function loadEngine() {
  if (engine) return engine;
  const model = selectedModel(); const downloadStarted = performance.now(); let loadStarted = downloadStarted; let downloadRecorded = false;
  const finishDownloadTiming = () => { if (downloadRecorded) return; performanceLog.add(model.label, "Model download", downloadStarted); downloadRecorded = true; loadStarted = performance.now(); };
  if (model.device === "webgpu" && !hasWebGpu) throw new Error("WebGPU is not available. Choose a CPU model instead.");
  if (model.requiresShaderF16 && !hasShaderF16) throw new Error("This model requires the WebGPU shader-f16 feature. Choose a compatible Q4 model instead.");
  if (!loading) {
    modelSelect.disabled = true; backendSelect.disabled = true; status.textContent = "Downloading model…"; statusDot.classList.add("loading"); progressWrap.hidden = false; downloadHelp.hidden = false; resetDownload.hidden = true; armStallWarning();
    const updateProgress = (amount: number, detail = "Downloading model files…") => { const percent = Math.round(amount); status.textContent = `Downloading model — ${percent}%`; downloadDetail.textContent = detail; progress.style.width = `${percent}%`; if (percent >= 100) finishDownloadTiming(); armStallWarning(); };
    loadedRuntime = model.runtime;
    if (model.runtime === "webllm") {
      loading = webllm.CreateMLCEngine(model.id, { initProgressCallback: ({ progress: amount, text }) => updateProgress(amount * 100, text) });
    } else if (model.runtime === "gguf") {
      ggufEngine = new Wllama({ default: wllamaWasmUrl }, { logger: LoggerWithoutDebug });
      loading = ggufEngine.loadModelFromHF({ repo: model.id, file: model.file! }, { n_ctx: 1024, progressCallback: ({ loaded, total }) => updateProgress(total ? (loaded / total) * 100 : 0) }).then(() => ggufEngine!);
    } else {
      const options = { device: model.device, dtype: model.dtype, progress_callback: (event: { status: string; progress?: number }) => { if (event.status === "progress" && event.progress !== undefined) updateProgress(event.progress); } };
      loading = model.pipelineTask === "text2text-generation"
        ? pipeline("text2text-generation", model.id, options)
        : pipeline("text-generation", model.id, options);
    }
  }
  engine = await loading; finishDownloadTiming(); performanceLog.add(model.label, "Model load", loadStarted); window.clearTimeout(stallTimer);
  status.textContent = "Model ready"; statusDot.classList.remove("loading"); statusDot.classList.add("ready"); progressWrap.hidden = true; downloadHelp.hidden = true; return engine;
}

resetDownload.addEventListener("click", async () => {
  resetDownload.disabled = true; downloadDetail.textContent = "Clearing the incomplete model download…";
  try {
    const model = selectedModel();
    if (model.runtime === "webllm") await webllm.deleteModelAllInfoInCache(model.id);
    else if (model.runtime === "gguf") await (ggufEngine?.cacheManager ?? new CacheManager()).clear();
    else if ("caches" in window) await window.caches.delete("transformers-cache");
  } finally { window.location.reload(); }
});

generate.addEventListener("click", async () => {
  const request = description.value.trim(); error.textContent = ""; result.hidden = true;
  if (!request) { error.textContent = "Describe the issues you want to find first."; description.focus(); return; }
  generate.disabled = true; modelSelect.disabled = true; backendSelect.disabled = true; generate.querySelector("span")!.textContent = "Loading model…";
  let generationStarted: number | null = null; const model = selectedModel();
  try {
    const llm = await loadEngine(); generate.querySelector("span")!.textContent = "Generating…"; generationStarted = performance.now(); let generatedText = "";
    if (model.runtime === "webllm") {
      const response = await (llm as webllm.MLCEngineInterface).chat.completions.create({ temperature: 0.1, max_tokens: MAX_GENERATED_TOKENS, messages: [{ role: "system", content: createSearchPrompt(platform) }, { role: "user", content: request }] });
      generatedText = response.choices[0]?.message?.content ?? "";
    } else if (model.runtime === "gguf") {
      const response = await (llm as Wllama).createChatCompletion({ messages: [{ role: "system", content: createSearchPrompt(platform) }, { role: "user", content: request }], max_tokens: MAX_GENERATED_TOKENS, temperature: 0 });
      generatedText = response.choices[0]?.message.content ?? "";
    } else {
      const input = createTransformersInput(model.promptStyle, createSearchPrompt(platform), request);
      if (model.pipelineTask === "text2text-generation") {
        const response = await (llm as Text2TextGenerationPipeline)(input as string, { max_new_tokens: MAX_GENERATED_TOKENS, do_sample: false });
        generatedText = response[0]?.generated_text ?? "";
      } else {
        const response = await (llm as TextGenerationPipeline)(input, { max_new_tokens: MAX_GENERATED_TOKENS, do_sample: false, return_full_text: false });
        const generated = response[0]?.generated_text; const lastContent = typeof generated === "string" ? generated : generated?.at(-1)?.content; generatedText = typeof lastContent === "string" ? lastContent : "";
      }
    }
    const output = createSearchQuery(platform, request, generatedText); if (!output) throw new Error("The model returned an empty query. Please try again.");
    query.textContent = output; openSearch.href = createSearchUrl(platform, output); result.hidden = false; performanceLog.add(model.label, "Output generation", generationStarted);
  } catch (reason) {
    if (generationStarted !== null) performanceLog.add(model.label, "Output generation", generationStarted, "Failed");
    window.clearTimeout(stallTimer); error.textContent = reason instanceof Error ? reason.message : "The model could not be loaded. Please try again."; status.textContent = "Model download interrupted"; statusDot.classList.remove("loading"); downloadDetail.textContent = "The download did not finish. Clear its partial cache before trying again."; downloadHelp.hidden = false; resetDownload.hidden = false; loading = null; loadedRuntime = null; ggufEngine = null;
  } finally { generate.disabled = false; modelSelect.disabled = false; backendSelect.disabled = false; generate.querySelector("span")!.textContent = "Generate query"; }
});

get<HTMLButtonElement>("#copy").addEventListener("click", async (event) => { await navigator.clipboard.writeText(query.textContent ?? ""); const button = event.currentTarget as HTMLButtonElement; button.textContent = "COPIED"; setTimeout(() => (button.textContent = "COPY"), 1400); });

async function detectBackend() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features?: { has(feature: string): boolean } } | null> } }).gpu;
  try {
    const adapter = gpu ? await gpu.requestAdapter() : null;
    hasWebGpu = Boolean(adapter);
    hasShaderF16 = Boolean(adapter?.features?.has("shader-f16"));
  } catch {
    hasWebGpu = false;
    hasShaderF16 = false;
  }
  await changeSelection(hasWebGpu ? "webllm" : "transformers");
}
renderModels();
void detectBackend();
