import { checkAbort, exportShadowPixels } from './shadow-client';
import { estimateShadows, shadowPixels } from './shadows';
import { cloudRecipe } from './settings';
import { createSVG, cloudLayout, exportSize, type Settings, type CropBounds } from './cloud';

// Preview noise is sampled once per shape. Export uses a separate refinement.
const SAMPLE_WIDTH = 500;
const SAMPLE_HEIGHT = 350;
export function geometryKey(s: Settings): string {
  return [
    s.width,
    s.height,
    s.seed,
    s.softness,
    s.spread,
    s.frequency,
    s.displacement,
    s.octaves,
    s.puffiness,
    ...s.shape.flatMap((p) => [p.x, p.y]),
  ].join(':');
}
export function alphaBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 1,
): CropBounds | null {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // Preserve faint wisps; a two-sample guard protects the antialiased fringe.
      if (data[(y * width + x) * 4 + 3] > threshold) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  if (right < 0) return null;
  left = Math.max(0, left - 2);
  top = Math.max(0, top - 2);
  right = Math.min(width - 1, right + 2);
  bottom = Math.min(height - 1, bottom + 2);
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable. Reopen the plugin.');
  return ctx;
}
async function svgImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
interface Mask {
  canvas: HTMLCanvasElement;
  crop: CropBounds;
  shadow?: { angle: number; enabled: boolean; field: Float32Array; width: number; height: number };
  shaded?: { key: string; canvas: HTMLCanvasElement };
}
const masks = new Map<string, Promise<Mask>>();
// Serial queue: obsolete slider work cannot run alongside the newest request.
let renderQueue: Promise<unknown> = Promise.resolve();
async function buildMask(
  settings: Settings,
  sampleWidth = SAMPLE_WIDTH,
  sampleHeight = SAMPLE_HEIGHT,
  threshold = 1,
): Promise<Mask> {
  const frame = cloudLayout(settings).frame;
  const scale = Math.min(sampleWidth / frame.width, sampleHeight / frame.height);
  const width = Math.max(1, Math.ceil(frame.width * scale));
  const height = Math.max(1, Math.ceil(frame.height * scale));
  const actualScale = Math.min(width / frame.width, height / frame.height);
  const ox = (width - frame.width * actualScale) / 2,
    oy = (height - frame.height * actualScale) / 2;
  const img = await svgImage(
    createSVG(
      { ...settings, opacity: 100, color: '#FFFFFF', background: 'transparent' },
      width,
      height,
    ),
  );
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const ctx = context(source);
  ctx.drawImage(img, 0, 0);
  const bounds = alphaBounds(ctx.getImageData(0, 0, width, height).data, width, height, threshold);
  if (!bounds) throw new Error('This cloud has no visible pixels. Try another seed.');
  const crop = {
    x: (bounds.x - ox) / actualScale + frame.x,
    y: (bounds.y - oy) / actualScale + frame.y,
    width: bounds.width / actualScale,
    height: bounds.height / actualScale,
  };
  const canvas = document.createElement('canvas');
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  context(canvas).drawImage(
    source,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );
  return { canvas, crop };
}

