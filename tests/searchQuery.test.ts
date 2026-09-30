import assert from "node:assert/strict";
import test from "node:test";
import { cleanGeneratedQuery, createSearchQuery, createSearchUrl } from "../src/searchQuery.ts";
import { createSearchPrompt, MAX_GENERATED_TOKENS, MAX_REQUEST_LENGTH } from "../src/searchPrompt.ts";

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

test("preserves language and stale-date requirements in the GitHub fallback", () => {
  assert.equal(
    createSearchQuery(
      "GitHub",
      "Documentation issues assigned to me in TypeScript repositories that have not been updated in 30 days",
      "Here is the query you requested.",
      new Date("2026-03-15T12:00:00Z"),
    ),
    'type:issue label:documentation assignee:@me updated:<2026-02-13 language:TypeScript',
  );
});

test("uses an ISO timestamp for stale GitLab issues", () => {
  assert.equal(
    createSearchQuery(
      "GitLab",
      "Open issues stale for 7 days",
      "not a filter",
      new Date("2026-01-03T12:00:00Z"),
    ),
    "issue_type=issue&state=opened&updated_before=2025-12-27T00%3A00%3A00Z",
  );
});

test("prompts distinguish GitHub qualifiers from GitLab parameters", () => {
  assert.match(createSearchPrompt("GitHub"), /comments:/);
  assert.match(createSearchPrompt("GitLab"), /URL query parameters/);
  assert.doesNotMatch(createSearchPrompt("GitLab"), /type:issue/);
  assert.match(createSearchPrompt("GitHub"), /Return only the query/i);
});

test("GitHub prompt teaches the complete qualifier vocabulary and language mapping", () => {
  const prompt = createSearchPrompt("GitHub");
  const qualifierFamilies = [
    "type:issue", "state:open|closed", "reason:completed", "author:USER", "assignee:USER",
    "mentions:USER", "commenter:USER", "involves:USER", "label:LABEL", "milestone:NAME",
    "repo:OWNER/REPO", "org:ORG", "user:OWNER", "in:title|body|comments", "language:LANGUAGE",
    "comments:N", "interactions:N", "reactions:N", "created:DATE", "updated:DATE", "closed:DATE",
    "archived:true|false", "is:locked|unlocked", "no:label|milestone|assignee|project",
  ];

  for (const qualifier of qualifierFamilies) assert.ok(prompt.includes(qualifier), `missing ${qualifier}`);
  assert.match(prompt, /TypeScript becomes language:TypeScript/);
  assert.match(prompt, /Query: type:issue label:"good first issue" language:TypeScript no:assignee/);
});

test("prompts demonstrate the expected concise output format", () => {
  for (const platform of ["GitHub", "GitLab"] as const) {
    const prompt = createSearchPrompt(platform);
    assert.ok((prompt.match(/^Request:/gm) ?? []).length >= 3);
    assert.equal((prompt.match(/^Query:/gm) ?? []).length, (prompt.match(/^Request:/gm) ?? []).length);
    assert.doesNotMatch(prompt, /^Draft:|^Final:/gm);
  }
});

test("request and generation limits keep local inference small", () => {
  assert.equal(MAX_REQUEST_LENGTH, 1_000);
  assert.equal(MAX_GENERATED_TOKENS, 48);
  assert.ok(createSearchPrompt("GitHub").length < 2_000);
  assert.ok(createSearchPrompt("GitLab").length < 2_000);
});
