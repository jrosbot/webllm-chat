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
  for (const capability of ["missing", "no-f16", "supported"]) {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.addInitScript(mode => {
      Object.defineProperty(navigator, "gpu", { configurable: true, value: mode === "missing" ? undefined : {
        requestAdapter: async () => ({ features: new Set(mode === "supported" ? ["shader-f16"] : []) }),
      } });
    }, capability);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    let modelRequests = 0;
    await page.route("https://huggingface.co/**", route => {
      modelRequests++;
      return route.fulfill({ status: 503, body: "Simulated model-host outage" });
    });
    await page.route("https://fonts.googleapis.com/**", route => route.fulfill({ body: "", contentType: "text/css" }));
    await page.goto(new URL("image.html", base).href);
    const button = page.locator("#image-generate");
    if (capability !== "supported") {
      await page.locator("#image-error").filter({ hasText: capability === "missing" ? "requires WebGPU" : "shader-f16" }).waitFor();
      assert.equal(await button.isDisabled(), true);
      assert.equal(modelRequests, 0, "Unsupported devices must not download weights");
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
    }
    assert.deepEqual(errors, []);
    console.log(`PASS image studio: ${capability}`);
    passed++;
    await context.close();
  }
  console.log(`${passed} browser checks passed. GPU inference is not exercised by these capability/HTTP mocks.`);
} finally {
  await browser.close();
}
