import assert from "node:assert/strict";
import test from "node:test";
import { createStreamingSha256 } from "../src/streamingHash.ts";

test("incremental SHA-256 matches the standard digest across arbitrary chunk boundaries", () => {
  const hash = createStreamingSha256();
  for (const chunk of ["a", "b", "c"]) hash.update(new TextEncoder().encode(chunk));
  assert.equal(hash.digest(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
