import assert from "node:assert/strict";
import test from "node:test";
import { cleanGeneratedQuery, createSearchQuery } from "../src/searchQuery.ts";

test("replaces a repeated request with a deterministic GitHub query", () => {
  const request = "Open security bugs created this month with more than 5 comments";
  const repeated = `${request}. Example: ${request}. Example: ${request}`;

  assert.equal(
    createSearchQuery("GitHub", request, repeated, new Date("2026-09-27T12:00:00Z")),
    "is:issue is:open label:security label:bug created:>=2026-09-01 comments:>5",
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

test("uses GitLab qualifiers in its fallback", () => {
  assert.equal(
    createSearchQuery("GitLab", "Open security bugs with no assignee", "I cannot help with that."),
    "type:issue state:opened label:security label:bug assignee:none",
  );
});
