import type { SearchPlatform } from "./searchPrompt";

const RESPONSE_PREFIX = /^(?:query|final|answer)\s*:\s*/i;
const TRAILING_CHAT = /\s+(?:example|request|draft|explanation|query|final|answer)\s*:.*/i;

function firstDayOfMonth(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
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

  if (/\b(?:issue|issues|bug|bugs)\b/.test(text)) filters.push(github ? "is:issue" : "type:issue");
  if (/\bopen(?:ed)?\b/.test(text)) filters.push(github ? "is:open" : "state:opened");
  if (/\bclosed?\b/.test(text)) filters.push(github ? "is:closed" : "state:closed");

  const labels: string[] = [];
  if (/\bsecurity\b/.test(text)) labels.push("security");
  if (/\bbugs?\b/.test(text)) labels.push("bug");
  if (/\bdocumentation\b|\bdocs?\b/.test(text)) labels.push("documentation");
  if (/\baccessibility\b/.test(text)) labels.push("accessibility");
  if (/\bgood first issues?\b/.test(text)) labels.push("good first issue");
  filters.push(...labels.map((label) => `label:${label.includes(" ") ? `"${label}"` : label}`));

  if (/\b(?:assigned to me|my issues?)\b/.test(text)) filters.push("assignee:@me");
  if (/\b(?:no|without an?) assignee\b|\bunassigned\b/.test(text)) {
    filters.push(github ? "no:assignee" : "assignee:none");
  }
  if (/\bcreated this month\b/.test(text)) {
    filters.push(github ? `created:>=${firstDayOfMonth(now)}` : `created_after:${firstDayOfMonth(now)}`);
  }

  const comments = text.match(/\b(?:more than|over)\s+(\d+)\s+comments?\b/);
  if (comments && github) filters.push(`comments:>${comments[1]}`);

  return filters.join(" ");
}

function isUsableQuery(platform: SearchPlatform, query: string): boolean {
  if (!query || query.length > 500 || /[.!?]\s/.test(query)) return false;
  const qualifier = platform === "GitHub"
    ? /\b(?:is|label|assignee|repo|created|updated|comments|no):\S/i
    : /\b(?:type|state|label|assignee|project|created_after|created_before|updated_after|updated_before):\S/i;
  return qualifier.test(query);
}

/** Returns a concise query, falling back to deterministic parsing when a small model rambles. */
export function createSearchQuery(
  platform: SearchPlatform,
  request: string,
  modelOutput: string,
  now = new Date(),
): string {
  const cleaned = cleanGeneratedQuery(modelOutput).replaceAll("FIRST_DAY_OF_CURRENT_MONTH", firstDayOfMonth(now));
  if (isUsableQuery(platform, cleaned)) return cleaned;

  const fallback = fallbackQuery(platform, request, now);
  return fallback || cleaned;
}
