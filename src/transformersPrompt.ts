export type TransformersPromptStyle = "chat" | "completion" | "gemma";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

/**
 * Builds the input passed to the Transformers.js text-generation pipeline.
 *
 * Most instruction models publish a tokenizer chat template and can receive
 * messages directly. The Gemma 3 270M ONNX tokenizer does not, so its turn
 * markers must be supplied as plain text instead of asking Transformers.js to
 * call `apply_chat_template()`.
 */
export function createTransformersInput(
  style: TransformersPromptStyle | undefined,
  systemPrompt: string,
  request: string,
): string | ChatMessage[] {
  if (style === "completion") return `${systemPrompt}\nRequest: ${request}\nQuery:`;

  if (style === "gemma") {
    return `<start_of_turn>user\n${systemPrompt}\n\nRequest: ${request}<end_of_turn>\n<start_of_turn>model\n`;
  }

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: request },
  ];
}
