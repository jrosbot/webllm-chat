import assert from "node:assert/strict";
import test from "node:test";
import {
  composeTextTreatment,
  createEnglishTreatmentPrompt,
  createOriginalTreatmentPrompt,
  MAX_ENGLISH_TREATMENT_TOKENS,
  MAX_ORIGINAL_TREATMENT_TOKENS,
  MAX_TEXT_LENGTH,
  MAX_TREATMENT_TOKENS,
  TEXT_EXAMPLES,
} from "../src/textTreatment.ts";

test("text treatment uses two focused, structured prompts", () => {
  const original = createOriginalTreatmentPrompt();
  const english = createEnglishTreatmentPrompt("Das ist gut.", "CORRECTED TEXT\nDas ist gut.");
  for (const heading of ["CORRECTED TEXT", "SUMMARY", "KEY POINTS"]) assert.match(original, new RegExp(heading));
  for (const heading of ["TRANSLATION", "SUMMARY", "KEY POINTS", "CORRECTIONS", "SENTIMENTS"]) assert.match(english, new RegExp(heading));
  assert.match(english, /confidence percentage/);
  assert.match(english, /<SOURCE_TEXT>\nDas ist gut\.\n<\/SOURCE_TEXT>/);
  assert.match(english, /<EDITED_ANALYSIS>/);
  assert.ok(original.length < 1_000);
});

test("application composes stable top-level sections and removes model duplicates", () => {
  assert.equal(
    composeTextTreatment("ORIGINAL LANGUAGE:\nCORRECTED TEXT\nBonjour.", "## ENGLISH\nTRANSLATION\nHello."),
    "ORIGINAL LANGUAGE\nCORRECTED TEXT\nBonjour.\n\nENGLISH\nTRANSLATION\nHello.",
  );
});

test("provides German and French examples within the input limit", () => {
  assert.match(TEXT_EXAMPLES.de, /Letzte Woche/);
  assert.match(TEXT_EXAMPLES.fr, /Notre équipe/);
  assert.ok(Object.values(TEXT_EXAMPLES).every((example) => example.length <= MAX_TEXT_LENGTH));
  assert.equal(MAX_TREATMENT_TOKENS, MAX_ORIGINAL_TREATMENT_TOKENS + MAX_ENGLISH_TREATMENT_TOKENS);
  assert.ok(MAX_ORIGINAL_TREATMENT_TOKENS > 48);
  assert.ok(MAX_ENGLISH_TREATMENT_TOKENS > MAX_ORIGINAL_TREATMENT_TOKENS);
});
