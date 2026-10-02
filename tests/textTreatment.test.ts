import assert from "node:assert/strict";
import test from "node:test";
import {
  composeTextTreatment,
  createAnalysisPrompt,
  createCorrectionPrompt,
  createTranslationPrompt,
  MAX_ANALYSIS_TOKENS,
  MAX_CORRECTION_TOKENS,
  MAX_TEXT_LENGTH,
  MAX_TRANSLATION_TOKENS,
  MAX_TREATMENT_TOKENS,
  TEXT_EXAMPLES,
} from "../src/textTreatment.ts";

test("text treatment gives correction and translation their own focused prompts", () => {
  const correction = createCorrectionPrompt();
  const translation = createTranslationPrompt();
  assert.match(correction, /only the corrected text/i);
  assert.match(correction, /Do not summarize, translate, explain/i);
  assert.match(translation, /only the English translation/i);
  assert.match(translation, /Do not summarize, analyze, explain/i);
  assert.doesNotMatch(translation, /SUMMARY|KEY POINTS|CORRECTIONS|SENTIMENTS/);
});

test("analysis receives explicit text versions and requests each analysis once", () => {
  const analysis = createAnalysisPrompt("Das ist gud.", "Das ist gut.", "That is good.");
  for (const heading of ["SUMMARY", "KEY POINTS", "CORRECTIONS", "SENTIMENTS"]) {
    assert.equal(analysis.match(new RegExp(`^${heading}$`, "gm"))?.length, 1);
  }
  assert.match(analysis, /confidence percentage/);
  assert.match(analysis, /<SOURCE_TEXT>\nDas ist gud\.\n<\/SOURCE_TEXT>/);
  assert.match(analysis, /<CORRECTED_TEXT>\nDas ist gut\.\n<\/CORRECTED_TEXT>/);
  assert.match(analysis, /<ENGLISH_TRANSLATION>\nThat is good\.\n<\/ENGLISH_TRANSLATION>/);
});

test("application composes stable sections and removes model-added headings", () => {
  assert.equal(
    composeTextTreatment("CORRECTED TEXT:\nDas ist gut.", "## TRANSLATION\nThat is good.", "SUMMARY\nPositive statement."),
    "ORIGINAL LANGUAGE\nCORRECTED TEXT\nDas ist gut.\n\nENGLISH\nTRANSLATION\nThat is good.\n\nSUMMARY\nPositive statement.",
  );
});

test("provides German and French examples within the input limit", () => {
  assert.match(TEXT_EXAMPLES.de, /Letzte Woche/);
  assert.match(TEXT_EXAMPLES.fr, /Notre équipe/);
  assert.ok(Object.values(TEXT_EXAMPLES).every((example) => example.length <= MAX_TEXT_LENGTH));
  assert.equal(MAX_TREATMENT_TOKENS, MAX_CORRECTION_TOKENS + MAX_TRANSLATION_TOKENS + MAX_ANALYSIS_TOKENS);
  assert.ok(MAX_CORRECTION_TOKENS > 48);
  assert.ok(MAX_TRANSLATION_TOKENS > 48);
  assert.ok(MAX_ANALYSIS_TOKENS > 48);
});
