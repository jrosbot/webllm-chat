# Issue Query

A private, browser-only assistant that turns natural-language descriptions into GitHub or GitLab issue search queries. The model runs locally with WebLLM and WebGPU; no prompt is sent to an application server.

## Local development

```bash
npm install
npm run dev
```

Open the printed local URL in a WebGPU-capable browser. The first generation downloads the selected model; subsequent visits use the browser cache.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys every push to `main`, `master`, or `work`. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

Each deployment includes two linked pages: `index.html` contains the current WebLLM version, while `transformersjs.html` contains the Transformers.js version. Vite builds both entry points in the same production build, so users can switch implementation without running or redeploying the workflow.

The Vite build uses relative asset paths, so it works for both user sites and project sites without changing a repository name in configuration.
