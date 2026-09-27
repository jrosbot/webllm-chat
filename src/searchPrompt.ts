export type SearchPlatform = "GitHub" | "GitLab";

const DRAFT_PROMPTS: Record<SearchPlatform, string> = {
  GitHub: `Convert the request into one GitHub Issues search query.
Use only words from the request and these filters: is:issue, is:open, is:closed, assignee:, label:, repo:, created:, updated:, comments:, no:assignee.
Use assignee:@me for "me". Quote multi-word labels. Return only the query on one line.

Examples:
Request: Open bugs assigned to me
Query: is:issue is:open label:bug assignee:@me
Request: Good first issues with no assignee
Query: is:issue label:"good first issue" no:assignee
Request: Security issues with more than 5 comments
Query: is:issue label:security comments:>5
Request: Open security bugs created this month with more than 5 comments
Query: is:issue is:open label:security label:bug created:>=FIRST_DAY_OF_CURRENT_MONTH comments:>5

Never repeat the request or the examples. Stop immediately after the query.`,
  GitLab: `Convert the request into one GitLab issue search query.
Use only words from the request and these filters: type:issue, state:opened, state:closed, assignee:, label:, project:, created_after:, created_before:, updated_after:, updated_before:.
Use assignee:@me for "me" and assignee:none for no assignee. Quote multi-word labels. Return only the query on one line.

Examples:
Request: Open bugs assigned to me
Query: type:issue state:opened label:bug assignee:@me
Request: Good first issues with no assignee
Query: type:issue label:"good first issue" assignee:none
Request: Closed security issues
Query: type:issue state:closed label:security

Never repeat the request or the examples. Stop immediately after the query.`,
};

const REFINEMENT_PROMPTS: Record<SearchPlatform, string> = {
  GitHub: `Improve a draft GitHub Issues search query so it matches the original request.
The final query must use valid GitHub syntax. Keep requested search words. Remove explanations, Markdown, URLs, invented values, and invalid filters.
Use is:issue for issues, is:open or is:closed for state, assignee:@me for me, no:assignee for unassigned, label:"multi word", and comparisons such as comments:>5 or updated:<2026-01-01.
Return only the improved query on one line.

Examples:
Request: Open accessibility bugs assigned to me
Draft: status:open accessibility assigned:me
Final: is:issue is:open label:accessibility assignee:@me
Request: Documentation issues without an assignee
Draft: is:issue documentation assignee:none
Final: is:issue label:documentation no:assignee
Request: Security issues with more than 5 comments
Draft: security comments more than 5
Final: is:issue label:security comments:>5
Request: Open security bugs created this month with more than 5 comments
Draft: Open security bugs created this month with more than 5 comments. Example: Open security bugs created this month with more than 5 comments
Final: is:issue is:open label:security label:bug created:>=FIRST_DAY_OF_CURRENT_MONTH comments:>5

Never repeat the request, draft, or examples. Stop immediately after the query.`,
  GitLab: `Improve a draft GitLab issue search query so it matches the original request.
The final query must use valid GitLab syntax. Keep requested search words. Remove explanations, Markdown, URLs, invented values, and invalid filters.
Use type:issue for issues, state:opened or state:closed for state, assignee:@me for me, assignee:none for unassigned, label:"multi word", and explicit date filters such as updated_before:2026-01-01.
Return only the improved query on one line.

Examples:
Request: Open accessibility bugs assigned to me
Draft: status:open accessibility assigned:me
Final: type:issue state:opened label:accessibility assignee:@me
Request: Documentation issues without an assignee
Draft: type:issue documentation no:assignee
Final: type:issue label:documentation assignee:none
Request: Closed security issues
Draft: type:issue state:closed security
Final: type:issue state:closed label:security

Never repeat the request, draft, or examples. Stop immediately after the query.`,
};

export function createDraftPrompt(platform: SearchPlatform): string {
  return DRAFT_PROMPTS[platform];
}

export function createRefinementPrompt(platform: SearchPlatform): string {
  return REFINEMENT_PROMPTS[platform];
}

export function createRefinementRequest(request: string, draft: string): string {
  return `Request: ${request}\nDraft: ${draft}\nFinal:`;
}
