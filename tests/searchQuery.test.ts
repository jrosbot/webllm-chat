import assert from "node:assert/strict";
import test from "node:test";
import { cleanGeneratedQuery, createSearchQuery, createSearchUrl } from "../src/searchQuery.ts";
import { createTwoStepPrompt, MAX_REQUEST_LENGTH } from "../src/searchPrompt.ts";

test("replaces a repeated request with a deterministic GitHub query", () => {
  const request = "Open security bugs created this month with more than 5 comments";
  const repeated = `${request}. Example: ${request}. Example: ${request}`;

  assert.equal(
    createSearchQuery("GitHub", request, repeated, new Date("2026-09-27T12:00:00Z")),
    "type:issue state:open label:security label:bug created:>=2026-09-01 comments:>5",
  );
});

test("keeps a valid model query and removes trailing chat", () => {
  assert.equal(
    createSearchQuery("GitHub", "Open security issues", "Final: is:issue is:open label:security\nExplanation: done"),
    "is:issue is:open label:security",
  );
});

test("preserves quoted multi-word labels", () => {
  assert.equal(cleanGeneratedQuery('```text\nQuery: is:issue label:"good first issue"\n```'), 'is:issue label:"good first issue"');
});

test("uses the corrected final line from a single two-step response", () => {
  assert.equal(
    cleanGeneratedQuery("Draft: type:issue status:open security\nFinal: type:issue state:open security"),
    "type:issue state:open security",
  );
});

test("uses GitLab URL parameters in its fallback", () => {
  assert.equal(
    createSearchQuery("GitLab", "Open security bugs with no assignee", "I cannot help with that."),
    "issue_type=issue&state=opened&labels=security%2Cbug&assignee_id=None",
  );
});

test("accepts documented GitLab URL parameters instead of fake colon qualifiers", () => {
  const output = "issue_type=issue&state=opened&labels=security&scope=assigned_to_me";
  assert.equal(createSearchQuery("GitLab", "My open security issues", output), output);
  assert.equal(
    createSearchUrl("GitLab", output),
    `https://gitlab.com/dashboard/issues?${output}`,
  );
});

test("uses ISO 8601 for a GitLab month boundary", () => {
  assert.equal(
    createSearchQuery("GitLab", "Issues created this month", "not a filter", new Date("2026-09-27T12:00:00Z")),
    "issue_type=issue&created_after=2026-09-01T00%3A00%3A00Z",
  );
});

test("prompts distinguish GitHub qualifiers from GitLab parameters", () => {
  assert.match(createTwoStepPrompt("GitHub"), /comments:/);
  assert.match(createTwoStepPrompt("GitLab"), /URL query parameters/);
  assert.doesNotMatch(createTwoStepPrompt("GitLab"), /type:issue/);
  assert.match(createTwoStepPrompt("GitHub"), /two steps in this single response/i);
});

test("two-step prompts demonstrate both the draft and expected final format", () => {
  for (const platform of ["GitHub", "GitLab"] as const) {
    const prompt = createTwoStepPrompt(platform);
    assert.ok((prompt.match(/^Request:/gm) ?? []).length >= 3);
    assert.equal((prompt.match(/^Draft:/gm) ?? []).length, (prompt.match(/^Request:/gm) ?? []).length + 1);
    assert.equal((prompt.match(/^Final:/gm) ?? []).length, (prompt.match(/^Request:/gm) ?? []).length + 1);
  }
});

test("request limit leaves room for prompts and the two-step answer", () => {
  assert.equal(MAX_REQUEST_LENGTH, 1_000);
  assert.ok(createTwoStepPrompt("GitHub").length < 3_000);
  assert.ok(createTwoStepPrompt("GitLab").length < 3_000);
});
