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

The workflow in `.github/workflows/deploy.yml` builds and deploys every push to `main`, `master`, or `work`. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions** once before the first deployment. No personal access token or `PAGES_TOKEN` secret is required: `actions/configure-pages` uses the workflow's built-in `github.token`, and the workflow grants `pages: write` and `id-token: write` to the job.

If a merge reintroduces `token: ${{ secrets.PAGES_TOKEN }}`, remove it or replace it with `token: ${{ github.token }}`. An undefined repository secret expands to an empty string and makes `configure-pages` fail with `Parameter token or opts.auth is required`.

The Vite build uses relative asset paths, so it works for both user sites and project sites without changing a repository name in configuration.

Each deployment includes two linked pages: `index.html` contains the WebLLM version, while `transformersjs.html` contains the Transformers.js alternative. Vite builds both entry points together, so users can switch implementations without a separate deployment.
