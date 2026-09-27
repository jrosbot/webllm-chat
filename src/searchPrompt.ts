export type SearchPlatform = "GitHub" | "GitLab";

const COMMON_RULES = `
Return a single issue-search query, not a sentence.
- Preserve useful free-text terms from the request and quote multi-word values.
- Add a facet only when the request supplies its value; do not guess repositories, users, labels, dates, or states.
- Use each platform's exact facet name and value syntax. Never invent a facet.
- Resolve “me”, “my”, and “assigned to me” to @me.
- Output exactly one line containing only the query: no Markdown, commentary, surrounding quotation marks, or URL.`;

const PLATFORM_GUIDANCE: Record<SearchPlatform, string> = {
  GitHub: `You convert a natural-language request into one valid GitHub Issues search query.

Allowed GitHub facets:
- kind/status: is:issue, is:pr, is:open, is:closed, state:open, state:closed, draft:true|false
- people: author:, assignee:, mentions:, commenter:, involves:, review-requested:, reviewed-by:
- classification: label:, milestone:, project:, type:, reason:, linked:pr
- location/text: repo:OWNER/REPO, org:, user:, in:title|body|comments
- activity: created:, updated:, closed:, merged:, comments:, interactions:, reactions:
- missing metadata: no:assignee|label|milestone|project
Dates and numeric facets may use >, >=, <, <=, or ranges (for example, updated:>=2025-01-01 and comments:>10). Negate a facet with a leading hyphen when requested.
GitHub does not have status:, assigned:, or title: facets: translate them to state:/is:, assignee:, and in:title respectively.`,
  GitLab: `You convert a natural-language request into one valid GitLab issue search query.

Allowed GitLab facets:
- kind/status: type:issue, type:incident, state:opened, state:closed
- people: author:, assignee:
- classification: label:, milestone:
- location/text: project:, group:, in:title|description
- activity: created_after:, created_before:, updated_after:, updated_before:
Use opened (not open) for an open GitLab issue. Use none as the value when explicitly searching for an unassigned issue or one without a label or milestone.
GitLab does not have status:, assigned:, or title: facets: translate them to state:, assignee:, and in:title respectively.`,
};

export function createSearchPrompt(platform: SearchPlatform): string {
  return `${PLATFORM_GUIDANCE[platform]}\n${COMMON_RULES}`;
}
