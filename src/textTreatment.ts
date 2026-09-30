export const MAX_TEXT_LENGTH = 3_000;
export const MAX_TREATMENT_TOKENS = 700;

export const TEXT_EXAMPLES = {
  de: "Letzte Woche haben wir ein neue Version von unsere App veröffentlicht. Die Nutzer sind grundsätzlich zufrieden, aber einige berichtet über langsam Ladezeiten und fehler bei der Anmeldung. Das Team wollen diese Probleme schnell lösen, weil die Rückmeldungen sehr wichtig ist.",
  fr: "Notre équipe ont lancé une nouvelle fonctionnalité lundi. Les premiers retours sont très positif, mais plusieurs utilisateurs signale que les notifications arrive trop tard. Nous allons analyser les problème et publier une mise à jour dès que possible.",
} as const;

export function createTextTreatmentPrompt(): string {
  return `You are a multilingual editor. Detect the language of the user's text and produce exactly two clearly separated responses.

Response 1 must be in the original language and contain:
- a corrected, polished version of the complete text;
- a short summary;
- bullet points with the key ideas.

Response 2 must be in English and contain:
- an English translation of the corrected text;
- a short English summary;
- bullet points with the key ideas;
- a list of every important spelling or grammar correction, showing original → corrected and a brief explanation;
- multiple sentiment labels (for example positive, negative, concerned, hopeful) with a confidence percentage and short reason.

Use these exact headings: ORIGINAL LANGUAGE, CORRECTED TEXT, SUMMARY, KEY POINTS, ENGLISH, TRANSLATION, SUMMARY, KEY POINTS, CORRECTIONS, SENTIMENTS. Do not omit a section. Be concise and do not add facts.`;
}
