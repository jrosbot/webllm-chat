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
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    class FakeMediaRecorder {
      constructor() { this.state = "inactive"; this.mimeType = "audio/webm"; this.listeners = new Map(); }
      addEventListener(name, listener) {
        const listeners = this.listeners.get(name) ?? [];
        listeners.push(listener);
        this.listeners.set(name, listeners);
      }
      dispatch(name, event = {}) {
        this[`on${name}`]?.(event);
        for (const listener of this.listeners.get(name) ?? []) listener(event);
      }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        setTimeout(() => {
          this.dispatch("dataavailable", { data: new Blob(["mock audio"], { type: this.mimeType }) });
          this.dispatch("stop");
        }, 0);
      }
    }
    window.MediaRecorder = FakeMediaRecorder;
    window.AudioContext = class FakeAudioContext {
      async decodeAudioData() {
        const samples = new Float32Array(16_000).fill(0.05);
        return { numberOfChannels: 1, sampleRate: 16_000, length: samples.length, getChannelData: () => samples };
      }
      async close() {}
    };
  });
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

  assert.equal(await page.locator("#record-start").isEnabled(), true, "Recording requires an explicit user action");
  await page.locator("#record-start").click();
  await page.waitForFunction(() => document.querySelector("#record-status").textContent.includes("Recording"));
  await page.locator("#record-stop").click();
  await page.waitForFunction(() => document.querySelector("#recording-preview").hidden === false);
  assert.equal(await page.locator("#transcribe").isEnabled(), true, "A completed recording can be transcribed");
  await page.locator("#transcribe").click();
  await page.waitForFunction(() => document.querySelector("#record-error").textContent.length > 0, undefined, { timeout: 30000 });
  assert.ok(modelRequests > 1, "Transcription must lazily request multilingual Whisper weights");
  assert.equal(await page.locator("#transcribe").isEnabled(), true, "A model download error must allow retry");
  assert.deepEqual(errors, []);
  console.log("PASS audio studio: language selection, local recording controls, lazy loading, input validation, model-host errors, and retry");
  await context.close();
} finally {
  await browser.close();
}
