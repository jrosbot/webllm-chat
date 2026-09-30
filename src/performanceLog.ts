export type TimingPhase = "Model download" | "Model load" | "Output generation" | "Text treatment";

export interface TimingEntry {
  id: number;
  recordedAt: string;
  model: string;
  phase: TimingPhase;
  durationMs: number;
  outcome: "Completed" | "Failed";
}

export function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(durationMs / 60_000);
  return `${minutes}m ${Math.round((durationMs % 60_000) / 1_000)}s`;
}

export const performancePanel = `
  <section class="performance-panel" aria-labelledby="performance-title">
    <div class="performance-head">
      <div><span class="step">03</span><div><h2 id="performance-title">Performance log</h2><p>Compare how models perform on this device. Logs stay in this tab.</p></div></div>
      <div class="log-actions">
        <button id="copy-log" type="button" disabled>Copy log</button>
        <button id="download-log" type="button" disabled>Download .txt</button>
      </div>
    </div>
    <div id="timing-log" class="timing-log" aria-live="polite"><p class="empty-log">Timing data will appear after you generate a query or process text.</p></div>
    <div class="log-feedback">
      <span>Was this performance acceptable?</span>
      <button type="button" data-feedback="up" aria-label="Thumbs up" aria-pressed="false">👍</button>
      <button type="button" data-feedback="down" aria-label="Thumbs down" aria-pressed="false">👎</button>
      <span id="feedback-note" role="status"></span>
    </div>
  </section>`;

export class PerformanceLog {
  private entries: TimingEntry[] = [];
  private feedback: "up" | "down" | null = null;
  private nextId = 1;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    root.querySelector<HTMLButtonElement>("#copy-log")!.addEventListener("click", () => this.copy());
    root.querySelector<HTMLButtonElement>("#download-log")!.addEventListener("click", () => this.download());
    root.querySelectorAll<HTMLButtonElement>("[data-feedback]").forEach((button) => {
      button.addEventListener("click", () => this.setFeedback(button.dataset.feedback as "up" | "down"));
    });
  }

  add(model: string, phase: TimingPhase, startedAt: number, outcome: TimingEntry["outcome"] = "Completed") {
    const entry = { id: this.nextId++, recordedAt: new Date().toISOString(), model, phase, durationMs: performance.now() - startedAt, outcome };
    this.entries.push(entry);
    window.dispatchEvent(new CustomEvent<TimingEntry>("issue-query:timing", { detail: entry }));
    this.render();
  }

  private asText() {
    const rows = this.entries.map((entry) =>
      `${entry.recordedAt}\t${entry.model}\t${entry.phase}\t${formatDuration(entry.durationMs)}\t${entry.outcome}`,
    );
    return ["Issue Query performance log", `Feedback: ${this.feedback ?? "not provided"}`, "", "Time\tModel\tPhase\tDuration\tOutcome", ...rows].join("\n");
  }

  private render() {
    const log = this.root.querySelector<HTMLDivElement>("#timing-log")!;
    log.innerHTML = this.entries.map((entry) => `
      <div class="timing-row">
        <span class="timing-phase">${entry.phase}</span>
        <span class="timing-model">${entry.model}</span>
        <strong>${formatDuration(entry.durationMs)}</strong>
        <span class="timing-outcome ${entry.outcome.toLowerCase()}">${entry.outcome}</span>
      </div>`).join("");
    this.root.querySelector<HTMLButtonElement>("#copy-log")!.disabled = false;
    this.root.querySelector<HTMLButtonElement>("#download-log")!.disabled = false;
  }

  private async copy() {
    await navigator.clipboard.writeText(this.asText());
    const button = this.root.querySelector<HTMLButtonElement>("#copy-log")!;
    button.textContent = "Copied";
    window.setTimeout(() => (button.textContent = "Copy log"), 1_400);
  }

  private download() {
    const url = URL.createObjectURL(new Blob([this.asText()], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `issue-query-performance-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private setFeedback(value: "up" | "down") {
    this.feedback = this.feedback === value ? null : value;
    this.root.querySelectorAll<HTMLButtonElement>("[data-feedback]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.feedback === this.feedback));
    });
    this.root.querySelector("#feedback-note")!.textContent = this.feedback ? "Thanks — included when you share the log." : "";
  }
}
