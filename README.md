# Issue Query

A private, browser-only assistant that turns natural-language descriptions into GitHub or GitLab issue search queries. The model runs locally with WebLLM and WebGPU; no prompt is sent to an application server.

## Local development

```bash
npm install
npm run dev
```

Open the printed local URL in a WebGPU-capable browser. The app lets the user choose a model before the first generation and caches each downloaded model for later visits. **SmolLM2 135M** is the default model with the fewest parameters; WebLLM's available build requires WebGPU `shader-f16`. **SmolLM2 360M** is a more capable, broadly compatible alternative, while **Llama 3.2 1B** offers the best results at the cost of the largest download. The selector is locked after loading starts so that progress, cache clearing, and generation always refer to the same model.

During the first download the app now displays WebLLM's detailed loading message, rather than only a percentage. If no progress event arrives for 45 seconds, a **Clear download & retry** action appears and removes the incomplete model from WebLLM's browser cache before reloading the page. Ad blockers, VPNs, corporate proxies, and restrictive networks can block model files served by Hugging Face; try another network if a clean retry still stops at the same point.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys every push to `main`, `master`, or `work`. It can also enable Pages on a new repository, avoiding the `Get Pages site failed: Not Found` error that occurs when `configure-pages` runs before a Pages site exists.

One repository secret is required for that initial enablement:

1. Create a fine-grained personal access token with access to this repository and **Administration: write** plus **Pages: write** permissions.
2. Add it under **Settings → Secrets and variables → Actions → New repository secret** with the name `PAGES_TOKEN`.
3. Push a commit or run **Deploy to GitHub Pages** from the Actions tab.

The built-in `GITHUB_TOKEN` cannot enable Pages, which is why the workflow explicitly uses `PAGES_TOKEN`. After the first successful run, the Pages source is already GitHub Actions and subsequent runs continue to deploy normally.

The Vite build uses relative asset paths, so it works for both user sites and project sites without changing a repository name in configuration.
