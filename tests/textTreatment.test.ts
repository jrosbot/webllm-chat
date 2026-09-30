import assert from "node:assert/strict";
import test from "node:test";
import { createTextTreatmentPrompt, MAX_TEXT_LENGTH, MAX_TREATMENT_TOKENS, TEXT_EXAMPLES } from "../src/textTreatment.ts";

test("text treatment prompt requests bilingual structured output", () => {
  const prompt = createTextTreatmentPrompt();
  for (const heading of ["ORIGINAL LANGUAGE", "CORRECTED TEXT", "ENGLISH", "TRANSLATION", "CORRECTIONS", "SENTIMENTS"]) {
    assert.match(prompt, new RegExp(heading));
  }
  assert.match(prompt, /confidence percentage/);
});

test("provides German and French examples within the input limit", () => {
  assert.match(TEXT_EXAMPLES.de, /Letzte Woche/);
  assert.match(TEXT_EXAMPLES.fr, /Notre équipe/);
  assert.ok(Object.values(TEXT_EXAMPLES).every((example) => example.length <= MAX_TEXT_LENGTH));
  assert.ok(MAX_TREATMENT_TOKENS > 48);
});
