# Issue Query

A private, browser-only assistant that turns natural-language descriptions into GitHub or GitLab issue search queries. The model runs locally with WebLLM and WebGPU; no prompt is sent to an application server.

## Local development

```bash
npm install
npm run dev
```

Open the printed local URL in a WebGPU-capable browser. Both implementations let the user choose one of three models before the first generation and cache downloaded models for later visits. The Transformers.js page offers **SmolLM2 135M**, **SmolLM2 360M**, and **SmolLM2 1.7B**, ranging from the quickest download to the highest-quality result. The WebLLM page offers **SmolLM2 135M**, **SmolLM2 360M**, and **Llama 3.2 1B**; its 135M build requires WebGPU `shader-f16`. Each selector is locked after loading starts so that progress, cache clearing, and generation always refer to the same model.

During the first download each backend displays download progress. If no progress event arrives for 45 seconds, a **Clear download & retry** action appears and removes the incomplete model from that backend's browser cache before reloading the page. Ad blockers, VPNs, corporate proxies, and restrictive networks can block model files served by Hugging Face; try another network if a clean retry still stops at the same point.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys every push to `main`, `master`, or `work`. It can also enable Pages on a new repository, avoiding the `Get Pages site failed: Not Found` error that occurs when `configure-pages` runs before a Pages site exists.

One repository secret is required for that initial enablement:

1. Create a fine-grained personal access token with access to this repository and **Administration: write** plus **Pages: write** permissions.
2. Add it under **Settings → Secrets and variables → Actions → New repository secret** with the name `PAGES_TOKEN`.
3. Push a commit or run **Deploy to GitHub Pages** from the Actions tab.

The built-in `GITHUB_TOKEN` cannot enable Pages, which is why the workflow explicitly uses `PAGES_TOKEN`. After the first successful run, the Pages source is already GitHub Actions and subsequent runs continue to deploy normally.

The Vite build uses relative asset paths, so it works for both user sites and project sites without changing a repository name in configuration.

Each deployment includes two linked pages: `index.html` contains the WebLLM version, while `transformersjs.html` contains the Transformers.js alternative. Vite builds both entry points together, so users can switch implementations without a separate deployment.
