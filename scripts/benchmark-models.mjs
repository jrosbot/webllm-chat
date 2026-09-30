#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const has = (name) => args.includes(name);
if (has("--help")) {
  console.log(`Usage: npm run benchmark:models -- [options]\n\nOptions:\n  --backend all|transformers|webllm  Models to run (default: all)\n  --model <substring>                 Only model values/labels containing this text\n  --limit <number>                    Run only the first N matching models\n  --smallest <number>                 Run the N smallest models by parameter count\n  --links-only                        Validate every selected model URL without downloading weights\n  --output <path>                     CSV destination (default: benchmark-results/models-<timestamp>.csv)\n  --base-url <url>                    Use an already running app instead of starting Vite\n  --headed                            Show Chromium while the benchmark runs\n  --timeout <minutes>                 Per task timeout (default: 30)\n\nThe default run benchmarks every selectable model. Downloads can consume many gigabytes.`);
  process.exit(0);
}

const backendFilter = valueOf("--backend", "all");
if (!["all", "transformers", "webllm"].includes(backendFilter)) throw new Error("--backend must be all, transformers, or webllm");
const modelFilter = valueOf("--model", "").toLowerCase();
const limit = Number.parseInt(valueOf("--limit", "0"), 10);
const smallest = Number.parseInt(valueOf("--smallest", "0"), 10);
const timeoutMs = Number.parseFloat(valueOf("--timeout", "30")) * 60_000;
const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const output = resolve(valueOf("--output", `benchmark-results/models-${stamp}.csv`));
const externalUrl = valueOf("--base-url", "");
const baseUrl = externalUrl || "http://127.0.0.1:4173";
const proxyServer = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
const queryText = "Open accessibility bugs assigned to me, created this month, with more than 5 comments";
const studioText = "Das Produkt ist sehr gut, aber die Dokumentation sind unklar. Ich konnte die Installation trotzdem abschließen.";
const rows = [];
let server;

function parameterCount(label) {
  const match = label.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*([MB])(?:\s|\b)/i);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number.parseFloat(match[1]) * (match[2].toUpperCase() === "B" ? 1_000 : 1);
}

function modelUrl(model) {
  const [repo, file] = model.value.split("#");
  if (file) return `https://huggingface.co/${repo}/resolve/main/${file}`;
  if (repo.includes("/")) return `https://huggingface.co/${repo}`;
  const record = prebuiltAppConfig.model_list.find((item) => item.model_id === repo);
  return record?.model ?? `https://huggingface.co/mlc-ai/${repo}`;
}

