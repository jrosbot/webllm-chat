export const MAX_TEXT_LENGTH = 3_000;
export const MAX_CORRECTION_TOKENS = 900;
export const MAX_TRANSLATION_TOKENS = 900;
export const MAX_ANALYSIS_TOKENS = 520;
export const MAX_TREATMENT_TOKENS = MAX_CORRECTION_TOKENS + MAX_TRANSLATION_TOKENS + MAX_ANALYSIS_TOKENS;

export const TEXT_EXAMPLES = {
  de: "Letzte Woche haben wir ein neue Version von unsere App veröffentlicht. Die Nutzer sind grundsätzlich zufrieden, aber einige berichtet über langsam Ladezeiten und fehler bei der Anmeldung. Das Team wollen diese Probleme schnell lösen, weil die Rückmeldungen sehr wichtig ist.",
  fr: "Notre équipe ont lancé une nouvelle fonctionnalité lundi. Les premiers retours sont très positif, mais plusieurs utilisateurs signale que les notifications arrive trop tard. Nous allons analyser les problème et publier une mise à jour dès que possible.",
} as const;

const ANALYSIS_HEADINGS = ["SUMMARY", "KEY POINTS", "CORRECTIONS", "SENTIMENTS"] as const;

export function createCorrectionPrompt(): string {
  return `You are a precise multilingual copy editor. Correct the spelling and grammar of the user's complete text while preserving its language, meaning, facts, and tone.

Return only the corrected text. Do not summarize, translate, explain, add a heading, or answer the text. Preserve every sentence and do not add facts.`;
}

export function createTranslationPrompt(): string {
  return `You are a precise professional translator. Translate the user's complete text into natural English while preserving its meaning, facts, and tone.

Return only the English translation. Do not summarize, analyze, explain, add a heading, repeat the source text, or answer the text. Preserve every sentence and do not add facts.`;
}

export function createAnalysisPrompt(source: string, corrected: string, translation: string): string {
  return `You are a precise text analyst. Analyze the three delimited versions below. Write only in English.

Return only these sections, in this exact order. Put every heading alone on a line, exactly as written:
${ANALYSIS_HEADINGS.join("\n")}

Under SUMMARY, give a concise summary of the text. Under KEY POINTS, use hyphen bullets for the main ideas. Under CORRECTIONS, list important changes from SOURCE_TEXT to CORRECTED_TEXT as original → corrected, with a brief reason; do not confuse summaries with corrections. Under SENTIMENTS, give applicable sentiment labels with a confidence percentage and a brief reason. Do not rename, repeat, or omit headings. Do not use Markdown heading markers. Do not translate the text again or add facts.

<SOURCE_TEXT>
${source}
</SOURCE_TEXT>
<CORRECTED_TEXT>
${corrected}
</CORRECTED_TEXT>
<ENGLISH_TRANSLATION>
${translation}
</ENGLISH_TRANSLATION>`;
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

export function composeTextTreatment(corrected: string, translation: string, analysis: string): string {
  return `ORIGINAL LANGUAGE\nCORRECTED TEXT\n${removeOuterHeading(corrected, "CORRECTED TEXT")}\n\nENGLISH\nTRANSLATION\n${removeOuterHeading(translation, "TRANSLATION")}\n\n${removeOuterHeading(analysis, "ENGLISH")}`;
}

/** Compatibility helper for consumers that only need the source-language editing pass. */
export function createTextTreatmentPrompt(): string {
  return createCorrectionPrompt();
}
