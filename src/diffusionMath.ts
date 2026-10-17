// LCM epsilon scheduler: scaled-linear betas and discrete boundary conditions.
// Reference: Hugging Face Diffusers LCMScheduler (Apache-2.0).
export function lcmTimesteps(steps: number) {
  if (!Number.isInteger(steps) || steps < 1 || steps > 50) throw new Error("Choose 1–50 inference steps.");
  return Array.from({ length: steps }, (_, i) => 999 - Math.floor(i * 50 / steps) * 20);
}

const alphas = new Float64Array(1000);
let cumulative = 1;
for (let i = 0; i < alphas.length; i++) {
  const beta = (Math.sqrt(0.00085) + i / 999 * (Math.sqrt(0.012) - Math.sqrt(0.00085))) ** 2;
  cumulative *= 1 - beta;
  alphas[i] = cumulative;
}

export function seededNoise(seed: number) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6D2B79F5) | 0;
    let n = Math.imul(state ^ state >>> 15, 1 | state);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(Math.max(uniform(), Number.EPSILON))) * Math.cos(2 * Math.PI * uniform());
}

export function lcmStep(sample: Float32Array, epsilon: Float32Array, timestep: number, next: number | undefined, noise: () => number) {
  if (sample.length !== epsilon.length) throw new Error("Diffusion output shape does not match the latent image.");
  const alpha = alphas[timestep];
  const scaled = timestep * 10;
  const skip = 0.25 / (scaled * scaled + 0.25);
  const out = scaled / Math.sqrt(scaled * scaled + 0.25);
  return Float32Array.from(sample, (x, i) => {
    const original = (x - Math.sqrt(1 - alpha) * epsilon[i]) / Math.sqrt(alpha);
    const denoised = skip * x + out * original;
    return next === undefined ? denoised : Math.sqrt(alphas[next]) * denoised + Math.sqrt(1 - alphas[next]) * noise();
  });
}

export function pixelsFromPlanarRGB(data: Float32Array, width: number, height: number) {
  const plane = width * height;
  if (data.length !== plane * 3 || !data.every(Number.isFinite)) throw new Error("The decoder returned an invalid image.");
  const pixels = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) {
    for (let channel = 0; channel < 3; channel++) pixels[4 * i + channel] = (data[channel * plane + i] / 2 + 0.5) * 255;
    pixels[4 * i + 3] = 255;
  }
  return pixels;
}