function maskFor(settings: Settings): Promise<Mask> {
  const key = geometryKey(settings);
  const hit = masks.get(key);
  if (hit) {
    masks.delete(key);
    masks.set(key, hit);
    return hit;
  }
  const result = renderQueue.then(() => buildMask(settings));
  renderQueue = result.catch(() => {});
  masks.set(key, result);
  while (masks.size > 8) masks.delete(masks.keys().next().value!);
  void result.catch(() => {
    if (masks.get(key) === result) masks.delete(key);
  });
  return result;
}
function shadedMask(mask: Mask, s: Settings): HTMLCanvasElement {
  const key = [
    s.selfShadows,
    s.shadowMode,
    s.lightAngle,
    s.shadowStrength,
    s.color,
    s.gradientEnabled,
    s.gradientColor,
    s.gradientStrength,
  ].join(':');
  if (mask.shaded?.key === key) return mask.shaded.canvas;
  const enabled = s.selfShadows && s.shadowStrength > 0;
  if (mask.shadow?.angle !== s.lightAngle || mask.shadow.enabled !== enabled) {
    const scale = Math.min(240 / s.width, 180 / s.height);
    const sample = document.createElement('canvas');
    sample.width = Math.max(1, Math.round(s.width * scale));
    sample.height = Math.max(1, Math.round(s.height * scale));
    const ctx = context(sample);
    ctx.drawImage(mask.canvas, 0, 0, sample.width, sample.height);
    mask.shadow = {
      angle: s.lightAngle,
      enabled,
      width: sample.width,
      height: sample.height,
      field: enabled
        ? estimateShadows(
            ctx.getImageData(0, 0, sample.width, sample.height).data,
            sample.width,
            sample.height,
            s.seed,
            s.lightAngle,
          )
        : new Float32Array(sample.width * sample.height),
    };
  }
  const shade = document.createElement('canvas');
  shade.width = mask.shadow.width;
  shade.height = mask.shadow.height;
  context(shade).putImageData(
    new ImageData(
      new Uint8ClampedArray(
        shadowPixels(
          mask.shadow.field,
          s.color,
          s.selfShadows ? s.shadowStrength : 0,
          shade.width,
          shade.height,
          s.gradientEnabled ? { color: s.gradientColor, strength: s.gradientStrength } : undefined,
          s.shadowMode,
        ),
      ),
      shade.width,
      shade.height,
    ),
    0,
    0,
  );
  mask.shaded = { key, canvas: shade };
  return shade;
}
export async function paintPreview(
  canvas: HTMLCanvasElement,
  settings: Settings,
  current: () => boolean,
  viewport?: CropBounds,
): Promise<CropBounds | undefined> {
  const mask = await maskFor(settings);
  if (!current()) return;
  // Bounded backing store, independent of export resolution and document size.
  const scale = Math.min(480 / settings.width, 250 / settings.height);
  const width = viewport ? canvas.width : Math.max(1, Math.round(settings.width * scale));
  const height = viewport ? canvas.height : Math.max(1, Math.round(settings.height * scale));
  // Resizing the backing store reallocates and resets Canvas state. Reuse it for paint-only edits.
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = context(canvas);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  const view = viewport || mask.crop;
  const x = ((mask.crop.x - view.x) / view.width) * width,
    y = ((mask.crop.y - view.y) / view.height) * height;
  const w = (mask.crop.width / view.width) * width,
    h = (mask.crop.height / view.height) * height;
  if ((settings.selfShadows && settings.shadowStrength > 0) || settings.gradientEnabled) {
    ctx.drawImage(shadedMask(mask, settings), x, y, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask.canvas, x, y, w, h);
  } else {
    ctx.drawImage(mask.canvas, x, y, w, h);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = settings.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.globalCompositeOperation = 'destination-in';
  ctx.globalAlpha = settings.opacity / 100;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  canvas.dataset.ready = 'true';
  return view;
}
export interface RasterizeOptions {
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}

/** Resolution of the optical-depth field is independent of the preview cache. */
export function shadowSampleSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, 1024 / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function unionCrop(a: CropBounds, b: CropBounds): CropBounds {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export async function rasterize(
  input: Settings,
  options: RasterizeOptions = {},
): Promise<Uint8Array> {
  const { signal, onProgress } = options;
  const stage = async (label: string) => {
    checkAbort(signal);
    onProgress?.(label);
    // Give the host an opportunity to paint progress and dispatch a pending Cancel.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    checkAbort(signal);
  };
  checkAbort(signal);
  const settings = cloudRecipe(input);
  const size = exportSize(settings);
  await stage('Finding cloud bounds');
  const mask = await maskFor(settings);
  checkAbort(signal);
  let crop = mask.crop;
  if (settings.quality >= 2 || Math.max(size.width, size.height) > 1200) {
    await stage('Refining fine cloud edges');
    // Inspect the full filter frame, never the coarse crop: isolated wisps may
    // disappear at preview resolution. Keep both bounds to avoid clipping either.
    const sample = Math.min(2048, Math.max(1024, size.width, size.height));
    const refined = await buildMask(settings, sample, sample, 0);
    checkAbort(signal);
    crop = unionCrop(crop, refined.crop);
  }
  await stage('Rendering full-resolution cloud');
  const image = await svgImage(createSVG(settings, size.width, size.height, crop));
  checkAbort(signal);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = context(canvas);
  if ((settings.selfShadows && settings.shadowStrength > 0) || settings.gradientEnabled) {
    await stage('Sampling export lighting');
    const sample = shadowSampleSize(size.width, size.height);
    const alphaImage = await svgImage(
      createSVG({ ...settings, color: '#FFFFFF', opacity: 100 }, sample.width, sample.height, crop),
    );
    checkAbort(signal);
    const lighting = document.createElement('canvas');
    lighting.width = sample.width;
    lighting.height = sample.height;
    const lightContext = context(lighting);
    lightContext.drawImage(alphaImage, 0, 0);
    const alpha = lightContext.getImageData(0, 0, sample.width, sample.height).data;
    await stage('Computing cloud lighting');
    const pixels = await exportShadowPixels(
      {
        alpha: alpha.buffer as ArrayBuffer,
        ...sample,
        seed: settings.seed,
        angle: settings.lightAngle,
        color: settings.color,
        strength: settings.selfShadows ? settings.shadowStrength : 0,
        mode: settings.shadowMode,
        gradient: settings.gradientEnabled
          ? { color: settings.gradientColor, strength: settings.gradientStrength }
          : undefined,
      },
      signal,
    );
    checkAbort(signal);
    lightContext.putImageData(
      new ImageData(new Uint8ClampedArray(pixels), sample.width, sample.height),
      0,
      0,
    );
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(lighting, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'destination-in';
  }
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  await stage('Encoding PNG');
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('PNG export failed. Try a smaller size.'))),
      'image/png',
    ),
  );
  checkAbort(signal);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  checkAbort(signal);
  return bytes;
}
