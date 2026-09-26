import * as webllm from "@mlc-ai/web-llm";
import "./style.css";

const MODELS = [
  {
    id: "SmolLM2-135M-Instruct-q0f16-MLC",
    label: "SmolLM2 135M · smallest",
    note: "Fewest parameters · requires shader-f16",
  },
  {
    id: "SmolLM2-360M-Instruct-q4f32_1-MLC",
    label: "SmolLM2 360M · compatible",
    note: "Better results · broad WebGPU compatibility",
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    label: "Llama 3.2 1B · quality",
    note: "Best results · largest download",
  },
] as const;

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#" aria-label="Issue Query home">
      <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
      <span>ISSUE QUERY</span>
    </a>
    <div class="header-actions">
      <a class="backend-link" href="./transformersjs.html">Try Transformers.js →</a>
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

      <textarea id="description" rows="4" placeholder="e.g. Open accessibility bugs assigned to me, created this month, with more than 5 comments…" aria-label="Issue description"></textarea>
      <div class="examples">
        <span>TRY AN EXAMPLE</span>
        <button data-example="Good first issues in TypeScript repositories with no assignee">Good first issues</button>
        <button data-example="Open security bugs created this month with more than 5 comments">Recent security bugs</button>
        <button data-example="Documentation issues assigned to me that have not been updated in 30 days">Stale docs assigned to me</button>
      </div>

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
          <span id="status">SmolLM2 135M · smallest · loads on first use</span>
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

    <section class="trust-grid">
      <article><span>◈</span><div><h3>100% private</h3><p>Your text never leaves this device.</p></div></article>
      <article><span>⌁</span><div><h3>Powered by WebGPU</h3><p>The language model runs in your browser.</p></div></article>
      <article><span>◎</span><div><h3>Works offline</h3><p>Once downloaded, the model is cached.</p></div></article>
    </section>
  </main>
  <footer><span>ISSUE QUERY / 2026</span><span>Built with WebLLM · No data collected</span></footer>
`;

let platform = "GitHub";
let engine: webllm.MLCEngineInterface | null = null;
let loading: Promise<webllm.MLCEngineInterface> | null = null;

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
let stallTimer: number | undefined;

function selectedModel() {
  return MODELS.find(({ id }) => id === modelSelect.value) ?? MODELS[0];
}

modelSelect.addEventListener("change", () => {
  modelNote.textContent = selectedModel().note;
  status.textContent = `${selectedModel().label} · loads on first use`;
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
    platform = button.dataset.platform!;
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
  if (!("gpu" in navigator)) throw new Error("WebGPU is not available. Open this page in a recent Chrome or Edge browser with hardware acceleration enabled.");
  if (!loading) {
    const model = selectedModel();
    modelSelect.disabled = true;
    status.textContent = "Downloading model — 0%";
    statusDot.classList.add("loading");
    progressWrap.hidden = false;
    downloadHelp.hidden = false;
    resetDownload.hidden = true;
    armStallWarning();
    loading = webllm.CreateMLCEngine(model.id, {
      initProgressCallback: ({ progress: amount, text }) => {
        const percent = Math.round(amount * 100);
        status.textContent = `Downloading model — ${percent}%`;
        downloadDetail.textContent = text || "Downloading model files…";
        progress.style.width = `${percent}%`;
        armStallWarning();
      },
    });
  }
  engine = await loading;
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
    await webllm.deleteModelAllInfoInCache(selectedModel().id);
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
  generate.querySelector("span")!.textContent = "Loading model…";
  try {
    const llm = await loadEngine();
    generate.querySelector("span")!.textContent = "Generating…";
    const response = await llm.chat.completions.create({
      temperature: 0.1,
      max_tokens: 120,
      messages: [
        { role: "system", content: `You convert natural-language requests into one valid ${platform} issue search query. Use ${platform} search operators such as is, author, assignee, label, type, state, created, updated, comments, language, and repo when relevant. Resolve “me” to @me. Output only the query on one line: no markdown, explanation, quotation marks, or URL.` },
        { role: "user", content: request },
      ],
    });
    const output = response.choices[0]?.message?.content?.trim().replace(/^`+|`+$/g, "") ?? "";
    if (!output) throw new Error("The model returned an empty query. Please try again.");
    query.textContent = output;
    openSearch.href = platform === "GitHub"
      ? `https://github.com/issues?q=${encodeURIComponent(output)}`
      : `https://gitlab.com/dashboard/issues?search=${encodeURIComponent(output)}`;
    result.hidden = false;
  } catch (reason) {
    window.clearTimeout(stallTimer);
    error.textContent = reason instanceof Error ? reason.message : "The model could not be loaded. Please try again.";
    downloadDetail.textContent = "The download did not finish. Clear its partial cache before trying again.";
    downloadHelp.hidden = false;
    resetDownload.hidden = false;
    loading = null;
    modelSelect.disabled = false;
  } finally {
    generate.disabled = false;
    generate.querySelector("span")!.textContent = "Generate query";
  }
});

document.querySelector<HTMLButtonElement>("#copy")!.addEventListener("click", async (event) => {
  await navigator.clipboard.writeText(query.textContent ?? "");
  const button = event.currentTarget as HTMLButtonElement;
  button.textContent = "COPIED";
  setTimeout(() => (button.textContent = "COPY"), 1400);
});
