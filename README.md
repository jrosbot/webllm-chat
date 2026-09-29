# Issue Query

A private, browser-only assistant that turns natural-language descriptions into GitHub or GitLab issue search queries. The model runs locally with Transformers.js or WebLLM and WebGPU; no prompt is sent to an application server.

## Local development

```bash
npm install
npm run dev
```

Open the printed local URL in a recent browser. The single app detects a usable WebGPU adapter and automatically selects WebLLM when one is available; otherwise it selects the CPU-friendly Transformers.js fallback. The inference-engine selector lets users switch in place without navigating to another page. Transformers.js defaults to **Squeal AI 20M Instruct** on the CPU, while WebLLM defaults to the broadly compatible **SmolLM2 360M Q4**.

The WebLLM menu also includes compact, quantized **Qwen 2.5 0.5B and 1.5B Q4**, **Qwen 2.5 Coder 0.5B and 1.5B Q4**, **Qwen 3 0.6B and 1.7B Q4**, **Qwen 3.5 0.8B Q4**, **TinyLlama 1.1B Q4**, **Llama 3.2 1B and 3B Q4**, **OLMo 2 1B Q4**, **Gemma 2 2B Q4**, **Gemma 3 1B Q4**, **SmolLM2 1.7B Q4**, and **Phi 3.5 Mini Q4** choices. Models that require `shader-f16` say so in their picker note. It additionally exposes the requested Hugging Face WebLLM repositories from **mlciv**, **rubenz-org**, **mlc-ai**, **Qurtana**, **XaTT**, and **WhyFriendo**. Repeated repository names are shown only once. Community repositories are marked in the picker and may have different download sizes or hardware requirements than the prebuilt defaults.

Transformers.js offers CPU-safe SmolLM2 GGUF and WASM choices, **Gemma 3 270M Q4** on either CPU or WebGPU, experimental **GPT-2 124M Q8** CPU completion, and quantized ONNX **Qwen 3 0.6B Q4/F16** and **Llama 3.2 1B Q4/F16** WebGPU models. The Gemma CPU choice uses the repository's compact 4-bit variant, while its Q4/F16 choice combines 4-bit weights with half-precision GPU compute. Models that need `shader-f16` are disabled when the detected adapter does not expose that feature. GPT-2 is not instruction-tuned, so its query quality may be lower; it is included as a very small compatibility option. Downloaded models are cached for later visits.

Additional experimental CPU choices include **SmolLM2 135M AutoRound INT4**, **Mini-BART G2P**, **Squeal AI 20M Instruct**, **GPT-2 XS**, and **GPT Alpha BG 14M ONNX**. Mini-BART runs through Transformers.js's text-to-text pipeline; the remaining additions use text generation. These unusually small or task-specific models may produce lower-quality issue filters, so the deterministic query parser remains available as a fallback.

The model menu also includes the LLaMA-compatible **TinyLlama Stories 15M and 42M Q4** educational checkpoints from Hugging Face. They run on the CPU through the existing Wllama/llama.cpp WebAssembly backend, because their published GGUF files are not WebLLM or Transformers.js artifacts. These base storytelling models use raw completion prompts rather than chat templates and are offered for low-compute experimentation; do not expect instruction-model query quality. A 60M entry is intentionally not advertised because no browser-ready GGUF, ONNX, or MLC artifact is available in the referenced collection.

Gemma's Transformers.js tokenizer does not publish a chat template. The app therefore formats Gemma turn markers as plain text before generation; other instruction models continue to use their tokenizer-provided chat templates.

The app intentionally does not set `cacheDir`, `localFilesOnly`, or custom ONNX session options: browser caching is already managed by the runtimes, `localFilesOnly` would prevent the first download, and Transformers.js supplies suitable session defaults. Explicit `device` and `dtype` values keep each selectable model on its tested execution path instead of leaving performance-sensitive choices to `auto`.

During the first download each backend displays download progress. If no progress event arrives for 45 seconds, a **Clear download & retry** action appears and removes the incomplete model from that backend's browser cache before reloading the page. Ad blockers, VPNs, corporate proxies, and restrictive networks can block model files served by Hugging Face; try another network if a clean retry still stops at the same point.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys every push to `main`, `master`, or `work`. It can also enable Pages on a new repository, avoiding the `Get Pages site failed: Not Found` error that occurs when `configure-pages` runs before a Pages site exists.

One repository secret is required for that initial enablement:

1. Create a fine-grained personal access token with access to this repository and **Administration: write** plus **Pages: write** permissions.
2. Add it under **Settings → Secrets and variables → Actions → New repository secret** with the name `PAGES_TOKEN`.
3. Push a commit or run **Deploy to GitHub Pages** from the Actions tab.

The built-in `GITHUB_TOKEN` cannot enable Pages, which is why the workflow explicitly uses `PAGES_TOKEN`. After the first successful run, the Pages source is already GitHub Actions and subsequent runs continue to deploy normally.

The Vite build uses relative asset paths, so it works for both user sites and project sites without changing a repository name in configuration.

Each deployment has one entry point at `index.html`. Backend detection, selection, model loading, and generation all happen on that page.

For each search, the selected model returns one query from a compact, platform-specific prompt. Generation is capped at 48 tokens and the CPU GGUF context at 1,024 tokens, avoiding time spent on explanations that the app would discard. Requests remain limited to 1,000 characters, and deterministic parsing still provides a fallback when a small model rambles.
