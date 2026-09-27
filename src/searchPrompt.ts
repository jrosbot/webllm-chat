export type SearchPlatform = "GitHub" | "GitLab";

// Keeps even unusually token-dense input comfortably within the smallest
// supported models' context alongside the system prompt and generated answer.
export const MAX_REQUEST_LENGTH = 1_000;

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

const TWO_STEP_PROMPTS: Record<SearchPlatform, string> = {
  GitHub: `Convert the request into one GitHub issue search query.
Use only documented GitHub issue qualifiers. Always add type:issue. Useful qualifiers: state:open|closed, reason:completed|"not planned", author:, assignee:, mentions:, commenter:, involves:, label:, milestone:, repo:, org:, user:, in:title|body|comments, language:, comments:, interactions:, reactions:, created:, updated:, closed:, archived:true|false, is:locked|unlocked, no:label|milestone|assignee|project.
Use @me for the current user. Quote values containing spaces. Dates support <, <=, >, >= and ranges. Keep genuine free-text terms; do not turn every noun into a label.

Work in two steps in this single response:
Draft: make the best initial query.
Final: check the draft against the request and allowed syntax, then correct it.
Return exactly these two labeled lines and nothing else.

Examples:
Request: Open bugs assigned to me
Draft: type:issue state:open label:bug assignee:@me
Final: type:issue state:open label:bug assignee:@me
Request: Good first issues with no assignee
Draft: type:issue label:"good first issue" assignee:none
Final: type:issue label:"good first issue" no:assignee
Request: Security issues with more than 5 comments
Draft: type:issue security comments:>5
Final: type:issue security comments:>5
Request: Open bugs created this month
Draft: type:issue state:open label:bug created:>=FIRST_DAY_OF_CURRENT_MONTH
Final: type:issue state:open label:bug created:>=FIRST_DAY_OF_CURRENT_MONTH

Never invent a username, repository, label, milestone, or date. Do not explain either line.`,
  GitLab: `Convert the request into one GitLab issue filter encoded as URL query parameters (key=value&key=value), not GitHub key:value syntax.
Use only documented GitLab issue parameters: state=opened|closed|all, scope=assigned_to_me|created_by_me|all, assignee_username=, assignee_id=None|Any, author_username=, labels=comma-separated labels, milestone=, milestone_id=None|Any, issue_type=issue|incident|task, search=, in=title|description|title,description, confidential=true|false, created_after=, created_before=, updated_after=, updated_before=, due_date=, my_reaction_emoji=, weight=, order_by=, sort=.
Always add issue_type=issue. Use scope=assigned_to_me for issues assigned to me and assignee_id=None for unassigned. Dates must be ISO 8601; use FIRST_DAY_OF_CURRENT_MONTH when requested. Percent-encode spaces in values. GitLab has no comments-count filter.

Work in two steps in this single response:
Draft: make the best initial parameter line.
Final: check the draft against the request and allowed syntax, then correct it.
Return exactly these two labeled lines and nothing else. Neither line may contain ? or a URL.

Examples:
Request: Open bugs assigned to me
Draft: issue_type=issue&state=opened&labels=bug&scope=assigned_to_me
Final: issue_type=issue&state=opened&labels=bug&scope=assigned_to_me
Request: Good first issues with no assignee
Draft: issue_type=issue&labels=good%20first%20issue&assignee_username=None
Final: issue_type=issue&labels=good%20first%20issue&assignee_id=None
Request: Closed security issues
Draft: issue_type=issue&state=closed&search=security
Final: issue_type=issue&state=closed&search=security

Never invent a username, project, label, milestone, or date. Do not explain either line.`,
};

export function createTwoStepPrompt(platform: SearchPlatform): string {
  return TWO_STEP_PROMPTS[platform];
}
