import { quantizeVideoOnnx } from "./videoQuantization";

type WorkerScope = {
  addEventListener(type: "message", callback: (event: MessageEvent<ArrayBuffer>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

const workerScope = self as unknown as WorkerScope;
workerScope.addEventListener("message", (event) => {
  try {
    const converted = quantizeVideoOnnx(new Uint8Array(event.data), (percent) => workerScope.postMessage({ type: "progress", percent }));
    workerScope.postMessage({ type: "complete", model: converted.model.buffer, summary: converted.summary }, [converted.model.buffer]);
  } catch (reason) {
    workerScope.postMessage({ type: "error", message: reason instanceof Error ? reason.message : String(reason) });
  }
});
