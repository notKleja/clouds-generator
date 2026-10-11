/** Independently implemented SVG cloud technique inspired by beauhaus/Nephele. */
export interface Settings {
  preset: string; seed: number; softness: number; spread: number;
  frequency: number; displacement: number; octaves: number; puffiness: number;
  color: string; opacity: number; width: number; height: number; quality: number;
  background: 'transparent' | 'sky'; sky: string;
}
export const DEFAULTS: Settings = {
  preset: 'cumulus', seed: 992, softness: 13, spread: 12,
  frequency: 0.011, displacement: 145, octaves: 5, puffiness: 75,
  color: '#FFFFFF', opacity: 100, width: 1000, height: 700,
  quality: 2, background: 'transparent', sky: '#8CB8DA',
};
export const PRESETS: { id: string; name: string; settings: Partial<Settings> }[] = [
  { id: 'cumulus', name: 'Cumulus', settings: { seed: 992, softness: 13, spread: 12, frequency: 0.011, displacement: 145, octaves: 5, puffiness: 75 } },
  { id: 'cotton', name: 'Cotton', settings: { seed: 448, softness: 19, spread: 20, frequency: 0.013, displacement: 90, octaves: 6, puffiness: 95 } },
  { id: 'wispy', name: 'Wispy', settings: { seed: 135, softness: 22, spread: 0, frequency: 0.008, displacement: 245, octaves: 6, puffiness: 15 } },
  { id: 'haze', name: 'Haze', settings: { seed: 633, softness: 42, spread: 25, frequency: 0.01, displacement: 155, octaves: 4, puffiness: 30 } },
  { id: 'storm', name: 'Storm', settings: { seed: 947, softness: 15, spread: 30, frequency: 0.018, displacement: 220, octaves: 5, puffiness: 85, color: '#788595' } },
  { id: 'stratus', name: 'Stratus', settings: { seed: 265, softness: 11, spread: 10, frequency: 0.015, displacement: 55, octaves: 3, puffiness: 5 } },
];
function bounded(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const n = Math.min(max, Math.max(min, v));
  return integer ? Math.round(n) : n;
}
function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}
export function normalize(input: unknown): Settings {
  const s = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const d = DEFAULTS;
  return {
    preset: typeof s.preset === 'string' && PRESETS.some(p => p.id === s.preset) ? s.preset : 'custom',
    seed: bounded(s.seed, d.seed, 0, 999999, true),
    softness: bounded(s.softness, d.softness, 1, 50), spread: bounded(s.spread, d.spread, 0, 60),
    frequency: bounded(s.frequency, d.frequency, 0.003, 0.04),
    displacement: bounded(s.displacement, d.displacement, 0, 260),
    octaves: bounded(s.octaves, d.octaves, 1, 8, true), puffiness: bounded(s.puffiness, d.puffiness, 0, 100),
    color: color(s.color, d.color), sky: color(s.sky, d.sky), opacity: bounded(s.opacity, d.opacity, 0, 100),
    width: bounded(s.width, d.width, 64, 4096, true), height: bounded(s.height, d.height, 64, 4096, true),
    quality: bounded(s.quality, d.quality, 1, 3, true), background: s.background === 'sky' ? 'sky' : 'transparent',
  };
}
export function exportSize(settings: Settings): { width: number; height: number } {
  const s = normalize(settings);
  const width = s.width * s.quality, height = s.height * s.quality;
  if (width > 4096 || height > 4096 || width * height > 16000000) {
    throw new Error('Use a smaller size or scale. Maximum: 4096 px per side and 16 megapixels.');
  }
  return { width, height };
}
function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export interface CropBounds { x: number; y: number; width: number; height: number }
export function createSVG(input: Settings, pixelWidth?: number, pixelHeight?: number, crop?: CropBounds): string {
  const s = normalize(input), rand = random(s.seed);
  const round = (n: number) => n.toFixed(2);
  const ellipses = ['<ellipse cx="500" cy="410" rx="265" ry="55"/>'];
  for (let i = 0; i < 9; i++) {
    const x = 270 + i * 57 + (rand() - 0.5) * 35;
    const arch = Math.sin(i / 8 * Math.PI);
    const h = 35 + arch * s.puffiness * (0.6 + rand() * 0.65);
    ellipses.push(`<ellipse cx="${round(x)}" cy="${round(405 - h * 0.55)}" rx="${round(55 + rand() * 25 + s.spread * 0.45)}" ry="${round(h + s.spread * 0.4)}"/>`);
  }
  const width = Number.isFinite(pixelWidth) ? Math.max(1, Math.round(pixelWidth!)) : s.width;
  const height = Number.isFinite(pixelHeight) ? Math.max(1, Math.round(pixelHeight!)) : s.height;
  const skyLight = '#' + [1, 3, 5].map(i => Math.round(parseInt(s.sky.slice(i, i + 2), 16) * 0.72 + 255 * 0.28).toString(16).padStart(2, '0')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs>
<linearGradient id="sky-gradient" x2="0" y2="1"><stop stop-color="${s.sky}"/><stop offset="1" stop-color="${skyLight}"/></linearGradient>
<filter id="cloud" x="0" y="0" width="1000" height="700" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feGaussianBlur in="SourceGraphic" stdDeviation="${s.softness}" result="soft"/>
<feTurbulence type="fractalNoise" baseFrequency="${s.frequency}" numOctaves="${s.octaves}" seed="${s.seed}" result="noise"/>
<feDisplacementMap in="soft" in2="noise" scale="${s.displacement}" xChannelSelector="R" yChannelSelector="G"/>
</filter></defs>
${s.background === 'sky' ? '<rect id="sky" width="100%" height="100%" fill="url(#sky-gradient)"/>' : ''}
<svg width="100%" height="100%" viewBox="${crop ? `${crop.x} ${crop.y} ${crop.width} ${crop.height}` : '0 0 1000 700'}" preserveAspectRatio="${crop ? 'none' : 'xMidYMid meet'}"><g fill="${s.color}" opacity="${s.opacity / 100}" filter="url(#cloud)">${ellipses.join('')}</g></svg></svg>`;
}
