import "./style.css";
import "./audioStudio.css";

const VOICES = {
  de: { model: "Xenova/mms-tts-deu", label: "German · MMS-TTS (VITS)", example: "Der rote Apfel liegt auf dem Tisch." },
  ca: { model: "Xenova/mms-tts-cat", label: "Catalan · MMS-TTS (VITS)", example: "La poma vermella és damunt la taula." },
} as const;

type AudioResult = { data: Float32Array; sampling_rate: number; toBlob(): Blob };
type VoicePipeline = ((text: string) => Promise<AudioResult>) & { dispose(): Promise<unknown> };
type WebGpuAdapter = { features: { has(name: string): boolean } };

document.querySelector<HTMLDivElement>("#audio-app")!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="./index.html" aria-label="WebLLM applications home"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span>WEBLLM</span></a>
    <nav class="app-nav" aria-label="Applications"><span>APPLICATIONS</span><a href="./index.html">Text applications</a><a href="./image.html">Image vocabulary studio</a><a href="#audio-studio" aria-current="page">Audio vocabulary studio</a></nav>
    <div class="local-pill"><span class="pulse"></span> RUNS LOCALLY</div>
  </header>
  <main>
    <section class="hero"><p class="eyebrow">LOCAL TEXT-TO-SPEECH</p><h1>Hear the phrase.</h1><p class="lede">Turn German or Catalan text into speech in this browser, then play or save the audio as a WAV file.</p></section>
    <section class="workspace" id="audio-studio" aria-labelledby="audio-title">
      <div class="workspace-head"><div><span class="step">01</span><h2 id="audio-title">Audio vocabulary studio</h2></div><span class="image-badge">Transformers.js · MMS-TTS</span></div>
      <p class="audio-notice">Choose German or Catalan to load that language’s voice. The first use downloads and caches a quantized model for the selected language. Your text stays on this device. These research voices are single-speaker and may sound less natural than a dedicated commercial service.</p>
      <label for="audio-text">TEXT TO SPEAK</label>
      <textarea id="audio-text" rows="3" maxlength="500" aria-describedby="audio-text-hint">Der rote Apfel liegt auf dem Tisch.</textarea>
      <div class="examples"><span>EXAMPLES</span><button type="button" data-audio-example="de">German phrase</button><button type="button" data-audio-example="ca">Catalan phrase</button></div>
      <div class="audio-options">
        <label for="audio-language">LANGUAGE<select id="audio-language"><option value="de">German</option><option value="ca">Catalan</option></select></label>
        <label for="audio-device">COMPUTE<select id="audio-device"><option value="wasm">CPU · compatible</option><option value="webgpu" disabled>GPU · WebGPU</option></select></label>
      </div>
      <p class="text-hint" id="audio-text-hint">Use a short phrase for faster synthesis. The model and voice are selected by language.</p>
      <div class="action-row"><p id="audio-status" role="status" aria-live="polite">Checking available compute…</p><div class="audio-actions"><button id="audio-release" type="button">Release voice model</button><button id="audio-generate" class="generate" type="button"><span>Generate speech</span><b aria-hidden="true">→</b></button></div></div>
      <progress id="audio-progress" max="100" value="0" hidden aria-label="Voice model download progress"></progress>
      <p id="audio-error" class="error" role="alert"></p>
      <section id="audio-result" class="audio-result" hidden aria-labelledby="audio-result-title">
        <h3 id="audio-result-title">Generated audio</h3>
        <audio id="audio-player" controls></audio>
        <a id="audio-download" class="audio-download" download="vocabulary-speech.wav">Download WAV</a>
        <p id="audio-details" class="text-hint"></p>
      </section>
      <p class="text-hint audio-license">Models: <a href="https://huggingface.co/Xenova/mms-tts-deu" target="_blank" rel="noreferrer">German MMS-TTS</a> · <a href="https://huggingface.co/Xenova/mms-tts-cat" target="_blank" rel="noreferrer">Catalan MMS-TTS</a>. Check the model cards and their CC BY-NC 4.0 terms before redistributing generated audio or using it commercially.</p>
    </section>
  </main>
  <footer><span>WEBLLM / AUDIO STUDIO</span><span>Local speech synthesis · No text collected</span></footer>`;

const get = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const text = get<HTMLTextAreaElement>("#audio-text");
const language = get<HTMLSelectElement>("#audio-language");
const device = get<HTMLSelectElement>("#audio-device");
const generate = get<HTMLButtonElement>("#audio-generate");
const release = get<HTMLButtonElement>("#audio-release");
const status = get<HTMLParagraphElement>("#audio-status");
const error = get<HTMLParagraphElement>("#audio-error");
const progress = get<HTMLProgressElement>("#audio-progress");
const result = get<HTMLElement>("#audio-result");
const player = get<HTMLAudioElement>("#audio-player");
let model: VoicePipeline | undefined;
let loadedKey = "";
let audioUrl: string | undefined;
let busy = false;

function setBusy(value: boolean) {
  busy = value;
  generate.disabled = value;
  release.disabled = value || !model;
  text.disabled = value;
  language.disabled = value;
  device.disabled = value;
  document.querySelectorAll<HTMLButtonElement>("[data-audio-example]").forEach(button => { button.disabled = value; });
}

function clearAudio() {
  player.pause();
  player.removeAttribute("src");
  player.load();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = undefined;
  result.hidden = true;
}

async function webGpuAdapter() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<WebGpuAdapter | null> } }).gpu;
  return gpu?.requestAdapter() ?? null;
}

document.querySelectorAll<HTMLButtonElement>("[data-audio-example]").forEach(button => button.addEventListener("click", () => {
  language.value = button.dataset.audioExample!;
  text.value = VOICES[language.value as keyof typeof VOICES].example;
}));

language.addEventListener("change", () => {
  text.value = VOICES[language.value as keyof typeof VOICES].example;
  clearAudio();
});
text.addEventListener("input", clearAudio);

void webGpuAdapter().then(adapter => {
  const gpuOption = device.querySelector<HTMLOptionElement>('option[value="webgpu"]')!;
  gpuOption.disabled = !adapter;
  status.textContent = adapter
    ? "CPU is selected. WebGPU is available as an experimental option for this device."
    : "CPU mode is ready. No compatible WebGPU adapter was detected.";
}).catch(() => { status.textContent = "CPU mode is ready. WebGPU is unavailable in this browser."; });

generate.addEventListener("click", async () => {
  const phrase = text.value.trim();
  if (!phrase) { error.textContent = "Enter a phrase first."; return; }
  if (phrase.length > 500) { error.textContent = "Keep each phrase to 500 characters or fewer."; return; }
  const voice = VOICES[language.value as keyof typeof VOICES];
  const selectedDevice = device.value as "wasm" | "webgpu";
  const key = `${voice.model}:${selectedDevice}`;
  clearAudio(); error.textContent = ""; progress.hidden = false; progress.value = 0;
  setBusy(true);
  try {
    if (selectedDevice === "webgpu" && !await webGpuAdapter()) throw new Error("WebGPU is no longer available. Choose CPU and retry.");
    if (!model || loadedKey !== key) {
      if (model) await model.dispose();
      model = undefined; loadedKey = "";
      status.textContent = `Loading ${voice.label} on ${selectedDevice === "wasm" ? "CPU" : "WebGPU"}…`;
      const { pipeline } = await import("@huggingface/transformers");
      model = await pipeline("text-to-speech", voice.model, {
        device: selectedDevice,
        dtype: selectedDevice === "wasm" ? "q8" : "fp32",
        progress_callback(info) {
          if (info.status === "progress_total") {
            progress.value = info.progress;
            status.textContent = `Downloading ${voice.label} · ${Math.round(info.progress)}%`;
          } else if (info.status === "ready") {
            progress.value = 100;
            status.textContent = `${voice.label} is ready.`;
          }
        },
      }) as unknown as VoicePipeline;
      loadedKey = key;
    }
    status.textContent = `Generating ${language.value === "de" ? "German" : "Catalan"} speech…`;
    const started = performance.now();
    const audio = await model(phrase);
    if (!(audio.data instanceof Float32Array) || audio.data.length === 0 || !Number.isFinite(audio.sampling_rate)) {
      throw new Error("The voice model returned an empty or invalid audio waveform.");
    }
    const blob = audio.toBlob();
    audioUrl = URL.createObjectURL(blob);
    player.src = audioUrl;
    const download = get<HTMLAnchorElement>("#audio-download");
    download.href = audioUrl;
    download.download = `${language.value}-speech.wav`;
    get<HTMLParagraphElement>("#audio-details").textContent = `${(audio.data.length / audio.sampling_rate).toFixed(1)} seconds · ${audio.sampling_rate.toLocaleString()} Hz · generated in ${((performance.now() - started) / 1000).toFixed(2)} seconds`;
    result.hidden = false;
    status.textContent = "Speech generated on this device. Play it or save the WAV file.";
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    error.textContent = `${message} If this is the first run, check the connection to huggingface.co and available browser storage.`;
    status.textContent = "Speech generation failed.";
    if (model && !loadedKey) { await model.dispose().catch(() => {}); model = undefined; }
  } finally {
    progress.hidden = true; setBusy(false);
  }
});

release.addEventListener("click", async () => {
  if (!model || busy) return;
  setBusy(true);
  try {
    await model.dispose(); model = undefined; loadedKey = "";
    status.textContent = "Voice model released from memory. Downloaded files remain cached.";
  } catch (reason) { error.textContent = reason instanceof Error ? reason.message : String(reason); }
  finally { setBusy(false); }
});

window.addEventListener("pagehide", () => {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  void model?.dispose().catch(() => {});
});
