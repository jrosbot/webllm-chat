# Issue Query

A private, browser-only assistant that turns natural-language descriptions into GitHub or GitLab issue search queries. The model runs locally with Transformers.js or WebLLM and WebGPU; no prompt is sent to an application server.

The same page also includes a multilingual text studio. Two focused model passes first edit in the original language and then produce an English translation and analysis; the application assembles stable top-level sections. German and French sample texts make the workflow quick to try, and this processing uses the same selected local model. The four approaches considered and the rationale for this design are recorded in [`docs/text-studio-options.md`](docs/text-studio-options.md).

## Local development

```bash
npm install
npm run dev
```

Open the printed local URL in a recent browser. The single app detects a usable WebGPU adapter and automatically selects WebLLM when one is available; otherwise it selects the CPU-friendly Transformers.js fallback. The inference-engine selector lets users switch in place without navigating to another page. Transformers.js defaults to **Squeal AI 20M Instruct** on the CPU, while WebLLM defaults to the broadly compatible **SmolLM2 360M Q4**.

The WebLLM menu also includes compact, quantized **Qwen 2.5 0.5B and 1.5B Q4**, **Qwen 2.5 Coder 0.5B and 1.5B Q4**, **Qwen 3 0.6B and 1.7B Q4**, **Qwen 3.5 0.8B Q4**, **TinyLlama 1.1B Q4**, **Llama 3.2 1B and 3B Q4**, **OLMo 2 1B Q4**, **Gemma 2 2B Q4**, **Gemma 3 1B Q4**, **SmolLM2 1.7B Q4**, and **Phi 3.5 Mini Q4** choices. Models that require `shader-f16` say so in their picker note. It additionally exposes the requested Hugging Face WebLLM repositories from **mlciv**, **rubenz-org**, **mlc-ai**, **Qurtana**, **XaTT**, and **WhyFriendo**. Repeated repository names are shown only once. Community repositories are marked in the picker and may have different download sizes or hardware requirements than the prebuilt defaults.

Transformers.js offers **Gemma 3 270M Q4** on either CPU or WebGPU, experimental **GPT-2 124M FP32** CPU completion, a compact Qwen 3.5 GGUF model, and quantized ONNX **Qwen 3 0.6B Q4/F16** and **Llama 3.2 1B Q4/F16** WebGPU models. The Gemma CPU choice uses the repository's compact 4-bit variant, while its Q4/F16 choice combines 4-bit weights with half-precision GPU compute. Models that need `shader-f16` are disabled when the detected adapter does not expose that feature. GPT-2 is not instruction-tuned, so its query quality may be lower; it is included as a small compatibility option. Downloaded models are cached for later visits.

The experimental **Squeal AI 20M Instruct** CPU model remains the smallest fallback. Its query quality may be lower, so the deterministic query parser remains available as a fallback.

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

## Model benchmark

The browser benchmark selects every model, records its download and load phases, runs both an issue-query generation and a Text Studio treatment, validates that each result is non-empty, and writes raw millisecond timings plus outcomes to CSV. Install Chromium once, then run it:

```bash
npx playwright install chromium
npm run benchmark:models
```

With no filters, the command checks and tries every model exposed by both selectors—not just the defaults. Running every model can download many gigabytes and take hours. `--links-only` checks every repository or exact GGUF file without downloading model weights, while `--smallest 5` performs both generation tasks with the five smallest supported pipeline models (GGUF models are excluded from this convenience subset but remain part of a full run). Use `--limit 1` only for a smoke run, `--backend transformers` or `--backend webllm` to restrict the engine, and `--model smollm` to filter by model value or label. The runner honors standard `HTTPS_PROXY`/`HTTP_PROXY` environment variables for model downloads. Results are written under the gitignored `benchmark-results/` directory so they can be reviewed before deliberately adding a chosen CSV with `git add -f`. Run `npm run benchmark:models -- --help` for the complete option list. Unsupported GPU models are recorded as skipped rather than silently omitted; availability depends on Chromium and the host GPU.

The Vite build uses relative asset paths, so it works for both user sites and project sites without changing a repository name in configuration.

Each deployment has one entry point at `index.html`. Backend detection, selection, model loading, and generation all happen on that page.

For each search, the selected model returns one query from a compact, platform-specific prompt. Generation is capped at 48 tokens and the CPU GGUF context at 1,024 tokens, avoiding time spent on explanations that the app would discard. Requests remain limited to 1,000 characters, and deterministic parsing still provides a fallback when a small model rambles.
