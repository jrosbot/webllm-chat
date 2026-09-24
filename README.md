# Issue Query

A private, browser-only assistant that turns natural-language descriptions into GitHub or GitLab issue search queries. The model runs locally with WebLLM and WebGPU; no prompt is sent to an application server.

## Local development

```bash
npm install
npm run dev
```

Open the printed local URL in a WebGPU-capable browser. The first generation downloads the selected model; subsequent visits use the browser cache.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys every push to `main`, `master`, or `work`. It can also enable Pages on a new repository, avoiding the `Get Pages site failed: Not Found` error that occurs when `configure-pages` runs before a Pages site exists.

One repository secret is required for that initial enablement:

1. Create a fine-grained personal access token with access to this repository and **Administration: write** plus **Pages: write** permissions.
2. Add it under **Settings → Secrets and variables → Actions → New repository secret** with the name `PAGES_TOKEN`.
3. Push a commit or run **Deploy to GitHub Pages** from the Actions tab.

The built-in `GITHUB_TOKEN` cannot enable Pages, which is why the workflow explicitly uses `PAGES_TOKEN`. After the first successful run, the Pages source is already GitHub Actions and subsequent runs continue to deploy normally.

The Vite build uses relative asset paths, so it works for both user sites and project sites without changing a repository name in configuration.
