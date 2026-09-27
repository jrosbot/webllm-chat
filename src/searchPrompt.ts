export type SearchPlatform = "GitHub" | "GitLab";

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

const DRAFT_PROMPTS: Record<SearchPlatform, string> = {
  GitHub: `Convert the request into one GitHub issue search query.
Use only documented GitHub issue qualifiers. Always add type:issue. Useful qualifiers: state:open|closed, reason:completed|"not planned", author:, assignee:, mentions:, commenter:, involves:, label:, milestone:, repo:, org:, user:, in:title|body|comments, language:, comments:, interactions:, reactions:, created:, updated:, closed:, archived:true|false, is:locked|unlocked, no:label|milestone|assignee|project.
Use @me for the current user. Quote values containing spaces. Dates support <, <=, >, >= and ranges. Keep genuine free-text terms; do not turn every noun into a label. Return only one query line.

Examples:
Request: Open bugs assigned to me
Query: type:issue state:open label:bug assignee:@me
Request: Good first issues with no assignee
Query: type:issue label:"good first issue" no:assignee
Request: Security issues with more than 5 comments
Query: type:issue security comments:>5
Request: Open bugs created this month
Query: type:issue state:open label:bug created:>=FIRST_DAY_OF_CURRENT_MONTH

Never invent a username, repository, label, milestone, or date. Never explain the query.`,
  GitLab: `Convert the request into one GitLab issue filter encoded as URL query parameters (key=value&key=value), not GitHub key:value syntax.
Use only documented GitLab issue parameters: state=opened|closed|all, scope=assigned_to_me|created_by_me|all, assignee_username=, assignee_id=None|Any, author_username=, labels=comma-separated labels, milestone=, milestone_id=None|Any, issue_type=issue|incident|task, search=, in=title|description|title,description, confidential=true|false, created_after=, created_before=, updated_after=, updated_before=, due_date=, my_reaction_emoji=, weight=, order_by=, sort=.
Always add issue_type=issue. Use scope=assigned_to_me for issues assigned to me and assignee_id=None for unassigned. Dates must be ISO 8601; use FIRST_DAY_OF_CURRENT_MONTH when requested. Percent-encode spaces in values. GitLab has no comments-count filter. Return only one parameter line without ? or a URL.

Examples:
Request: Open bugs assigned to me
Query: issue_type=issue&state=opened&labels=bug&scope=assigned_to_me
Request: Good first issues with no assignee
Query: issue_type=issue&labels=good%20first%20issue&assignee_id=None
Request: Closed security issues
Query: issue_type=issue&state=closed&search=security

Never invent a username, project, label, milestone, or date. Never explain the filter.`,
};

const REFINEMENT_PROMPTS: Record<SearchPlatform, string> = {
  GitHub: `Correct a draft GitHub issue query to match the request. Output one line only.
Use documented GitHub syntax and type:issue. Valid families: state:, reason:, author:, assignee:, mentions:, commenter:, involves:, label:, milestone:, repo:, org:, user:, in:, language:, comments:, interactions:, reactions:, created:, updated:, closed:, archived:, is:locked|unlocked, no:label|milestone|assignee|project. Use assignee:@me and no:assignee. Quote multi-word values. Keep free text when the request does not explicitly name a label. Remove explanations, URLs, and invented values.

Request: Documentation issues without an assignee
Draft: status:open documentation assignee:none
Final: type:issue documentation no:assignee
Request: Security issues with more than 5 comments
Draft: security comments more than 5
Final: type:issue security comments:>5`,
  GitLab: `Correct a draft into documented GitLab issue URL parameters matching the request. Output one line only, without ? or a URL.
GitLab filters are key=value pairs joined by &, not key:value qualifiers. Use issue_type=issue and only: state, scope, assignee_username, assignee_id, author_username, labels, milestone, milestone_id, search, in, confidential, created_after, created_before, updated_after, updated_before, due_date, my_reaction_emoji, weight, order_by, sort. Use scope=assigned_to_me for me and assignee_id=None for unassigned. Percent-encode values. Do not create unsupported comment-count or project parameters. Put unmatched text in search=. Remove explanations and invented values.

Request: Documentation issues without an assignee
Draft: type:issue documentation no:assignee
Final: issue_type=issue&search=documentation&assignee_id=None
Request: Closed security issues
Draft: type:issue state:closed label:security
Final: issue_type=issue&state=closed&search=security`,
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
