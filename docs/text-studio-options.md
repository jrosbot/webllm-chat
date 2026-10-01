# Text Studio: implementation options and decision

## Context and criteria

The original implementation asked one local model invocation to detect a language, correct the complete source, summarize it twice, translate it, extract key points twice, explain corrections, and classify several sentiments. That is a wide instruction set for the standard 20M-parameter CPU model. A successful response also depended entirely on the model remembering ten headings.

The options were assessed against five criteria: output completeness, quality on small local models, latency, download/hardware cost, and implementation/maintenance risk. Scores range from 1 (poor) to 5 (strong); **quality and completeness are the priority**.

| Option | Approach | Completeness | Small-model quality | Speed | Hardware/download | Simplicity | Weighted view |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | Keep one call; rewrite the prompt with delimiters and stricter headings | 3 | 2 | 5 | 5 | 5 | Fast and cheap, but one overloaded generation remains fragile. |
| 2 | Make a larger model (1.5B–3B) mandatory/default for Text Studio | 4 | 5 | 3 | 1 | 4 | Strongest raw generation, but excludes CPU-only/low-memory devices and adds a large first download. |
| 3 | Run independent calls for every section and assemble them in code | 5 | 4 | 1 | 4 | 2 | Very reliable structure, but eight or more generations make local use unacceptably slow. |
| **4** | **Two focused passes: source-language editing, then English analysis; assemble top-level sections in code** | **5** | **4** | **3** | **5** | **4** | **Best balance: substantially easier instructions without forcing another model or excessive calls.** |

## Decision

Implement **option 4**. The first pass only corrects, summarizes, and extracts key points in the detected source language. The second pass receives both the original source and the edited result in explicit XML-style delimiters, then handles translation, the English summary and key points, corrections, and sentiments. The application—not the model—adds the `ORIGINAL LANGUAGE` and `ENGLISH` boundaries, preventing a weak model from losing the overall response shape.

This keeps all processing local and preserves the user's selected model. It costs one extra inference, but avoids imposing a several-hundred-megabyte or multi-gigabyte model download. Separate token budgets give the translation/correction pass more room while keeping generation bounded.

## Why the alternatives were not selected

- **Option 1** is a useful prompt cleanup but does not reduce the number of reasoning tasks competing inside one generation.
- **Option 2** should remain an opt-in quality upgrade. Model capability helps, but making it mandatory conflicts with browser compatibility and local-first accessibility.
- **Option 3** is the most structurally deterministic, but its latency grows with every requested section and is especially painful on CPU/WASM.

## Validation and follow-up

Unit tests verify the contract of each pass, delimited context, token allocation, and deterministic assembly. The existing browser model benchmark still exercises the complete Text Studio action. For an empirical model comparison, run it on representative WebGPU and CPU devices and compare section-level correctness, not merely non-empty output; that deeper scoring is the logical next benchmark improvement.
