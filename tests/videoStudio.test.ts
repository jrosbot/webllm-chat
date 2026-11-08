import assert from "node:assert/strict";
import test from "node:test";
import { decoderPixelsToRgb } from "../src/videoOutput.ts";

const FRAME_VALUES = 17 * 256 * 256 * 3;
const BATCHED_DIMS = [1, 17, 256, 256, 3];
const UNBATCHED_DIMS = [17, 256, 256, 3];

test("decoder converts float pixels to rounded, clipped RGB bytes", () => {
  const pixels = new Float32Array(FRAME_VALUES).fill(42);
  pixels.set([-1, 1.2, 2.5, 255.9, 300]);

  const rgb = decoderPixelsToRgb(pixels, BATCHED_DIMS);

  assert.ok(rgb instanceof Uint8Array);
  assert.deepEqual(Array.from(rgb.subarray(0, 5)), [0, 1, 3, 255, 255]);
  assert.equal(rgb.length, FRAME_VALUES);
});

test("decoder accepts byte pixels with the unbatched frame dimensions", () => {
  const pixels = new Uint8Array(FRAME_VALUES).fill(17);
  const rgb = decoderPixelsToRgb(pixels, UNBATCHED_DIMS);

  assert.deepEqual(rgb.subarray(0, 3), new Uint8Array([17, 17, 17]));
  assert.notEqual(rgb.buffer, pixels.buffer, "the returned RGB buffer must be independently owned");
});

test("decoder rejects unexpected shapes with type and shape diagnostics", () => {
  assert.throws(
    () => decoderPixelsToRgb(new Float32Array(3), [1, 1, 1, 1, 3]),
    /Float32Array with shape \[1, 1, 1, 1, 3\]; expected \[17, 256, 256, 3\]/,
  );
});

test("decoder rejects unsupported tensor data types with a useful error", () => {
  assert.throws(
    () => decoderPixelsToRgb(new Int16Array(FRAME_VALUES), UNBATCHED_DIMS),
    /Int16Array with shape \[17, 256, 256, 3\].*expected Uint8Array, Uint8ClampedArray, Float32Array or Float64Array/,
  );
});
