import type { SearchPlatform } from "./searchPrompt";

const RESPONSE_PREFIX = /^(?:query|final|answer)\s*:\s*/i;
const TRAILING_CHAT = /\s+(?:example|request|draft|explanation|query|final|answer)\s*:.*/i;

function firstDayOfMonth(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function firstDayOfMonthIso(now: Date): string {
  return `${firstDayOfMonth(now)}T00:00:00Z`;
}

/** Removes chatty model output while preserving quoted, space-containing labels. */
export function cleanGeneratedQuery(output: string): string {
  return output
    .replace(/```(?:text)?/gi, "")
    .trim()
    .split(/\r?\n/, 1)[0]
    .replace(RESPONSE_PREFIX, "")
    .replace(TRAILING_CHAT, "")
    .replace(/^`+|`+$/g, "")
    .trim();
}

function fallbackQuery(platform: SearchPlatform, request: string, now: Date): string {
  const text = request.toLowerCase();
  const filters: string[] = [];
  const github = platform === "GitHub";

  filters.push(github ? "type:issue" : "issue_type=issue");
  if (/\bopen(?:ed)?\b/.test(text)) filters.push(github ? "state:open" : "state=opened");
  if (/\bclosed?\b/.test(text)) filters.push(github ? "state:closed" : "state=closed");

  const labels: string[] = [];
  if (/\bsecurity\b/.test(text)) labels.push("security");
  if (/\bbugs?\b/.test(text)) labels.push("bug");
  if (/\bdocumentation\b|\bdocs?\b/.test(text)) labels.push("documentation");
  if (/\baccessibility\b/.test(text)) labels.push("accessibility");
  if (/\bgood first issues?\b/.test(text)) labels.push("good first issue");
  if (github) filters.push(...labels.map((label) => `label:${label.includes(" ") ? `"${label}"` : label}`));
  else if (labels.length) filters.push(`labels=${encodeURIComponent(labels.join(","))}`);

  if (/\b(?:assigned to me|my issues?)\b/.test(text)) filters.push(github ? "assignee:@me" : "scope=assigned_to_me");
  if (/\b(?:no|without an?) assignee\b|\bunassigned\b/.test(text)) {
    filters.push(github ? "no:assignee" : "assignee_id=None");
  }
  if (/\bcreated this month\b/.test(text)) {
    filters.push(github ? `created:>=${firstDayOfMonth(now)}` : `created_after=${encodeURIComponent(firstDayOfMonthIso(now))}`);
  }

  const comments = text.match(/\b(?:more than|over)\s+(\d+)\s+comments?\b/);
  if (comments && github) filters.push(`comments:>${comments[1]}`);

  return filters.join(github ? " " : "&");
}

function isUsableQuery(platform: SearchPlatform, query: string): boolean {
  if (!query || query.length > 500 || /[.!?]\s/.test(query)) return false;
  const qualifier = platform === "GitHub"
    ? /\b(?:type|is|state|label|assignee|repo|created|updated|comments|no):\S/i
    : /^(?:(?:issue_type|state|scope|assignee_username|assignee_id|author_username|labels|milestone|milestone_id|search|in|confidential|created_after|created_before|updated_after|updated_before|due_date|my_reaction_emoji|weight|order_by|sort)=[^&]*(?:&|$))+$/i;
  return qualifier.test(query);
}

/** Returns a concise query, falling back to deterministic parsing when a small model rambles. */
export function createSearchQuery(
  platform: SearchPlatform,
  request: string,
  modelOutput: string,
  now = new Date(),
): string {
  const monthStart = platform === "GitHub" ? firstDayOfMonth(now) : encodeURIComponent(firstDayOfMonthIso(now));
  const cleaned = cleanGeneratedQuery(modelOutput).replaceAll("FIRST_DAY_OF_CURRENT_MONTH", monthStart);
  if (isUsableQuery(platform, cleaned)) return cleaned;

  const fallback = fallbackQuery(platform, request, now);
  return fallback || cleaned;
}

/** Builds a working product URL from the platform-specific generated syntax. */
export function createSearchUrl(platform: SearchPlatform, query: string): string {
  if (platform === "GitHub") return `https://github.com/issues?q=${encodeURIComponent(query)}`;
  const defaultScope = /(?:^|&)scope=/.test(query) ? "" : "scope=all&";
  return `https://gitlab.com/dashboard/issues?${defaultScope}${query}`;
}
