import "./style.css";
import "./audioStudio.css";
import { resampleToMono, whisperLanguageFor } from "./audioUtils.ts";

const VOICES = {
  de: { model: "Xenova/mms-tts-deu", label: "German · MMS-TTS (VITS)", example: "Der rote Apfel liegt auf dem Tisch." },
  ca: { model: "Xenova/mms-tts-cat", label: "Catalan · MMS-TTS (VITS)", example: "La poma vermella és damunt la taula." },
} as const;

type AudioResult = { data: Float32Array; sampling_rate: number; toBlob(): Blob };
type VoicePipeline = ((text: string) => Promise<AudioResult>) & { dispose(): Promise<unknown> };
type Transcription = { text: string };
type SpeechPipeline = ((audio: Float32Array, options: { language: string; task: "transcribe" }) => Promise<Transcription>) & { dispose(): Promise<unknown> };
type WebGpuAdapter = { features: { has(name: string): boolean } };
const ASR_MODEL = "Xenova/whisper-tiny";
const MAX_RECORDING_MS = 20_000;

document.querySelector<HTMLDivElement>("#audio-app")!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="./index.html" aria-label="WebLLM applications home"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span>WEBLLM</span></a>
    <nav class="app-nav" aria-label="Applications"><span>APPLICATIONS</span><a href="./index.html">Text applications</a><a href="./image.html">Image vocabulary studio</a><a href="#audio-studio" aria-current="page">Audio vocabulary studio</a></nav>
    <div class="local-pill"><span class="pulse"></span> RUNS LOCALLY</div>
  </header>
  <main>
    <section class="hero"><p class="eyebrow">LOCAL SPEECH PRACTICE</p><h1>Hear the phrase.</h1><p class="lede">Generate German or Catalan speech, then record yourself and see what the local model understood.</p></section>
    <section class="workspace" id="audio-studio" aria-labelledby="audio-title">
      <div class="workspace-head"><div><span class="step">01</span><h2 id="audio-title">Audio vocabulary studio</h2></div><span class="image-badge">Transformers.js · TTS + Whisper</span></div>
      <p class="audio-notice">Choose German or Catalan to load that language’s voice. The first use downloads and caches a quantized model for the selected language. Your text stays on this device. These research voices are single-speaker and may sound less natural than a dedicated commercial service.</p>
      <label for="audio-text">TEXT TO SPEAK</label>
      <textarea id="audio-text" rows="3" maxlength="500" aria-describedby="audio-text-hint">Der rote Apfel liegt auf dem Tisch.</textarea>
      <div class="examples"><span>EXAMPLES</span><button type="button" data-audio-example="de">German phrase</button><button type="button" data-audio-example="ca">Catalan phrase</button></div>
      <div class="audio-options">
        <label for="audio-language">LANGUAGE<select id="audio-language"><option value="de">German</option><option value="ca">Catalan</option></select></label>
        <label for="audio-device">COMPUTE<select id="audio-device"><option value="wasm">CPU · compatible</option><option value="webgpu" disabled>GPU · WebGPU</option></select></label>
      </div>
      <p class="text-hint" id="audio-text-hint">Use a short phrase for faster synthesis. The model and voice are selected by language.</p>
      <div class="action-row"><p id="audio-status" role="status" aria-live="polite">Checking available compute…</p><div class="audio-actions"><button id="audio-release" type="button">Release model</button><button id="audio-generate" class="generate" type="button"><span>Generate speech</span><b aria-hidden="true">→</b></button></div></div>
      <progress id="audio-progress" max="100" value="0" hidden aria-label="Voice model download progress"></progress>
      <p id="audio-error" class="error" role="alert"></p>
      <section id="audio-result" class="audio-result" hidden aria-labelledby="audio-result-title">
        <h3 id="audio-result-title">Generated audio</h3>
        <audio id="audio-player" controls></audio>
        <a id="audio-download" class="audio-download" download="vocabulary-speech.wav">Download WAV</a>
        <p id="audio-details" class="text-hint"></p>
      </section>
      <p class="text-hint audio-license">Models: <a href="https://huggingface.co/Xenova/mms-tts-deu" target="_blank" rel="noreferrer">German MMS-TTS</a> · <a href="https://huggingface.co/Xenova/mms-tts-cat" target="_blank" rel="noreferrer">Catalan MMS-TTS</a>. Check the model cards and their CC BY-NC 4.0 terms before redistributing generated audio or using it commercially.</p>

      <section class="speech-practice" aria-labelledby="speech-title">
        <div class="practice-heading"><span class="step">02</span><h2 id="speech-title">Speak the phrase</h2></div>
        <p class="audio-notice">Record a short phrase and compare it with the local transcription. Microphone audio is not uploaded; the first use downloads a compact multilingual model.</p>
        <label class="speech-language-picker" for="speech-language">LANGUAGE YOU'RE SPEAKING
          <select id="speech-language"><option value="ca" selected>Catalan</option><option value="de">German</option></select>
        </label>
        <p class="text-hint speech-language-hint">Whisper Tiny will use this language instead of trying to identify it automatically. This choice is separate from the voice language above.</p>
        <div class="record-controls">
          <button id="record-start" class="generate" type="button"><span>Start recording</span><b aria-hidden="true">●</b></button>
          <button id="record-stop" type="button" disabled>Stop recording</button>
          <button id="record-clear" type="button" disabled>Clear recording</button>
          <p id="record-status" role="status" aria-live="polite">Microphone access is requested only when you start recording.</p>
        </div>
        <p id="record-error" class="error" role="alert"></p>
        <section id="recording-preview" class="recording-preview" hidden aria-labelledby="recording-preview-title">
          <h3 id="recording-preview-title">Your recording</h3>
          <audio id="recording-player" controls></audio>
          <button id="transcribe" class="generate" type="button" disabled><span>Transcribe recording</span><b aria-hidden="true">→</b></button>
        </section>
        <progress id="asr-progress" max="100" value="0" hidden aria-label="Transcription model download progress"></progress>
        <section id="transcript-result" class="transcript-result" hidden aria-labelledby="transcript-title">
          <h3 id="transcript-title">What the model heard</h3>
          <textarea id="transcript-text" rows="3" readonly aria-label="Recognized speech"></textarea>
          <p id="transcript-details" class="text-hint">Compare this text with what you intended to say. Recognition can vary with pronunciation, background noise, and the short Whisper model.</p>
        </section>
        <p class="text-hint audio-license">Speech recognition: <a href="https://huggingface.co/Xenova/whisper-tiny" target="_blank" rel="noreferrer">Whisper Tiny multilingual</a>. Choose CPU for the compatible default; WebGPU uses the same device selection above.</p>
      </section>
    </section>
  </main>
  <footer><span>WEBLLM / AUDIO STUDIO</span><span>Speech and recordings stay on this device</span></footer>`;

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
const recordStart = get<HTMLButtonElement>("#record-start");
const recordStop = get<HTMLButtonElement>("#record-stop");
const recordClear = get<HTMLButtonElement>("#record-clear");
const recordStatus = get<HTMLParagraphElement>("#record-status");
const recordError = get<HTMLParagraphElement>("#record-error");
const speechLanguage = get<HTMLSelectElement>("#speech-language");
const recordingPreview = get<HTMLElement>("#recording-preview");
const recordingPlayer = get<HTMLAudioElement>("#recording-player");
const transcribe = get<HTMLButtonElement>("#transcribe");
const asrProgress = get<HTMLProgressElement>("#asr-progress");
const transcriptResult = get<HTMLElement>("#transcript-result");
const transcriptText = get<HTMLTextAreaElement>("#transcript-text");
let model: VoicePipeline | undefined;
let loadedKey = "";
let speechModel: SpeechPipeline | undefined;
let speechLoadedKey = "";
let audioUrl: string | undefined;
let recordingUrl: string | undefined;
let recordedBlob: Blob | undefined;
let recordingStream: MediaStream | undefined;
let recorder: MediaRecorder | undefined;
let recordingChunks: BlobPart[] = [];
let recordingStartedAt = 0;
let recordingTimer: ReturnType<typeof setInterval> | undefined;
let recording = false;
let microphonePending = false;
let busy = false;

function updateControls() {
  const locked = busy || microphonePending || recording;
  generate.disabled = locked;
  release.disabled = locked || (!model && !speechModel);
  text.disabled = locked;
  language.disabled = locked;
  speechLanguage.disabled = locked;
  device.disabled = locked;
  document.querySelectorAll<HTMLButtonElement>("[data-audio-example]").forEach(button => { button.disabled = locked; });
  recordStart.disabled = locked || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined";
  recordStop.disabled = !recording;
  transcribe.disabled = locked || !recordedBlob;
  recordClear.disabled = locked || !recordedBlob;
}

function setBusy(value: boolean) {
  busy = value;
  updateControls();
}

function clearAudio() {
  player.pause();
  player.removeAttribute("src");
  player.load();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = undefined;
  result.hidden = true;
}

function stopMicrophoneTracks() {
  recordingStream?.getTracks().forEach(track => track.stop());
  recordingStream = undefined;
}

function clearRecording() {
  if (recorder?.state === "recording") {
    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
    recorder.stop();
  }
  if (recordingTimer) clearInterval(recordingTimer);
  recordingTimer = undefined;
  stopMicrophoneTracks();
  recording = false;
  microphonePending = false;
  recorder = undefined;
  recordingChunks = [];
  recordedBlob = undefined;
  recordingPlayer.pause();
  recordingPlayer.removeAttribute("src");
  recordingPlayer.load();
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  recordingUrl = undefined;
  recordingPreview.hidden = true;
  transcriptResult.hidden = true;
  transcriptText.value = "";
  recordError.textContent = "";
  recordStatus.textContent = "Microphone access is requested only when you start recording.";
  updateControls();
}

function setRecordingStatus() {
  const seconds = Math.min(MAX_RECORDING_MS, Date.now() - recordingStartedAt) / 1000;
  recordStatus.textContent = `Recording · ${seconds.toFixed(1)} / ${MAX_RECORDING_MS / 1000} seconds. Read a short phrase, then stop.`;
  if (seconds >= MAX_RECORDING_MS / 1000) stopRecording();
}

function stopRecording() {
  if (!recorder || recorder.state !== "recording") return;
  if (recordingTimer) clearInterval(recordingTimer);
  recordingTimer = undefined;
  recorder.stop();
  stopMicrophoneTracks();
}

async function decodeRecording(blob: Blob): Promise<Float32Array> {
  type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;
  const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Context) throw new Error("This browser cannot decode the recording. Try a recent version of Chrome, Safari, or Firefox.");
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    return resampleToMono(channels, decoded.sampleRate, 16_000);
  } finally {
    await context.close();
  }
}

async function disposeVoiceModel() {
  if (!model) return;
  await model.dispose();
  model = undefined;
  loadedKey = "";
}

async function disposeSpeechModel() {
  if (!speechModel) return;
  await speechModel.dispose();
  speechModel = undefined;
  speechLoadedKey = "";
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

speechLanguage.addEventListener("change", () => {
  transcriptResult.hidden = true;
  transcriptText.value = "";
  recordError.textContent = "";
  recordStatus.textContent = recordedBlob
    ? "Spoken language changed. Transcribe the recording again."
    : "Choose the language you'll speak, then start recording.";
});

recordStart.addEventListener("click", async () => {
  clearRecording();
  recordError.textContent = "";
  transcriptResult.hidden = true;
  microphonePending = true;
  recordStatus.textContent = "Waiting for microphone permission…";
  updateControls();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!microphonePending) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    recordingStream = stream;
    recordingChunks = [];
    recorder = new MediaRecorder(stream);
    const activeRecorder = recorder;
    activeRecorder.ondataavailable = event => {
      if (event.data.size > 0) recordingChunks.push(event.data);
    };
    activeRecorder.onerror = () => {
      recordError.textContent = "The browser could not record audio. Check microphone access and try again.";
    };
    activeRecorder.onstop = () => {
      const duration = (Date.now() - recordingStartedAt) / 1000;
      recording = false;
      microphonePending = false;
      stopMicrophoneTracks();
      if (!recordingChunks.length) {
        recordError.textContent = "No audio was captured. Check microphone access and try again.";
        recordStatus.textContent = "Recording ended without audio.";
      } else {
        recordedBlob = new Blob(recordingChunks, { type: activeRecorder.mimeType || "audio/webm" });
        recordingUrl = URL.createObjectURL(recordedBlob);
        recordingPlayer.src = recordingUrl;
        recordingPreview.hidden = false;
        recordStatus.textContent = `Recorded ${duration.toFixed(1)} seconds. Listen to it, then transcribe.`;
      }
      recordingChunks = [];
      updateControls();
    };
    activeRecorder.start(250);
    recordingStartedAt = Date.now();
    recording = true;
    microphonePending = false;
    recordStatus.textContent = `Recording · 0.0 / ${MAX_RECORDING_MS / 1000} seconds. Read a short phrase, then stop.`;
    recordingTimer = setInterval(setRecordingStatus, 250);
    updateControls();
  } catch (reason) {
    stopMicrophoneTracks();
    microphonePending = false;
    const message = reason instanceof Error ? reason.message : String(reason);
    recordError.textContent = `Could not start the microphone: ${message}. Allow microphone access and try again.`;
    recordStatus.textContent = "Microphone is not recording.";
    updateControls();
  }
});

recordStop.addEventListener("click", stopRecording);
recordClear.addEventListener("click", clearRecording);

transcribe.addEventListener("click", async () => {
  if (!recordedBlob) return;
  recordError.textContent = "";
  transcriptResult.hidden = true;
  asrProgress.hidden = false;
  asrProgress.value = 0;
  setBusy(true);
  try {
    const selectedDevice = device.value as "wasm" | "webgpu";
    if (selectedDevice === "webgpu" && !await webGpuAdapter()) throw new Error("WebGPU is no longer available. Choose CPU and retry.");
    await disposeVoiceModel();
    recordStatus.textContent = "Preparing your recording for local transcription…";
    const waveform = await decodeRecording(recordedBlob);
    if (waveform.length < 3_200) throw new Error("The recording is too short. Record at least a short word or phrase.");
    const key = `${ASR_MODEL}:${selectedDevice}`;
    if (speechModel && speechLoadedKey !== key) await disposeSpeechModel();
    if (!speechModel) {
      recordStatus.textContent = `Loading multilingual Whisper Tiny on ${selectedDevice === "wasm" ? "CPU" : "WebGPU"}…`;
      const { pipeline } = await import("@huggingface/transformers");
      speechModel = await pipeline("automatic-speech-recognition", ASR_MODEL, {
        device: selectedDevice,
        dtype: selectedDevice === "wasm" ? "q8" : "fp16",
        progress_callback(info) {
          if (info.status === "progress_total") {
            asrProgress.value = info.progress;
            recordStatus.textContent = `Downloading Whisper Tiny · ${Math.round(info.progress)}%`;
          } else if (info.status === "ready") {
            asrProgress.value = 100;
            recordStatus.textContent = "Whisper Tiny is ready.";
          }
        },
      }) as unknown as SpeechPipeline;
      speechLoadedKey = key;
    }
    recordStatus.textContent = `Transcribing your ${speechLanguage.value === "de" ? "German" : "Catalan"} recording on this device…`;
    const output = await speechModel(waveform, {
      language: whisperLanguageFor(speechLanguage.value),
      task: "transcribe",
    });
    transcriptText.value = output.text.trim() || "No words were recognized. Try speaking more clearly or moving closer to the microphone.";
    transcriptResult.hidden = false;
    recordStatus.textContent = "Transcription finished locally. Compare the text with what you said.";
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    recordError.textContent = `${message} If this is the first run, check the connection to huggingface.co and available browser storage.`;
    recordStatus.textContent = "Speech recognition failed.";
    if (speechModel && !speechLoadedKey) {
      await speechModel.dispose().catch(() => {});
      speechModel = undefined;
    }
  } finally {
    asrProgress.hidden = true;
    setBusy(false);
  }
});

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
      await disposeSpeechModel();
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
  if ((!model && !speechModel) || busy) return;
  setBusy(true);
  try {
    await disposeVoiceModel();
    await disposeSpeechModel();
    status.textContent = "Audio model released from memory. Downloaded files remain cached.";
  } catch (reason) { error.textContent = reason instanceof Error ? reason.message : String(reason); }
  finally { setBusy(false); }
});

window.addEventListener("pagehide", () => {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  if (recordingTimer) clearInterval(recordingTimer);
  if (recorder?.state === "recording") {
    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
    recorder.stop();
  }
  stopMicrophoneTracks();
  void disposeVoiceModel().catch(() => {});
  void disposeSpeechModel().catch(() => {});
});
