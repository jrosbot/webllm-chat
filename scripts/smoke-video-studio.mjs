// Run against a Vite dev/preview server; the real runtime probe and browser
// video encoder do not download video weights.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.VIDEO_STUDIO_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader"],
});

try {
  const unsupported = await browser.newContext();
  await unsupported.addInitScript(() => Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined }));
  const unsupportedPage = await unsupported.newPage();
  let unsupportedModelRequests = 0;
  await unsupportedPage.route("https://huggingface.co/**", route => { unsupportedModelRequests++; return route.abort(); });
  await unsupportedPage.route("https://fonts.googleapis.com/**", route => route.fulfill({ body: "", contentType: "text/css" }));
  await unsupportedPage.goto(new URL("video.html", base).href);
  await unsupportedPage.locator("#video-error").filter({ hasText: "requires WebGPU" }).waitFor();
  assert.equal(await unsupportedPage.locator("#video-generate").isDisabled(), true);
  assert.match(await unsupportedPage.locator(".video-variant.available").innerText(), /4-bit · available/);
  assert.match(await unsupportedPage.locator(".video-variant.unavailable").innerText(), /1-bit · unavailable/);
  assert.equal(await unsupportedPage.locator(".video-variant.available").count(), 1, "The page must expose the verified Q4 route");
  assert.equal(await unsupportedPage.locator("[data-video-bit='1'], #video-quantization").count(), 0, "1-bit must not be exposed as a working selection");
  assert.equal(unsupportedModelRequests, 0, "Unsupported browsers must not download model files");
  await unsupported.close();
  console.log("PASS unsupported browser: Q4 generation disabled, 1-bit unavailable, no model downloads");

  const ui = await browser.newContext({ acceptDownloads: true });
  await ui.addInitScript(() => Object.defineProperty(navigator, "gpu", {
    configurable: true,
    value: { requestAdapter: async () => ({}) },
  }));
  const uiPage = await ui.newPage();
  const pageErrors = [];
  uiPage.on("pageerror", error => pageErrors.push(String(error)));
  let uiModelRequests = 0;
  await uiPage.route("https://huggingface.co/**", route => { uiModelRequests++; return route.fulfill({ status: 503, body: "Simulated outage" }); });
  await uiPage.route("https://fonts.googleapis.com/**", route => route.fulfill({ body: "", contentType: "text/css" }));
  await uiPage.goto(new URL("video.html", base).href);
  await uiPage.waitForFunction(() => !document.querySelector("#video-generate").disabled);
  assert.equal(uiModelRequests, 0, "Opening Video Studio must not fetch weights");
  await uiPage.locator("[data-video-example]").last().click();
  assert.match(await uiPage.locator("#video-prompt").inputValue(), /fireplace/);
  await uiPage.locator("#video-seed").fill("-1");
  await uiPage.locator("#video-generate").click();
  assert.match(await uiPage.locator("#video-error").innerText(), /Seed must/);
  assert.equal(uiModelRequests, 0, "Invalid input must be rejected before model loading");
  const downloading = uiPage.waitForEvent("download");
  await uiPage.locator("#video-report").click();
  const reportDownload = await downloading;
  const report = JSON.parse(await readFile(await reportDownload.path(), "utf8"));
  assert.equal(report.status, "not-started");
  assert.equal(report.webgpuCheck, "not-run");
  assert.equal(report.modelFetchedBytes, 0);
  assert.deepEqual(pageErrors, []);
  await ui.close();
  console.log("PASS UI: lazy loading, prompt examples, seed validation, benchmark report");

  // No capability mocks: exercise ORT WebGPU with both its Add initialization
  // and the actual packed MatMulNBits Q4 operator. No video weights are read.
  const runtime = await browser.newContext({ acceptDownloads: true });
  const runtimePage = await runtime.newPage();
  const runtimeErrors = [];
  runtimePage.on("pageerror", error => runtimeErrors.push(String(error)));
  let runtimeModelRequests = 0;
  await runtimePage.route("https://huggingface.co/**", route => { runtimeModelRequests++; return route.abort(); });
  await runtimePage.route("https://fonts.googleapis.com/**", route => route.fulfill({ body: "", contentType: "text/css" }));
  await runtimePage.goto(new URL("video.html", base).href);
  await runtimePage.locator("#video-check-runtime").click();
  await runtimePage.waitForFunction(() => /Q4 runtime check (passed|failed)/.test(document.querySelector("#video-runtime-status").textContent), undefined, { timeout: 60000 });
  assert.match(await runtimePage.locator("#video-runtime-status").innerText(), /^Q4 runtime check passed/);
  assert.equal(runtimeModelRequests, 0, "The runtime probe must not request video model files");

  // Encode synthetic pixels to WebM in Chromium, independently of model files.
  const encoded = await runtimePage.evaluate(async () => {
    const { createVideoFrames, recordVideoWebM } = await import("/src/videoDiffusion.ts");
    const rgb = new Uint8Array(17 * 256 * 256 * 3);
    for (let i = 0; i < rgb.length; i += 3) { rgb[i] = 20; rgb[i + 1] = 90; rgb[i + 2] = 140; }
    const blob = await recordVideoWebM(createVideoFrames(rgb));
    return { bytes: blob.size, type: blob.type };
  });
  assert.ok(encoded.bytes > 0, "Synthetic frames must produce a non-empty browser recording");
  assert.match(encoded.type, /^video\/webm/);
  const runtimeDownload = runtimePage.waitForEvent("download");
  await runtimePage.locator("#video-report").click();
  const downloaded = await runtimeDownload;
  const runtimeReport = JSON.parse(await readFile(await downloaded.path(), "utf8"));
  assert.equal(runtimeReport.webgpuCheck, "passed");
  assert.ok(runtimeReport.webgpuCheckMs > 0);
  assert.equal(runtimeReport.modelFetchedBytes, 0);
  assert.deepEqual(runtimeErrors, []);
  await runtime.close();
  console.log(`PASS real Q4 WebGPU runtime and WebM recording: ${encoded.type}, ${encoded.bytes} bytes; no model downloads`);
} finally {
  await browser.close();
}
