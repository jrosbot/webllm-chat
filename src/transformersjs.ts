import { pipeline, type TextGenerationPipeline } from "@huggingface/transformers";
import { CacheManager, LoggerWithoutDebug, Wllama } from "@wllama/wllama";
import wllamaWasmUrl from "@wllama/wllama/esm/wasm/wllama.wasm?url";
import { createSearchPrompt, MAX_GENERATED_TOKENS, MAX_REQUEST_LENGTH, type SearchPlatform } from "./searchPrompt";
import { renderOperatorReference } from "./operatorReference";
import { PerformanceLog, performancePanel } from "./performanceLog";
import { createSearchQuery, createSearchUrl } from "./searchQuery";
import "./style.css";

const MODELS = [
  {
    id: "unsloth/SmolLM2-135M-Instruct-GGUF",
    file: "SmolLM2-135M-Instruct-Q2_K.gguf",
    backend: "gguf",
    label: "SmolLM2 135M Q2_K · CPU",
    note: "Smallest model · 88.2 MB · works without WebGPU",
  },
  {
    id: "HuggingFaceTB/SmolLM2-135M-Instruct",
    backend: "transformers",
    device: "wasm",
    dtype: "q4",
    label: "SmolLM2 135M Q4 · CPU",
    note: "Higher-precision 135M model · works without WebGPU",
  },
  {
    id: "unsloth/Qwen3.5-0.8B-GGUF",
    file: "Qwen3.5-0.8B-UD-IQ2_XXS.gguf",
    backend: "gguf",
    label: "Qwen3.5 0.8B IQ2 XXS · CPU",
    note: "Smallest 2-bit GGUF · 338 MB · works without WebGPU",
  },
  {
    id: "HuggingFaceTB/SmolLM2-360M-Instruct",
    backend: "transformers",
    device: "webgpu",
    dtype: "q4",
    label: "SmolLM2 360M · balanced",
    note: "Better results · moderate download",
  },
  {
    id: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    backend: "transformers",
    device: "webgpu",
    dtype: "q4",
    label: "SmolLM2 1.7B · quality",
    note: "Best results · largest download and memory use",
  },
] as const;

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#" aria-label="Issue Query home">
      <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
      <span>ISSUE QUERY</span>
    </a>
    <div class="header-actions">
      <a class="backend-link" href="./webllm.html">Use WebLLM →</a>
      <div class="local-pill"><span class="pulse"></span> RUNS LOCALLY</div>
    </div>
  </header>

  <main>
    <section class="hero">
      <p class="eyebrow">AI-POWERED ISSUE SEARCH</p>
      <h1>Find the signal.<br><em>Skip the noise.</em></h1>
      <p class="lede">Describe what you're looking for in plain language. Get a precise search query for GitHub or GitLab — generated privately, right in your browser.</p>
    </section>

    <section class="workspace" aria-labelledby="form-title">
      <div class="workspace-head">
        <div>
          <span class="step">01</span>
          <h2 id="form-title">What issues are you looking for?</h2>
        </div>
        <div class="platform" role="radiogroup" aria-label="Platform">
          <button class="platform-button active" data-platform="GitHub" role="radio" aria-checked="true">GitHub</button>
          <button class="platform-button" data-platform="GitLab" role="radio" aria-checked="false">GitLab</button>
        </div>
      </div>

      <textarea id="description" rows="4" maxlength="${MAX_REQUEST_LENGTH}" placeholder="e.g. Open accessibility bugs assigned to me, created this month, with more than 5 comments…" aria-label="Issue description"></textarea>
      <div class="examples">
        <span>TRY AN EXAMPLE</span>
        <button data-example="Good first issues in TypeScript repositories with no assignee">Good first issues</button>
        <button data-example="Open security bugs created this month with more than 5 comments">Recent security bugs</button>
        <button data-example="Documentation issues assigned to me that have not been updated in 30 days">Stale docs assigned to me</button>
      </div>
      <details class="operator-reference">
        <summary>Real search operators <span>REFERENCE</span></summary>
        <div id="operator-reference-content">${renderOperatorReference("GitHub")}</div>
      </details>

      <div class="model-picker">
        <label for="model">LOCAL MODEL</label>
        <div>
          <select id="model" aria-describedby="model-note">
            ${MODELS.map(({ id, label }) => `<option value="${id}">${label}</option>`).join("")}
          </select>
          <span id="model-note">${MODELS[0].note}</span>
        </div>
      </div>

      <div class="action-row">
        <div class="status-wrap">
          <span id="status-dot" class="status-dot"></span>
          <span id="status">${MODELS[0].label} · loads on first use</span>
        </div>
        <button id="generate" class="generate"><span>Generate query</span><b aria-hidden="true">→</b></button>
      </div>
      <div id="progress-wrap" class="progress-wrap" hidden><div id="progress" class="progress"></div></div>
      <div id="download-help" class="download-help" hidden>
        <span id="download-detail">The first download may take a few minutes. Keep this tab open.</span>
        <button id="reset-download" type="button" hidden>Clear download &amp; retry</button>
      </div>

      <div id="result" class="result" hidden>
        <div class="result-label"><span>02</span> YOUR SEARCH QUERY</div>
        <div class="query-row"><code id="query"></code><button id="copy" aria-label="Copy query">COPY</button></div>
        <a id="open-search" target="_blank" rel="noopener">Open search <span>↗</span></a>
      </div>
      <p id="error" class="error" role="alert"></p>
    </section>

    ${performancePanel}

    <section class="trust-grid">
      <article><span>◈</span><div><h3>100% private</h3><p>Your text never leaves this device.</p></div></article>
      <article><span>⌁</span><div><h3>Powered by Transformers.js</h3><p>The language model runs in your browser.</p></div></article>
      <article><span>◎</span><div><h3>Works offline</h3><p>Once downloaded, the model is cached.</p></div></article>
    </section>
  </main>
  <footer><span>ISSUE QUERY / 2026</span><span>Built with Transformers.js · No data collected</span></footer>
