/** Independently implemented SVG cloud technique inspired by beauhaus/Nephele. */
export interface ShapePoint {
  x: number;
  y: number;
}
export interface Settings {
  preset: string;
  seed: number;
  softness: number;
  spread: number;
  frequency: number;
  displacement: number;
  octaves: number;
  puffiness: number;
  bottomFlattening: number;
  color: string;
  opacity: number;
  width: number;
  height: number;
  quality: number;
  background: 'transparent' | 'sky';
  sky: string;
  shape: ShapePoint[];
  gradientEnabled: boolean;
  gradientColor: string;
  gradientStrength: number;
  shadowMode: 'shade' | 'transparency';
  selfShadows: boolean;
  shadowStrength: number;
  lightAngle: number;
}
export const DEFAULTS: Settings = {
  shape: Array.from({ length: 5 }, () => ({ x: 0, y: 0 })),
  preset: 'cumulus',
  seed: 992,
  softness: 13,
  spread: 12,
  frequency: 0.011,
  displacement: 145,
  octaves: 5,
  puffiness: 75,
  bottomFlattening: 0,
  color: '#FFFFFF',
  opacity: 100,
  width: 1000,
  height: 700,
  quality: 2,
  background: 'transparent',
  sky: '#8CB8DA',
  gradientEnabled: true,
  gradientColor: '#8FABC5',
  gradientStrength: 50,
  shadowMode: 'transparency',
  selfShadows: false,
  shadowStrength: 40,
  lightAngle: 135,
};
export const PRESETS: { id: string; name: string; settings: Partial<Settings> }[] = [
  {
    id: 'cumulus',
    name: 'Cumulus',
    settings: {
      seed: 992,
      softness: 13,
      spread: 12,
      frequency: 0.011,
      displacement: 145,
      octaves: 5,
      puffiness: 75,
    },
  },
  {
    id: 'cotton',
    name: 'Cotton',
    settings: {
      seed: 448,
      softness: 19,
      spread: 20,
      frequency: 0.013,
      displacement: 90,
      octaves: 6,
      puffiness: 95,
    },
  },
  {
    id: 'wispy',
    name: 'Wispy',
    settings: {
      seed: 135,
      softness: 22,
      spread: 0,
      frequency: 0.008,
      displacement: 245,
      octaves: 6,
      puffiness: 15,
    },
  },
  {
    id: 'haze',
    name: 'Haze',
    settings: {
      seed: 633,
      softness: 42,
      spread: 25,
      frequency: 0.01,
      displacement: 155,
      octaves: 4,
      puffiness: 30,
    },
  },
  {
    id: 'storm',
    name: 'Storm',
    settings: {
      seed: 947,
      softness: 15,
      spread: 30,
      frequency: 0.018,
      displacement: 220,
      octaves: 5,
      puffiness: 85,
      color: '#788595',
    },
  },
  {
    id: 'stratus',
    name: 'Stratus',
    settings: {
      seed: 265,
      softness: 11,
      spread: 10,
      frequency: 0.015,
      displacement: 55,
      octaves: 3,
      puffiness: 5,
    },
  },
];
function bounded(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const n = Math.min(max, Math.max(min, v));
  return integer ? Math.round(n) : n;
}
function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : fallback;
}
export function normalize(input: unknown): Settings {
  const s = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const d = DEFAULTS;
  return {
    shape: Array.from({ length: 5 }, (_, i) => {
      const point = Array.isArray(s.shape) ? s.shape[i] : undefined;
      return { x: bounded(point?.x, 0, -0.5, 0.5), y: bounded(point?.y, 0, -0.5, 0.5) };
    }),
    gradientEnabled: typeof s.gradientEnabled === 'boolean' ? s.gradientEnabled : d.gradientEnabled,
    gradientColor: color(s.gradientColor, d.gradientColor),
    gradientStrength: bounded(s.gradientStrength, d.gradientStrength, 0, 100),
    shadowMode:
      s.shadowMode === 'shade' || s.shadowMode === 'transparency' ? s.shadowMode : d.shadowMode,
    selfShadows: s.selfShadows === true,
    shadowStrength: bounded(s.shadowStrength, d.shadowStrength, 0, 100),
    lightAngle: bounded(s.lightAngle, d.lightAngle, 0, 360),
    preset:
      typeof s.preset === 'string' && PRESETS.some((p) => p.id === s.preset) ? s.preset : 'custom',
    seed: bounded(s.seed, d.seed, 0, 999999, true),
    softness: bounded(s.softness, d.softness, 1, 50),
    spread: bounded(s.spread, d.spread, 0, 60),
    frequency: bounded(s.frequency, d.frequency, 0.003, 0.04),
    displacement: bounded(s.displacement, d.displacement, 0, 260),
    octaves: bounded(s.octaves, d.octaves, 1, 8, true),
    puffiness: bounded(s.puffiness, d.puffiness, 0, 100),
    bottomFlattening: bounded(s.bottomFlattening, 0, 0, 100),
    color: color(s.color, d.color),
    sky: color(s.sky, d.sky),
    opacity: bounded(s.opacity, d.opacity, 0, 100),
    width: bounded(s.width, d.width, 64, 4096, true),
    height: bounded(s.height, d.height, 64, 4096, true),
    quality: bounded(s.quality, d.quality, 1, 3, true),
    background: s.background === 'sky' ? 'sky' : 'transparent',
  };
}
export function exportSize(settings: Settings): { width: number; height: number } {
  const s = normalize(settings);
  const width = s.width * s.quality,
    height = s.height * s.quality;
  if (width > 4096 || height > 4096 || width * height > 16000000) {
    throw new Error('Use a smaller size or scale. Maximum: 4096 px per side and 16 megapixels.');
  }
  return { width, height };
}
function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export interface CropBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CloudLayout {
  blur: number;
  displacement: number;
  frame: CropBounds;
  handles: ShapePoint[];
  shapeScale: ShapePoint;
  ellipses: { x: number; y: number; rx: number; ry: number }[];
}
/** Preserve the original seeded ridge; size edits develop it before filtering. */
export function cloudLayout(input: Settings): CloudLayout {
  const s = normalize(input),
    rand = random(s.seed);
  const widthScale = s.width / DEFAULTS.width,
    heightScale = s.height / DEFAULTS.height;
  const count = Math.max(3, Math.round(9 * widthScale));
  const ellipses: CloudLayout['ellipses'] = [
    { x: 500, y: 410, rx: 265 * widthScale, ry: 55 * Math.sqrt(heightScale) },
  ];
  for (let i = 0; i < count; i++) {
    const x = 500 + (-230 + (i / (count - 1)) * 456) * widthScale + (rand() - 0.5) * 35;
    const arch = Math.sin((i / (count - 1)) * Math.PI);
    const h = 35 + arch * s.puffiness * (0.6 + rand() * 0.65) * heightScale;
    ellipses.push({
      x,
      y: 405 - h * 0.55,
      rx: 55 + rand() * 25 + s.spread * 0.45,
      ry: h + s.spread * 0.4,
    });
  }
  const shapeScale = {
    x: Math.max(...ellipses.map((e) => e.x + e.rx)) - Math.min(...ellipses.map((e) => e.x - e.rx)),
    y: Math.max(...ellipses.map((e) => e.y + e.ry)) - Math.min(...ellipses.map((e) => e.y - e.ry)),
  };
  const handles = s.shape.map((offset, i) => {
    const index = (i / 4) * (count - 1),
      a = ellipses[1 + Math.floor(index)],
      b = ellipses[1 + Math.ceil(index)];
    const t = index % 1;
    return {
      x: a.x * (1 - t) + b.x * t + offset.x * shapeScale.x,
      y: a.y * (1 - t) + b.y * t + offset.y * shapeScale.y,
    };
  });
  for (let i = 0; i < ellipses.length; i++) {
    const t = i === 0 ? 0.5 : (i - 1) / (count - 1);
    const influence = i === 0 ? 0.35 : 1;
    for (let j = 0; j < 5; j++) {
      const weight = Math.exp(-Math.pow((t - j / 4) / 0.18, 2)) * influence;
      ellipses[i].x += s.shape[j].x * shapeScale.x * weight;
      ellipses[i].y += s.shape[j].y * shapeScale.y * weight;
    }
  }
  // Keep the original filter coordinates at the default size. Expand around
  // actual geometry at large sizes, including blur and displacement fringes.
  const padding = Math.ceil(s.softness * 4 + s.displacement * 0.55 + 4);
  const left = Math.min(0, ...ellipses.map((e) => Math.floor(e.x - e.rx - padding)));
  const top = Math.min(0, ...ellipses.map((e) => Math.floor(e.y - e.ry - padding)));
  const right = Math.max(1000, ...ellipses.map((e) => Math.ceil(e.x + e.rx + padding)));
  const bottom = Math.max(700, ...ellipses.map((e) => Math.ceil(e.y + e.ry + padding)));
  return {
    ellipses,
    handles,
    shapeScale,
    blur: s.softness,
    displacement: s.displacement,
    frame: { x: left, y: top, width: right - left, height: bottom - top },
  };
}
/** Compress the lower density contours before blur/noise, leaving a wispy edge. */
function flattenedContour(
  l: CloudLayout['ellipses'][number],
  base: CloudLayout['ellipses'][number],
  s: Settings,
): string {
  const pivot = base.y - base.ry * 0.7;
  const amount = s.bottomFlattening / 100;
  const points = Array.from({ length: 64 }, (_, i) => {
    const angle = (i * Math.PI * 2) / 64;
    const x = l.x + Math.cos(angle) * l.rx;
    const y = l.y + Math.sin(angle) * l.ry;
    const depth = Math.max(0, y - pivot);
    // Flattening controls geometry only. The ordinary cloud filter supplies
    // softness, frequency, detail and turbulence over the entire silhouette.
    const range = Math.max(8, base.ry * 0.8);
    const compressed = range * (1 - Math.exp(-depth / range));
    return { x, y: y + (compressed - depth) * amount };
  });
  const n = points.length;
  const pair = (p: ShapePoint) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
  let path = `M${pair(points[0])}`;
  for (let i = 0; i < n; i++) {
    const a = points[(i + n - 1) % n],
      b = points[i],
      c = points[(i + 1) % n],
      d = points[(i + 2) % n];
    path += `C${pair({ x: b.x + (c.x - a.x) / 6, y: b.y + (c.y - a.y) / 6 })} ${pair({ x: c.x - (d.x - b.x) / 6, y: c.y - (d.y - b.y) / 6 })} ${pair(c)}`;
  }
  return `<path d="${path}Z"/>`;
}
export function createSVG(
  input: Settings,
  pixelWidth?: number,
  pixelHeight?: number,
  crop?: CropBounds,
): string {
  const s = normalize(input),
    layout = cloudLayout(s),
    frame = crop || layout.frame;
  const width = Number.isFinite(pixelWidth) ? Math.max(1, Math.round(pixelWidth!)) : s.width;
  const height = Number.isFinite(pixelHeight) ? Math.max(1, Math.round(pixelHeight!)) : s.height;
  const ellipses = layout.ellipses
    .map((l) =>
      s.bottomFlattening > 0
        ? flattenedContour(l, layout.ellipses[0], s)
        : `<ellipse cx="${l.x.toFixed(2)}" cy="${l.y.toFixed(2)}" rx="${l.rx.toFixed(2)}" ry="${l.ry.toFixed(2)}"/>`,
    )
    .join('');
  const f = layout.frame,
    frequency = s.frequency;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}" preserveAspectRatio="${crop ? 'none' : 'xMidYMid meet'}">
<defs><filter id="cloud" x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feGaussianBlur in="SourceGraphic" stdDeviation="${layout.blur}" result="soft"/>
<feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="${s.octaves}" seed="${s.seed}" result="noise"/>
<feDisplacementMap in="soft" in2="noise" scale="${layout.displacement}" xChannelSelector="R" yChannelSelector="G"/>
</filter></defs>
${s.background === 'sky' ? `<rect id="sky" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" fill="${s.sky}"/>` : ''}
<g fill="${s.color}" opacity="${s.opacity / 100}" filter="url(#cloud)">${ellipses}</g></svg>`;
}
