import assert from "node:assert/strict";
import test from "node:test";
import { cleanGeneratedQuery, createSearchQuery, createSearchUrl } from "../src/searchQuery.ts";
import { createDraftPrompt } from "../src/searchPrompt.ts";

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
  assert.match(createDraftPrompt("GitHub"), /comments:/);
  assert.match(createDraftPrompt("GitLab"), /URL query parameters/);
  assert.doesNotMatch(createDraftPrompt("GitLab"), /type:issue/);
});
