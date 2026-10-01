export const MAX_TEXT_LENGTH = 3_000;
export const MAX_ORIGINAL_TREATMENT_TOKENS = 360;
export const MAX_ENGLISH_TREATMENT_TOKENS = 520;
export const MAX_TREATMENT_TOKENS = MAX_ORIGINAL_TREATMENT_TOKENS + MAX_ENGLISH_TREATMENT_TOKENS;

export const TEXT_EXAMPLES = {
  de: "Letzte Woche haben wir ein neue Version von unsere App veröffentlicht. Die Nutzer sind grundsätzlich zufrieden, aber einige berichtet über langsam Ladezeiten und fehler bei der Anmeldung. Das Team wollen diese Probleme schnell lösen, weil die Rückmeldungen sehr wichtig ist.",
  fr: "Notre équipe ont lancé une nouvelle fonctionnalité lundi. Les premiers retours sont très positif, mais plusieurs utilisateurs signale que les notifications arrive trop tard. Nous allons analyser les problème et publier une mise à jour dès que possible.",
} as const;

const ORIGINAL_HEADINGS = ["CORRECTED TEXT", "SUMMARY", "KEY POINTS"] as const;
const ENGLISH_HEADINGS = ["TRANSLATION", "SUMMARY", "KEY POINTS", "CORRECTIONS", "SENTIMENTS"] as const;

function focusedPrompt(instructions: string, headings: readonly string[]): string {
  return `You are a precise multilingual editor. ${instructions}

Return only the requested sections, in this exact order. Put every heading alone on a line, exactly as written:
${headings.join("\n")}

Do not rename, repeat, or omit headings. Do not use Markdown heading markers. Keep the complete corrected text or translation, but keep summaries, explanations, and reasons concise. Use hyphen bullets. Do not add facts.`;
}

export function createOriginalTreatmentPrompt(): string {
  return focusedPrompt(
    "Detect the language of the user's text. Write every response in that language. Correct and polish the complete text without changing its meaning, then give a short summary and key ideas.",
    ORIGINAL_HEADINGS,
  );
}

export function createEnglishTreatmentPrompt(source: string, originalAnalysis: string): string {
  return `${focusedPrompt(
    "Use the source and edited analysis below. Write every response in English. Translate the corrected text, summarize it, list its key ideas, explain every important spelling or grammar correction as original → corrected, and provide multiple applicable sentiment labels. Each sentiment needs a confidence percentage and a short reason.",
    ENGLISH_HEADINGS,
  )}

<SOURCE_TEXT>
${source}
</SOURCE_TEXT>
<EDITED_ANALYSIS>
${originalAnalysis}
</EDITED_ANALYSIS>`;
}

function removeOuterHeading(output: string, heading: string): string {
  const trimmed = output.trim();
  const firstLineEnd = trimmed.indexOf("\n");
  const firstLine = (firstLineEnd < 0 ? trimmed : trimmed.slice(0, firstLineEnd))
    .replace(/^#{1,6}\s*/, "")
    .replace(/:$/, "")
    .trim()
    .toUpperCase();
  return firstLine === heading ? trimmed.slice(firstLineEnd < 0 ? trimmed.length : firstLineEnd + 1).trim() : trimmed;
}

export function composeTextTreatment(originalAnalysis: string, englishAnalysis: string): string {
  return `ORIGINAL LANGUAGE\n${removeOuterHeading(originalAnalysis, "ORIGINAL LANGUAGE")}\n\nENGLISH\n${removeOuterHeading(englishAnalysis, "ENGLISH")}`;
}

/** Compatibility helper for consumers that only need the source-language pass. */
export function createTextTreatmentPrompt(): string {
  return createOriginalTreatmentPrompt();
}
