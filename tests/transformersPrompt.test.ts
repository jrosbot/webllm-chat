import assert from "node:assert/strict";
import test from "node:test";
import { createTransformersInput } from "../src/transformersPrompt.ts";

test("formats Gemma as text when its tokenizer has no chat template", () => {
  assert.equal(
    createTransformersInput("gemma", "Return only a query.", "Open bugs"),
    "<start_of_turn>user\nReturn only a query.\n\nRequest: Open bugs<end_of_turn>\n<start_of_turn>model\n",
  );
});

test("keeps message input for models that provide a chat template", () => {
  assert.deepEqual(createTransformersInput("chat", "System prompt", "User request"), [
    { role: "system", content: "System prompt" },
    { role: "user", content: "User request" },
  ]);
});

test("formats completion-only models without chat messages", () => {
  assert.equal(
    createTransformersInput("completion", "Return only a query.", "Open bugs"),
    "Return only a query.\nRequest: Open bugs\nQuery:",
  );
});

test("allows non-query completion tasks to use an appropriate output cue", () => {
  assert.equal(
    createTransformersInput("completion", "Edit the text.", "Bonjour", "Response"),
    "Edit the text.\nRequest: Bonjour\nResponse:",
  );
});
