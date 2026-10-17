import assert from "node:assert/strict";
import test from "node:test";
import { lcmStep, lcmTimesteps, pixelsFromPlanarRGB, seededNoise } from "../src/diffusionMath.ts";

test("LCM selects the trained 50-step schedule at evenly spaced indices", () => {
  assert.deepEqual(lcmTimesteps(1), [999]);
  assert.deepEqual(lcmTimesteps(4), [999, 759, 499, 259]);
  assert.equal(lcmTimesteps(50).at(-1), 19);
  for (const invalid of [0, -1, 51, 1.5]) assert.throws(() => lcmTimesteps(invalid));
});

test("LCM final step reconstructs a known clean latent without adding noise", () => {
  let alpha = 1;
  const t = 499;
  for (let i = 0; i <= t; i++) alpha *= 1 - (Math.sqrt(.00085) + i / 999 * (Math.sqrt(.012) - Math.sqrt(.00085))) ** 2;
  const clean = [.25, -.5, 1];
  const epsilon = new Float32Array([.1, -.2, .3]);
  const sample = Float32Array.from(clean, (x, i) => Math.sqrt(alpha) * x + Math.sqrt(1 - alpha) * epsilon[i]);
  const output = lcmStep(sample, epsilon, t, undefined, () => { throw new Error("No noise on final step"); });
  output.forEach((x, i) => assert.ok(Math.abs(x - clean[i]) < 1e-6));
});

test("LCM intermediate steps inject scaled noise rather than returning the clean latent", () => {
  const sample = new Float32Array([0, 0]);
  const epsilon = new Float32Array([0, 0]);
  const next = lcmStep(sample, epsilon, 999, 759, () => .5);
  let alpha = 1;
  for (let i = 0; i <= 759; i++) alpha *= 1 - (Math.sqrt(.00085) + i / 999 * (Math.sqrt(.012) - Math.sqrt(.00085))) ** 2;
  assert.ok(Math.abs(next[0] - Math.sqrt(1 - alpha) * .5) < 1e-7);
  assert.throws(() => lcmStep(sample, new Float32Array(1), 999, 759, () => 0));
});

test("seeded normal noise repeats within a run and remains finite", () => {
  const a = seededNoise(42), b = seededNoise(42), c = seededNoise(43);
  const values = Array.from({ length: 10000 }, a);
  assert.deepEqual(values, Array.from({ length: 10000 }, b));
  assert.notEqual(values[0], c());
  assert.ok(values.every(Number.isFinite));
  const mean = values.reduce((a, b) => a + b) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  assert.ok(Math.abs(mean) < .05 && Math.abs(variance - 1) < .05);
});

test("decoder planar RGB becomes clipped opaque pixels and rejects invalid output", () => {
  assert.deepEqual([...pixelsFromPlanarRGB(new Float32Array([-1, 1, 0, -3, 1, 3]), 2, 1)], [0, 128, 255, 255, 255, 0, 255, 255]);
  assert.throws(() => pixelsFromPlanarRGB(new Float32Array([NaN, 0, 0]), 1, 1));
  assert.throws(() => pixelsFromPlanarRGB(new Float32Array(2), 1, 1));
});
