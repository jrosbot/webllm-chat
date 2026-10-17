// Exercise the audio studio UI without downloading voice weights.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.AUDIO_STUDIO_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader"],
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  let modelRequests = 0;
  page.on("pageerror", error => errors.push(String(error)));
  await page.route("https://huggingface.co/**", route => {
    modelRequests++;
    return route.fulfill({ status: 503, body: "Simulated model-host outage" });
  });
  await page.route("https://fonts.googleapis.com/**", route => route.fulfill({ body: "", contentType: "text/css" }));
  await page.goto(new URL("audio.html", base).href);
  assert.equal(await page.locator("#audio-language").inputValue(), "de");
  assert.equal(await page.locator("#audio-device").inputValue(), "wasm");
  assert.equal(modelRequests, 0, "Opening the page must not download a voice model");

  await page.locator("#audio-text").fill(" ");
  await page.locator("#audio-generate").click();
  await page.locator("#audio-error").filter({ hasText: "Enter a phrase" }).waitFor();
  assert.equal(modelRequests, 0, "Empty input must not load a model");

  await page.locator("[data-audio-example=ca]").click();
  assert.equal(await page.locator("#audio-language").inputValue(), "ca");
  assert.match(await page.locator("#audio-text").inputValue(), /poma vermella/);
  await page.locator("#audio-generate").click();
  await page.waitForFunction(() => document.querySelector("#audio-error").textContent.length > 0, undefined, { timeout: 30000 });
  assert.ok(modelRequests > 0, "Generating speech must lazily request the selected voice model");
  assert.equal(await page.locator("#audio-generate").isEnabled(), true, "A model download error must allow retry");
  assert.equal(await page.locator("#audio-result").isHidden(), true);
  assert.deepEqual(errors, []);
  console.log("PASS audio studio: language selection, lazy loading, input validation, model-host error, and retry");
  await context.close();
} finally {
  await browser.close();
}
