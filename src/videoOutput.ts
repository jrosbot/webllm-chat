const FRAME_COUNT = 17;
const FRAME_WIDTH = 256;
const FRAME_HEIGHT = 256;
const FRAME_RGB_VALUES = FRAME_COUNT * FRAME_WIDTH * FRAME_HEIGHT * 3;
const FRAME_RGB_DIMS = [FRAME_COUNT, FRAME_HEIGHT, FRAME_WIDTH, 3] as const;

// Drishya's exported TAEW2.2 decoder returns float32 frames in [0, 255].
// Convert them to the byte buffer expected by ImageData and WebM encoding.
export function decoderPixelsToRgb(data: unknown, dims: readonly number[]) {
  const type = ArrayBuffer.isView(data) ? data.constructor.name : typeof data;
  const shape = dims.length === 5 && dims[0] === 1 ? dims.slice(1) : [...dims];
  const validShape = shape.length === FRAME_RGB_DIMS.length && shape.every((dimension, index) => dimension === FRAME_RGB_DIMS[index]);
  if (!validShape) {
    throw new Error(`The local decoder returned ${type} with shape [${dims.join(", ")}]; expected [${FRAME_RGB_DIMS.join(", ")}] or [1, ${FRAME_RGB_DIMS.join(", ")}].`);
  }

  if (data instanceof Uint8Array) {
    if (data.length !== FRAME_RGB_VALUES) throw new Error(`The local decoder returned Uint8Array with shape [${dims.join(", ")}] and ${data.length} values; expected ${FRAME_RGB_VALUES} RGB values.`);
    return data.slice();
  }
  if (data instanceof Uint8ClampedArray) {
    if (data.length !== FRAME_RGB_VALUES) throw new Error(`The local decoder returned Uint8ClampedArray with shape [${dims.join(", ")}] and ${data.length} values; expected ${FRAME_RGB_VALUES} RGB values.`);
    return Uint8Array.from(data);
  }
  if (data instanceof Float32Array || data instanceof Float64Array) {
    if (data.length !== FRAME_RGB_VALUES) throw new Error(`The local decoder returned ${type} with shape [${dims.join(", ")}] and ${data.length} values; expected ${FRAME_RGB_VALUES} RGB values.`);
    const rgb = new Uint8Array(FRAME_RGB_VALUES);
    for (let i = 0; i < rgb.length; i++) rgb[i] = Math.max(0, Math.min(255, Math.round(data[i])));
    return rgb;
  }

  const length = data && typeof data === "object" && "length" in data ? String(data.length) : "unknown";
  throw new Error(`The local decoder returned ${type} with shape [${dims.join(", ")}] and ${length} values; expected Uint8Array, Uint8ClampedArray, Float32Array or Float64Array pixels.`);
}
