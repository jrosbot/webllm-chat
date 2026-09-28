export type SearchPlatform = "GitHub" | "GitLab";

// Keeps even unusually token-dense input comfortably within the smallest
// supported models' context alongside the system prompt and generated answer.
export const MAX_REQUEST_LENGTH = 1_000;
// Search filters are short. Keeping this bound tight prevents a confused small
// model from spending seconds producing explanations that are discarded.
export const MAX_GENERATED_TOKENS = 48;

/**
 * Syntax accepted by the two products. GitLab does not understand GitHub-style
 * `key:value` qualifiers: its issue API/list uses URL query parameters instead.
 */
export const SEARCH_OPERATORS: Record<SearchPlatform, readonly string[]> = {
  GitHub: [
    "type:issue (or is:issue)", "state:open | state:closed", "reason:completed | reason:\"not planned\"",
    "author:USER", "assignee:USER", "mentions:USER", "commenter:USER", "involves:USER",
    "label:LABEL", "milestone:NAME", "repo:OWNER/REPO", "org:ORG", "user:OWNER",
    "in:title | in:body | in:comments", "language:LANGUAGE", "comments:N", "interactions:N", "reactions:N",
    "created:DATE", "updated:DATE", "closed:DATE", "archived:true | archived:false",
    "is:locked | is:unlocked", "no:label | no:milestone | no:assignee | no:project",
  ],
  GitLab: [
    "state=opened | closed | all", "scope=assigned_to_me | created_by_me | all",
    "assignee_username=USER", "assignee_id=None | Any", "author_username=USER",
    "labels=LABEL1,LABEL2", "milestone=NAME", "milestone_id=None | Any", "issue_type=issue | incident | task",
    "search=TEXT", "in=title | description | title,description", "confidential=true | false",
    "created_after=ISO_DATE", "created_before=ISO_DATE", "updated_after=ISO_DATE", "updated_before=ISO_DATE",
    "due_date=today | tomorrow | overdue | week | month | 0 | any", "my_reaction_emoji=EMOJI",
    "weight=N | None | Any", "not[labels]=LABEL", "order_by=created_at | updated_at | due_date", "sort=asc | desc",
  ],
};

const SEARCH_PROMPTS: Record<SearchPlatform, string> = {
  GitHub: `You translate a plain-language request into exactly one GitHub issue search query.

Allowed qualifiers only: type:issue, state:open|closed, reason:completed|"not planned", author:USER, assignee:USER, mentions:USER, commenter:USER, involves:USER, label:LABEL, milestone:NAME, repo:OWNER/REPO, org:ORG, user:OWNER, in:title|body|comments, language:LANGUAGE, comments:N, interactions:N, reactions:N, created:DATE, updated:DATE, closed:DATE, archived:true|false, is:locked|unlocked, no:label|milestone|assignee|project.

Always include type:issue. A programming language is language:LANGUAGE: for example, TypeScript becomes language:TypeScript, never a label or a free-text term. Use label: only when the request describes an issue label such as bug, documentation, security, or "good first issue". Keep other genuine search words as free text.
Use @me for the current user. Quote multi-word qualifier values. N accepts comparisons such as >5. DATE accepts YYYY-MM-DD, <, <=, >, >=, and ranges such as 2026-01-01..2026-01-31.

Return only the query, without a label or explanation.

Examples:
Request: Good first issues in TypeScript repositories with no assignee
Query: type:issue label:"good first issue" language:TypeScript no:assignee
Request: Security issues with more than 5 comments
Query: type:issue label:security comments:>5
Request: Open bugs created this month
Query: type:issue state:open label:bug created:>=FIRST_DAY_OF_CURRENT_MONTH

Never invent a username, repository, label, milestone, or date.`,
  GitLab: `Convert the request into one GitLab issue filter encoded as URL query parameters (key=value&key=value), not GitHub key:value syntax.
Use only documented GitLab issue parameters: state=opened|closed|all, scope=assigned_to_me|created_by_me|all, assignee_username=, assignee_id=None|Any, author_username=, labels=comma-separated labels, milestone=, milestone_id=None|Any, issue_type=issue|incident|task, search=, in=title|description|title,description, confidential=true|false, created_after=, created_before=, updated_after=, updated_before=, due_date=, my_reaction_emoji=, weight=, order_by=, sort=.
Always add issue_type=issue. Use scope=assigned_to_me for issues assigned to me and assignee_id=None for unassigned. Dates must be ISO 8601; use FIRST_DAY_OF_CURRENT_MONTH when requested. Percent-encode spaces in values. GitLab has no comments-count filter.

Return only the parameters. Do not include ?, a URL, a label, or an explanation.

Examples:
Request: Open bugs assigned to me
Query: issue_type=issue&state=opened&labels=bug&scope=assigned_to_me
Request: Good first issues with no assignee
Query: issue_type=issue&labels=good%20first%20issue&assignee_id=None
Request: Closed security issues
Query: issue_type=issue&state=closed&search=security

Never invent a username, project, label, milestone, or date.`,
};

export function createSearchPrompt(platform: SearchPlatform): string {
  return SEARCH_PROMPTS[platform];
}