const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const addRow = (row) => rows.push({ recorded_at: new Date().toISOString(), ...row });
const save = async () => {
  const columns = ["recorded_at", "backend", "model_value", "model", "phase", "task", "duration_ms", "outcome", "valid", "detail"];
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csv(row[column])).join(",")).join("\n")}\n`);
};

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* Vite is still starting. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`App did not become available at ${url}`);
}

try {
  if (!externalUrl) {
    server = spawn(process.execPath, [resolve("node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "4173", "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    await waitForServer(baseUrl);
  }

  const browser = await chromium.launch({
    headless: !has("--headed"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--use-angle=swiftshader"],
    ...(proxyServer ? { proxy: { server: proxyServer, bypass: "localhost,127.0.0.1" } } : {}),
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  await page.addInitScript(() => {
    window.__issueQueryBenchmarkEvents = [];
    window.addEventListener("issue-query:timing", (event) => window.__issueQueryBenchmarkEvents.push(event.detail));
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.querySelector("#issue-backend")?.disabled);

  const backends = backendFilter === "all" ? ["transformers", "webllm"] : [backendFilter];
  const models = [];
  for (const backend of backends) {
    await page.selectOption("#issue-backend", backend);
    await page.waitForFunction((expected) => document.querySelector("#issue-backend")?.value === expected && !document.querySelector("#issue-backend")?.disabled, backend);
    const options = await page.locator("#issue-model option").evaluateAll((items) => items.map((option) => ({ value: option.value, label: option.textContent?.trim() ?? option.value, runtime: option.dataset.runtime, disabled: option.disabled })));
    for (const option of options) if ((!modelFilter || `${option.value} ${option.label}`.toLowerCase().includes(modelFilter))) models.push({ backend, ...option });
  }
  let selectedModels = smallest > 0
    ? [...models].filter((model) => !model.disabled && model.runtime !== "gguf").sort((left, right) => parameterCount(left.label) - parameterCount(right.label)).slice(0, smallest)
    : models;
  if (limit > 0) selectedModels = selectedModels.slice(0, limit);
  console.log(`Benchmarking ${selectedModels.length} of ${models.length} matching models; writing ${output}`);

  for (const [index, model] of selectedModels.entries()) {
    console.log(`[${index + 1}/${selectedModels.length}] ${model.backend}: ${model.label}`);
    const linkStarted = performance.now();
    const url = modelUrl(model);
    try {
      const response = await context.request.head(url, { timeout: Math.min(timeoutMs, 30_000) });
      if (!response.ok()) throw new Error(`HTTP ${response.status()} ${response.statusText()}`);
      addRow({ backend: model.backend, model_value: model.value, model: model.label, phase: "Link check", task: "model", duration_ms: performance.now() - linkStarted, outcome: "Completed", valid: true, detail: url });
    } catch (error) {
      addRow({ backend: model.backend, model_value: model.value, model: model.label, phase: "Link check", task: "model", duration_ms: performance.now() - linkStarted, outcome: "Failed", valid: false, detail: `${url} — ${error instanceof Error ? error.message : String(error)}` });
      console.error(`  link failed: ${error instanceof Error ? error.message : error}`);
      await save();
      continue;
    }
    if (has("--links-only")) { await save(); continue; }
    if (model.disabled) {
      addRow({ backend: model.backend, model_value: model.value, model: model.label, phase: "Validation", task: "model", duration_ms: 0, outcome: "Skipped", valid: false, detail: "Model is unsupported by this browser (usually missing shader-f16)." });
      continue;
    }
    await page.selectOption("#issue-backend", model.backend);
    await page.waitForFunction(() => !document.querySelector("#issue-backend")?.disabled);
    await page.selectOption("#issue-model", model.value);
    await page.waitForFunction((expected) => document.querySelector("#issue-model")?.value === expected && !document.querySelector("#issue-model")?.disabled, model.value);
    await page.evaluate(() => { window.__issueQueryBenchmarkEvents = []; });

    for (const task of ["query", "text_studio"]) {
      const started = performance.now();
      let taskFailed = false;
      try {
        if (task === "query") {
          await page.fill("#description", queryText);
          await page.click("#generate");
          await page.waitForFunction(() => !document.querySelector("#generate")?.disabled);
          const error = await page.locator("#error").textContent();
          const result = await page.locator("#query").textContent();
          if (error) throw new Error(error);
          if (!result?.trim()) throw new Error("Query output was empty");
          addRow({ backend: model.backend, model_value: model.value, model: model.label, phase: "Validation", task, duration_ms: performance.now() - started, outcome: "Completed", valid: true, detail: result.trim() });
        } else {
          await page.fill("#treatment-input", studioText);
          await page.click("#treat-text");
          await page.waitForFunction(() => !document.querySelector("#treat-text")?.disabled);
          const error = await page.locator("#treatment-error").textContent();
          const result = await page.locator("#treatment-output").textContent();
          if (error) throw new Error(error);
          if (!result?.trim()) throw new Error("Text Studio output was empty");
          addRow({ backend: model.backend, model_value: model.value, model: model.label, phase: "Validation", task, duration_ms: performance.now() - started, outcome: "Completed", valid: true, detail: result.trim() });
        }
      } catch (error) {
        taskFailed = true;
        addRow({ backend: model.backend, model_value: model.value, model: model.label, phase: "Validation", task, duration_ms: performance.now() - started, outcome: "Failed", valid: false, detail: error instanceof Error ? error.message : String(error) });
        console.error(`  ${task} failed: ${error instanceof Error ? error.message : error}`);
      }
      if (!page.isClosed()) {
        const timingEvents = await page.evaluate(() => window.__issueQueryBenchmarkEvents.splice(0));
        for (const event of timingEvents) addRow({ backend: model.backend, model_value: model.value, model: event.model, phase: event.phase, task: event.phase === "Text treatment" ? "text_studio" : event.phase === "Output generation" ? "query" : "model", duration_ms: event.durationMs.toFixed(3), outcome: event.outcome, valid: event.outcome === "Completed", detail: "" });
      }
      if (taskFailed && task === "query" && !page.isClosed()) {
        await page.reload({ waitUntil: "networkidle" });
        await page.waitForFunction(() => !document.querySelector("#issue-backend")?.disabled);
        await page.selectOption("#issue-backend", model.backend);
        await page.waitForFunction(() => !document.querySelector("#issue-backend")?.disabled);
        await page.selectOption("#issue-model", model.value);
        await page.waitForFunction((expected) => document.querySelector("#issue-model")?.value === expected && !document.querySelector("#issue-model")?.disabled, model.value);
        await page.evaluate(() => { window.__issueQueryBenchmarkEvents = []; });
      }
    }
    await save();
  }
  await browser.close();
  await save();
  console.log(`Saved ${rows.length} rows to ${output}`);
} finally {
  if (server) server.kill("SIGTERM");
}