`;

let platform: SearchPlatform = "GitHub";
type LocalEngine = TextGenerationPipeline | Wllama;

let engine: LocalEngine | null = null;
let loading: Promise<LocalEngine> | null = null;
let loadedBackend: (typeof MODELS)[number]["backend"] | null = null;
let ggufEngine: Wllama | null = null;

const description = document.querySelector<HTMLTextAreaElement>("#description")!;
const generate = document.querySelector<HTMLButtonElement>("#generate")!;
const status = document.querySelector<HTMLSpanElement>("#status")!;
const statusDot = document.querySelector<HTMLSpanElement>("#status-dot")!;
const progressWrap = document.querySelector<HTMLDivElement>("#progress-wrap")!;
const progress = document.querySelector<HTMLDivElement>("#progress")!;
const result = document.querySelector<HTMLDivElement>("#result")!;
const query = document.querySelector<HTMLElement>("#query")!;
const error = document.querySelector<HTMLParagraphElement>("#error")!;
const openSearch = document.querySelector<HTMLAnchorElement>("#open-search")!;
const downloadHelp = document.querySelector<HTMLDivElement>("#download-help")!;
const downloadDetail = document.querySelector<HTMLSpanElement>("#download-detail")!;
const resetDownload = document.querySelector<HTMLButtonElement>("#reset-download")!;
const modelSelect = document.querySelector<HTMLSelectElement>("#model")!;
const modelNote = document.querySelector<HTMLSpanElement>("#model-note")!;
const operatorReference = document.querySelector<HTMLDivElement>("#operator-reference-content")!;
const performanceLog = new PerformanceLog(document.querySelector<HTMLElement>(".performance-panel")!);
let stallTimer: number | undefined;

function selectedModel() {
  return MODELS.find(({ id }) => id === modelSelect.value) ?? MODELS[0];
}

modelSelect.addEventListener("change", async () => {
  modelSelect.disabled = true;
  generate.disabled = true;
  status.textContent = "Switching models…";
  statusDot.classList.remove("ready");
  try {
    if (engine) {
      if (loadedBackend === "gguf") await (engine as Wllama).exit();
      else await (engine as TextGenerationPipeline).dispose();
    }
  } catch {
    error.textContent = "The previous model could not be fully unloaded, but you can still try another model.";
  } finally {
    engine = null;
    loading = null;
    loadedBackend = null;
    ggufEngine = null;
    modelNote.textContent = selectedModel().note;
    status.textContent = `${selectedModel().label} · loads on first use`;
    modelSelect.disabled = false;
    generate.disabled = false;
  }
});

function armStallWarning() {
  window.clearTimeout(stallTimer);
  stallTimer = window.setTimeout(() => {
    downloadDetail.textContent = "No progress for a while. Check your connection, or clear the partial download and retry.";
    resetDownload.hidden = false;
  }, 45_000);
}

document.querySelectorAll<HTMLButtonElement>(".platform-button").forEach((button) => {
  button.addEventListener("click", () => {
    platform = button.dataset.platform as SearchPlatform;
    operatorReference.innerHTML = renderOperatorReference(platform);
    document.querySelectorAll<HTMLButtonElement>(".platform-button").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-checked", String(active));
    });
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    description.value = button.dataset.example!;
    description.focus();
  });
});

async function loadEngine() {
  if (engine) return engine;
  const modelLabel = selectedModel().label;
  const downloadStarted = performance.now();
  let loadStarted = downloadStarted;
  let downloadRecorded = false;
  const finishDownloadTiming = () => {
    if (downloadRecorded) return;
    performanceLog.add(modelLabel, "Model download", downloadStarted);
    downloadRecorded = true;
    loadStarted = performance.now();
  };
  if (!loading) {
    const model = selectedModel();
    if (model.backend === "transformers" && model.device === "webgpu" && !("gpu" in navigator)) {
      throw new Error("WebGPU is not available. Choose a CPU model instead.");
    }
    modelSelect.disabled = true;
    status.textContent = "Downloading model…";
    statusDot.classList.add("loading");
    progressWrap.hidden = false;
    downloadHelp.hidden = false;
    resetDownload.hidden = true;
    armStallWarning();
    const updateProgress = (amount: number) => {
      const percent = Math.round(amount);
      status.textContent = `Downloading model — ${percent}%`;
      downloadDetail.textContent = "Downloading model files…";
      progress.style.width = `${percent}%`;
      if (percent >= 100) finishDownloadTiming();
      armStallWarning();
    };
    loadedBackend = model.backend;
    if (model.backend === "gguf") {
      ggufEngine = new Wllama({ default: wllamaWasmUrl }, { logger: LoggerWithoutDebug });
      loading = ggufEngine.loadModelFromHF(
        { repo: model.id, file: model.file },
        {
          n_ctx: 1024,
          progressCallback: ({ loaded, total }) => updateProgress(total ? (loaded / total) * 100 : 0),
        },
      ).then(() => ggufEngine!);
    } else {
      loading = pipeline("text-generation", model.id, {
        device: model.device,
        dtype: model.dtype,
        progress_callback: (event: { status: string; progress?: number }) => {
          if (event.status === "progress" && event.progress !== undefined) updateProgress(event.progress);
        },
      });
    }
  }
  engine = await loading;
  finishDownloadTiming();
  performanceLog.add(modelLabel, "Model load", loadStarted);
  window.clearTimeout(stallTimer);
  status.textContent = "Model ready";
  statusDot.classList.remove("loading");
  statusDot.classList.add("ready");
  progressWrap.hidden = true;
  downloadHelp.hidden = true;
  return engine;
}

resetDownload.addEventListener("click", async () => {
  resetDownload.disabled = true;
  downloadDetail.textContent = "Clearing the incomplete model download…";
  try {
    if (selectedModel().backend === "gguf") await (ggufEngine?.cacheManager ?? new CacheManager()).clear();
    else if ("caches" in window) await window.caches.delete("transformers-cache");
  } finally {
    window.location.reload();
  }
});

generate.addEventListener("click", async () => {
  const request = description.value.trim();
  error.textContent = "";
  result.hidden = true;
  if (!request) {
    error.textContent = "Describe the issues you want to find first.";
    description.focus();
    return;
  }
  generate.disabled = true;
  modelSelect.disabled = true;
  generate.querySelector("span")!.textContent = "Loading model…";
  let generationStarted: number | null = null;
  const modelLabel = selectedModel().label;
  try {
    const llm = await loadEngine();
    generate.querySelector("span")!.textContent = "Generating…";
    generationStarted = performance.now();
    let generatedText = "";
    if (loadedBackend === "gguf") {
      const response = await (llm as Wllama).createChatCompletion({
        messages: [
          { role: "system", content: createSearchPrompt(platform) },
          { role: "user", content: request },
        ],
        max_tokens: MAX_GENERATED_TOKENS,
        temperature: 0,
      });
      generatedText = response.choices[0]?.message.content ?? "";
    } else {
      const response = await (llm as TextGenerationPipeline)([
        { role: "system", content: createSearchPrompt(platform) },
        { role: "user", content: request },
      ], {
        max_new_tokens: MAX_GENERATED_TOKENS,
        do_sample: false,
        return_full_text: false,
      });
      const generated = response[0]?.generated_text;
      const lastContent = typeof generated === "string" ? generated : generated?.at(-1)?.content;
      generatedText = typeof lastContent === "string" ? lastContent : "";
    }
    const output = createSearchQuery(platform, request, generatedText);
    if (!output) throw new Error("The model returned an empty query. Please try again.");
    query.textContent = output;
    openSearch.href = createSearchUrl(platform, output);
    result.hidden = false;
    performanceLog.add(modelLabel, "Output generation", generationStarted);
  } catch (reason) {
    if (generationStarted !== null) performanceLog.add(modelLabel, "Output generation", generationStarted, "Failed");
    window.clearTimeout(stallTimer);
    error.textContent = reason instanceof Error ? reason.message : "The model could not be loaded. Please try again.";
    status.textContent = "Model download interrupted";
    statusDot.classList.remove("loading");
    downloadDetail.textContent = "The download did not finish. Clear its partial cache before trying again.";
    downloadHelp.hidden = false;
    resetDownload.hidden = false;
    loading = null;
    loadedBackend = null;
    ggufEngine = null;
    modelSelect.disabled = false;
  } finally {
    generate.disabled = false;
    modelSelect.disabled = false;
    generate.querySelector("span")!.textContent = "Generate query";
  }
});

document.querySelector<HTMLButtonElement>("#copy")!.addEventListener("click", async (event) => {
  await navigator.clipboard.writeText(query.textContent ?? "");
  const button = event.currentTarget as HTMLButtonElement;
  button.textContent = "COPIED";
  setTimeout(() => (button.textContent = "COPY"), 1400);
});
