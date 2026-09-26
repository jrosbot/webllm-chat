import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // Relative URLs work both at a custom domain and at /<repository>/ on Pages.
  base: "./",
  build: {
    rollupOptions: {
      input: {
        webllm: resolve(import.meta.dirname, "index.html"),
        transformersjs: resolve(import.meta.dirname, "transformersjs.html"),
      },
    },
  },
});
