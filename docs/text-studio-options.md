# Text Studio: implementation options and decision

## Context and criteria

The original implementation asked one local model invocation to detect a language, correct the complete source, summarize it twice, translate it, extract key points twice, explain corrections, and classify several sentiments. That is a wide instruction set for the standard 20M-parameter CPU model. A successful response also depended entirely on the model remembering ten headings.

The options were assessed against five criteria: output completeness, quality on small local models, latency, download/hardware cost, and implementation/maintenance risk. Scores range from 1 (poor) to 5 (strong); **quality and completeness are the priority**.

| Option | Approach | Completeness | Small-model quality | Speed | Hardware/download | Simplicity | Weighted view |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | Keep one call; rewrite the prompt with delimiters and stricter headings | 3 | 2 | 5 | 5 | 5 | Fast and cheap, but one overloaded generation remains fragile. |
| 2 | Make a larger model (1.5B–3B) mandatory/default for Text Studio | 4 | 5 | 3 | 1 | 4 | Strongest raw generation, but excludes CPU-only/low-memory devices and adds a large first download. |
| 3 | Run independent calls for every section and assemble them in code | 5 | 4 | 1 | 4 | 2 | Very reliable structure, but eight or more generations make local use unacceptably slow. |
| 4 | Two focused passes: source-language editing, then translation and English analysis | 3 | 3 | 3 | 5 | 4 | The combined translation/analysis pass can cause smaller models to repeat summaries instead of translating. |
| **5** | **Three focused passes: correction, translation, then combined analysis; assemble the result in code** | **5** | **5** | **2** | **5** | **4** | **Best reliability: translation has no competing instructions and each analysis appears only once.** |

## Decision

Implement **option 5**. The first pass only corrects the source-language text. The second receives only the corrected text and performs only the English translation. The third receives the source, correction, and translation in explicit XML-style delimiters, then produces one English summary, one set of key points, corrections, and sentiments. The application—not the model—adds the `ORIGINAL LANGUAGE`, `CORRECTED TEXT`, `ENGLISH`, and `TRANSLATION` boundaries, preventing a weak model from losing the overall response shape.

This keeps all processing local and preserves the user's selected model. It costs two extra inferences compared with the original one-call design, but avoids imposing a several-hundred-megabyte or multi-gigabyte model download. Separate token budgets keep each generation bounded. More importantly, an imperfect correction cannot make the translation prompt mistake a summary for the source: the translation receives one plain text input and one instruction.

## Why the alternatives were not selected

- **Option 1** is a useful prompt cleanup but does not reduce the number of reasoning tasks competing inside one generation.
- **Option 2** should remain an opt-in quality upgrade. Model capability helps, but making it mandatory conflicts with browser compatibility and local-first accessibility.
- **Option 3** is the most structurally deterministic, but its latency grows with every requested section and is especially painful on CPU/WASM.
- **Option 4** still overloads its second pass. In testing with smaller models, that pass could emit the first pass's summary in place of the translation and repeat the same key point under unrelated headings.

## Validation and follow-up

Unit tests verify the contract of each pass, delimited context, token allocation, and deterministic assembly. The existing browser model benchmark still exercises the complete Text Studio action. For an empirical model comparison, run it on representative WebGPU and CPU devices and compare section-level correctness, not merely non-empty output; that deeper scoring is the logical next benchmark improvement.
