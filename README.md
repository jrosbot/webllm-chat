# Issue Query

A private, browser-only assistant that turns natural-language descriptions into GitHub or GitLab issue search queries. The model runs locally with Transformers.js or WebLLM and WebGPU; no prompt is sent to an application server.

## Local development

```bash
npm install
npm run dev
```

Open the printed local URL in a recent browser. The Transformers.js page defaults to the CPU-friendly, 2-bit **SmolLM2 135M Q2_K** GGUF (88.2 MB), which runs through wllama without WebGPU. It also offers a higher-precision **SmolLM2 135M Q4** CPU model and the 2-bit **Qwen3.5 0.8B UD-IQ2_XXS** GGUF (338 MB). Its larger **SmolLM2 360M Q4** and **SmolLM2 1.7B Q4** options use WebGPU. The WebLLM page offers **SmolLM2 135M**, **SmolLM2 360M**, and **Llama 3.2 1B**; its 135M build requires WebGPU `shader-f16`. Each selector is locked while a model loads, then becomes available again so you can unload it and try another model. Downloaded models are cached for later visits.

During the first download each backend displays download progress. If no progress event arrives for 45 seconds, a **Clear download & retry** action appears and removes the incomplete model from that backend's browser cache before reloading the page. Ad blockers, VPNs, corporate proxies, and restrictive networks can block model files served by Hugging Face; try another network if a clean retry still stops at the same point.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys every push to `main`, `master`, or `work`. It can also enable Pages on a new repository, avoiding the `Get Pages site failed: Not Found` error that occurs when `configure-pages` runs before a Pages site exists.

One repository secret is required for that initial enablement:

1. Create a fine-grained personal access token with access to this repository and **Administration: write** plus **Pages: write** permissions.
2. Add it under **Settings → Secrets and variables → Actions → New repository secret** with the name `PAGES_TOKEN`.
3. Push a commit or run **Deploy to GitHub Pages** from the Actions tab.

The built-in `GITHUB_TOKEN` cannot enable Pages, which is why the workflow explicitly uses `PAGES_TOKEN`. After the first successful run, the Pages source is already GitHub Actions and subsequent runs continue to deploy normally.

The Vite build uses relative asset paths, so it works for both user sites and project sites without changing a repository name in configuration.

Each deployment defaults to the Transformers.js version at `index.html` (with `transformersjs.html` kept as a direct alias), while `webllm.html` contains the WebLLM alternative. Vite builds all entry points together, so users can switch implementations without a separate deployment.

For each search, the selected model returns one query from a compact, platform-specific prompt. Generation is capped at 48 tokens and the CPU GGUF context at 1,024 tokens, avoiding time spent on explanations that the app would discard. Requests remain limited to 1,000 characters, and deterministic parsing still provides a fallback when a small model rambles.
