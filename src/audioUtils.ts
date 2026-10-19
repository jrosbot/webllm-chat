/** Downmixes channels to mono and resamples audio without mutating the inputs. */
export function resampleToMono(
  channels: readonly Float32Array[],
  sourceRate: number,
  targetRate = 16_000,
): Float32Array {
  if (!channels.length || channels.some(channel => channel.length !== channels[0].length)) {
    throw new Error("Audio channels must be present and have the same length.");
  }
  if (!Number.isFinite(sourceRate) || !Number.isFinite(targetRate) || sourceRate <= 0 || targetRate <= 0) {
    throw new Error("Audio sample rates must be positive numbers.");
  }

  const length = channels[0].length;
  if (length === 0) return new Float32Array();
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let index = 0; index < length; index++) mono[index] += channel[index] / channels.length;
  }
  if (sourceRate === targetRate) return mono;

  const outputLength = Math.max(1, Math.round(length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  if (targetRate > sourceRate) {
    for (let index = 0; index < outputLength; index++) {
      const sourcePosition = index * sourceRate / targetRate;
      const left = Math.min(Math.floor(sourcePosition), length - 1);
      const right = Math.min(left + 1, length - 1);
      const fraction = sourcePosition - left;
      output[index] = mono[left] * (1 - fraction) + mono[right] * fraction;
    }
    return output;
  }

  // Average each source interval when reducing the sample rate to suppress aliasing.
  for (let index = 0; index < outputLength; index++) {
    const start = index * sourceRate / targetRate;
    const end = Math.min((index + 1) * sourceRate / targetRate, length);
    let sum = 0;
    let weight = 0;
    for (let sourceIndex = Math.floor(start); sourceIndex < Math.ceil(end); sourceIndex++) {
      const overlap = Math.max(0, Math.min(end, sourceIndex + 1) - Math.max(start, sourceIndex));
      sum += mono[sourceIndex] * overlap;
      weight += overlap;
    }
    output[index] = weight > 0 ? sum / weight : 0;
  }
  return output;
}

export function whisperLanguageFor(language: string): "german" | "catalan" {
  if (language === "de") return "german";
  if (language === "ca") return "catalan";
  throw new Error(`Unsupported speech-recognition language: ${language}`);
}
