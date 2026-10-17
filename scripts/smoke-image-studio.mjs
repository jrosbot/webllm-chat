// Run against a Vite dev/preview server; no model weights are downloaded.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.IMAGE_STUDIO_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader"],
});
let passed = 0;
try {
  for (const capability of ["missing", "no-f16", "low-storage", "truncated", "supported"]) {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.addInitScript(mode => {
      if (["supported", "low-storage", "truncated"].includes(mode)) {
        const gpu = navigator.gpu;
        const requestAdapter = gpu.requestAdapter.bind(gpu);
        Object.defineProperty(gpu, "requestAdapter", { value: options => options === undefined
          ? Promise.resolve({ features: new Set(["shader-f16"]) })
          : requestAdapter(options) });
        if (mode === "low-storage") {
          Object.defineProperty(navigator.storage, "estimate", { configurable: true, value: async () => ({ quota: 1024, usage: 0 }) });
        }
        return;
      }
      Object.defineProperty(navigator, "gpu", { configurable: true, value: mode === "missing" ? undefined : {
        requestAdapter: async () => ({ features: new Set() }),
      } });
    }, capability);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    let modelRequests = 0;
    await page.route("https://huggingface.co/**", route => {
      modelRequests++;
      if (capability === "truncated") return route.fulfill({ status: 200, body: "partial model" });
      return route.fulfill({ status: 503, body: "Simulated model-host outage" });
    });
    await page.route("https://fonts.googleapis.com/**", route => route.fulfill({ body: "", contentType: "text/css" }));
    await page.goto(new URL("image.html", base).href);
    const button = page.locator("#image-generate");
    if (capability === "missing" || capability === "no-f16") {
      await page.locator("#image-error").filter({ hasText: capability === "missing" ? "requires WebGPU" : "shader-f16" }).waitFor();
      assert.equal(await button.isDisabled(), true);
      assert.equal(modelRequests, 0, "Unsupported devices must not download weights");
    } else if (capability === "low-storage") {
      await button.click();
      await page.locator("#image-error").filter({ hasText: "site storage" }).waitFor({ timeout: 30000 });
      assert.equal(modelRequests, 0, "Insufficient estimated quota must fail before fetching model weights");
      assert.equal(await button.isEnabled(), true, "A storage error must allow retry");
    } else if (capability === "truncated") {
      await button.click();
      await page.locator("#image-error").filter({ hasText: "incomplete" }).waitFor({ timeout: 30000 });
      assert.equal(modelRequests, 1);
      const cachedKeys = await page.evaluate(async () => (await (await caches.open("vocabulary-diffusion-v1")).keys()).map(request => request.url));
      assert.deepEqual(cachedKeys, [], "An incomplete streamed response must be removed from CacheStorage");
      assert.equal(await button.isEnabled(), true, "An incomplete download must allow retry");
    } else {
      await page.waitForFunction(() => !document.querySelector("#image-generate").disabled);
      assert.equal(modelRequests, 0, "Opening the studio must not download weights");
      await page.locator("[data-image-example]").last().click();
      assert.match(await page.locator("#image-prompt").inputValue(), /drinking/);
      await page.locator("#image-seed").fill("-1");
      await button.click();
      assert.match(await page.locator("#image-error").innerText(), /Seed must/);
      assert.equal(modelRequests, 0);
      await page.locator("#image-seed").fill("42");
      await button.click();
      await page.locator("#image-error").filter({ hasText: "HTTP 503" }).waitFor({ timeout: 30000 });
      assert.equal(await button.isEnabled(), true, "A failed load must allow retry");
      assert.equal(await page.locator("#image-result").isHidden(), true);
      const downloading = page.waitForEvent("download");
      await page.locator("#image-report").click();
      const download = await downloading;
      const { readFile } = await import("node:fs/promises");
      const report = JSON.parse(await readFile(await download.path(), "utf8"));
      assert.equal(report.status, "failed");
      assert.match(report.error, /HTTP 503/);
      assert.equal(report.modelFetchedBytes, 0);
      assert.equal(report.generationMs, null);
      assert.equal(report.gpuMemoryBytes, null);
      assert.equal(report.runtimeCheck, "passed");
    }
    assert.deepEqual(errors, []);
    console.log(`PASS image studio: ${capability}`);
    passed++;
    await context.close();
  }
  // No capability mocks: exercise the real ORT WebGPU backend and emitted WASM
  // with a tiny Add model, which also works on an FP32-only software adapter.
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  let modelRequests = 0;
  await page.route("https://huggingface.co/**", route => { modelRequests++; return route.abort(); });
  await page.route("https://fonts.googleapis.com/**", route => route.fulfill({ body: "", contentType: "text/css" }));
  await page.goto(new URL("image.html", base).href);
  await page.locator("#image-check-runtime").click();
  await page.waitForFunction(() => /Runtime check (passed|failed)/.test(document.querySelector("#image-runtime-status").textContent), undefined, { timeout: 60000 });
  assert.match(await page.locator("#image-runtime-status").innerText(), /^Runtime check passed/);
  assert.equal(modelRequests, 0, "The real runtime probe must not fetch image weights");
  const downloading = page.waitForEvent("download");
  await page.locator("#image-report").click();
  const download = await downloading;
  const { readFile } = await import("node:fs/promises");
  const report = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(report.runtimeCheck, "passed");
  assert.ok(report.runtimeInitMs > 0);
  assert.equal(report.modelFetchedBytes, 0);
  await context.close();
  console.log("PASS real WebGPU runtime: Add([1,2], [1,2]) = [2,4]");
  console.log(`${passed} UI checks and 1 real WebGPU runtime check passed. Full diffusion remains a separate hardware test.`);
} finally {
  await browser.close();
}
