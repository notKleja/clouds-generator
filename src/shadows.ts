/** Warped gradient noise avoids the visible cells of interpolated value noise. */
function gradientNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (a: number, b: number, dx: number, dy: number) => {
    let hash = Math.imul(a + seed, 374761393) ^ Math.imul(b + 1, 668265263);
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    const angle = (((hash ^ (hash >>> 16)) >>> 0) / 4294967296) * Math.PI * 2;
    return Math.cos(angle) * dx + Math.sin(angle) * dy;
  };
  const u = fade(fx),
    v = fade(fy);
  return (
    (dot(ix, iy, fx, fy) * (1 - u) + dot(ix + 1, iy, fx - 1, fy) * u) * (1 - v) +
    (dot(ix, iy + 1, fx, fy - 1) * (1 - u) + dot(ix + 1, iy + 1, fx - 1, fy - 1) * u) * v
  );
}
/** Continuous directional optical thickness. Each pixel sees the preceding ray,
 * rather than six displaced copies of the density field. O(width * height). */
function* shadowSteps(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  seed: number,
  angle: number,
): Generator<void, Float32Array> {
  const density = new Float32Array(width * height),
    tau = new Float32Array(density.length),
    result = new Float32Array(density.length);
  const unit = Math.max(1, Math.min(width, height));
  for (let y = 0; y < height; y++) {
    if (y % 8 === 0) yield;
    for (let x = 0; x < width; x++) {
      const u = (x / unit) * 3.1,
        v = (y / unit) * 3.1;
      const warp = gradientNoise(u * 0.6 + 13, v * 0.6 - 7, seed + 17);
      const n =
        gradientNoise(u + warp * 0.9, v - warp * 0.7, seed) * 0.7 +
        gradientNoise(u * 1.67 + v * 0.93 + 19, v * 1.67 - u * 0.93 - 11, seed + 73) * 0.3;
      density[y * width + x] = (alpha[(y * width + x) * 4 + 3] / 255) * (0.65 + n * 0.35);
    }
  }
  const a = (angle * Math.PI) / 180,
    dx = Math.cos(a),
    dy = -Math.sin(a);
  const horizontal = Math.abs(dx) >= Math.abs(dy),
    dominant = horizontal ? dx : dy;
  const cross = (horizontal ? dy : dx) / Math.max(1e-9, Math.abs(dominant));
  const step = Math.hypot(1, cross) / unit,
    decay = Math.exp(-step / 0.8);
  const major = horizontal ? width : height,
    minor = horizontal ? height : width;
  const sign = dominant >= 0 ? 1 : -1;
  const at = (m: number, n: number) =>
    n < 0 || n >= minor || m < 0 || m >= major
      ? 0
      : tau[horizontal ? n * width + m : m * width + n];
  for (let k = 0; k < major; k++) {
    if (k % 32 === 0) yield;
    const m = sign > 0 ? major - 1 - k : k;
    for (let n = 0; n < minor; n++) {
      const upstream = n + cross,
        low = Math.floor(upstream),
        f = upstream - low;
      const previous = at(m + sign, low) * (1 - f) + at(m + sign, low + 1) * f;
      const i = horizontal ? n * width + m : m * width + n;
      tau[i] = previous * decay + density[i] * step;
      result[i] = ((1 - Math.exp(-tau[i] * 2.8)) * alpha[i * 4 + 3]) / 255;
    }
  }
  return result;
}
export function estimateShadows(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  seed: number,
  angle: number,
): Float32Array {
  const steps = shadowSteps(alpha, width, height, seed, angle);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

/** Same math as the worker, with event-loop opportunities for Cancel in tests or restricted hosts. */
export async function estimateShadowsCooperatively(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  seed: number,
  angle: number,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const steps = shadowSteps(alpha, width, height, seed, angle);
  for (;;) {
    if (signal?.aborted) throw new DOMException('Rendering canceled.', 'AbortError');
    const next = steps.next();
    if (next.done) return next.value;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
export interface ShadowGradient {
  color: string;
  strength: number;
}
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const encode = (v: number) =>
  Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
export function shadowPixels(
  field: Float32Array,
  color: string,
  strength: number,
  width = field.length,
  height = 1,
  gradient?: ShadowGradient,
): Uint8ClampedArray {
  const rgb = [1, 3, 5].map((i) => linear(parseInt(color.slice(i, i + 2), 16) / 255)),
    pixels = new Uint8ClampedArray(field.length * 4);
  const amount = Math.max(0, Math.min(100, strength)) / 100;
  const bottom = gradient
    ? [1, 3, 5].map((i) => linear(parseInt(gradient.color.slice(i, i + 2), 16) / 255))
    : rgb;
  const blend = gradient ? Math.max(0, Math.min(100, gradient.strength)) / 100 : 0;
  for (let i = 0; i < field.length; i++) {
    const t = (blend * Math.floor(i / width)) / Math.max(1, height - 1);
    // A cool indirect-light floor keeps dark areas luminous rather than black.
    for (let c = 0; c < 3; c++)
      pixels[i * 4 + c] = encode(
        (rgb[c] * (1 - t) + bottom[c] * t) * (1 - field[i] * amount * [0.68, 0.61, 0.51][c]),
      );
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

export interface ShadowRequest {
  alpha: ArrayBuffer;
  width: number;
  height: number;
  seed: number;
  angle: number;
  color: string;
  strength: number;
  gradient?: ShadowGradient;
}
