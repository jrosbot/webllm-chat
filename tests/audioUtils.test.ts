import assert from "node:assert/strict";
import test from "node:test";
import { resampleToMono, whisperLanguageFor } from "../src/audioUtils.ts";

test("resampleToMono downmixes channels and resamples to the requested rate", () => {
  const left = new Float32Array([1, 1, 0, 0]);
  const right = new Float32Array([-1, -1, 1, 1]);
  const audio = resampleToMono([left, right], 4, 2);

  assert.deepEqual([...audio], [0, 0.5]);
  assert.deepEqual([...left], [1, 1, 0, 0], "input samples are preserved");
});

test("resampleToMono preserves samples at the same rate and interpolates when upsampling", () => {
  assert.deepEqual([...resampleToMono([new Float32Array([0, 1])], 2, 2)], [0, 1]);
  assert.deepEqual([...resampleToMono([new Float32Array([0, 1])], 2, 4)], [0, 0.5, 1, 1]);
});

test("resampleToMono rejects invalid channel layouts and rates", () => {
  assert.throws(() => resampleToMono([], 16_000), /channels/);
  assert.throws(() => resampleToMono([new Float32Array(1), new Float32Array(2)], 16_000), /channels/);
  assert.throws(() => resampleToMono([new Float32Array(1)], 0), /sample rates/);
});

test("Whisper is explicitly steered to German or Catalan", () => {
  assert.equal(whisperLanguageFor("de"), "german");
  assert.equal(whisperLanguageFor("ca"), "catalan");
  assert.throws(() => whisperLanguageFor("en"), /Unsupported speech-recognition language/);
});
