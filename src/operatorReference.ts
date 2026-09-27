import { SEARCH_OPERATORS, type SearchPlatform } from "./searchPrompt";

export function renderOperatorReference(platform: SearchPlatform): string {
  const syntax = platform === "GitHub" ? "qualifiers" : "URL parameters";
  return `
    <span class="operator-reference-title">${platform} ${syntax}</span>
    <div class="operator-list">
      ${SEARCH_OPERATORS[platform].map((operator) => `<code>${operator}</code>`).join("")}
    </div>`;
}
