import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration } from "../src/performanceLog.ts";

test("formats performance timings for quick and long operations", () => {
  assert.equal(formatDuration(487), "487 ms");
  assert.equal(formatDuration(12_340), "12.3 s");
  assert.equal(formatDuration(134_000), "2m 14s");
});
