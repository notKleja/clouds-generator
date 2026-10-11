import { exportSize, normalize, type Settings } from './cloud';
export const MAX_BATCH_COUNT = 24;
export const MAX_BATCH_PIXELS = 32_000_000;
export const MAX_BATCH_BYTES = 128_000_000;
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ScatterJob {
  settings: Settings;
  x: number;
  y: number;
}
export function scatterJobs(settings: Settings, count: number, bounds: Bounds): ScatterJob[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH_COUNT)
    throw new Error('Choose between 1 and 24 clouds.');
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width < 64 ||
    bounds.height < 64
  )
    throw new Error('Scatter bounds must be at least 64 by 64 pixels.');
  let seed = settings.seed >>> 0;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const columns = Math.ceil(Math.sqrt((count * bounds.width) / bounds.height));
  const rows = Math.ceil(count / columns);
  const cellWidth = bounds.width / columns;
  const cellHeight = bounds.height / rows;
  return Array.from({ length: count }, (_, i) => {
    const scale =
      Math.min(cellWidth / settings.width, cellHeight / settings.height, 1) * (0.65 + next() * 0.3);
    const item = normalize({
      ...settings,
      seed: Math.floor(next() * 1_000_000),
      width: Math.max(64, Math.floor(settings.width * scale)),
      height: Math.max(64, Math.floor(settings.height * scale)),
    });
    const x = bounds.x + (i % columns) * cellWidth + Math.max(0, cellWidth - item.width) * next();
    const y =
      bounds.y +
      Math.floor(i / columns) * cellHeight +
      Math.max(0, cellHeight - item.height) * next();
    return {
      settings: item,
      x: Math.min(x, bounds.x + bounds.width - item.width),
      y: Math.min(y, bounds.y + bounds.height - item.height),
    };
  });
}
export function validateBatchBudget(items: { settings: Settings; bytes?: Uint8Array }[]): void {
  if (!items.length || items.length > MAX_BATCH_COUNT)
    throw new Error('A batch must contain between 1 and 24 clouds.');
  let pixels = 0,
    bytes = 0;
  for (const item of items) {
    const size = exportSize(item.settings);
    pixels += size.width * size.height;
    bytes += item.bytes?.length || 0;
  }
  if (pixels > MAX_BATCH_PIXELS)
    throw new Error(
      'This batch exceeds 32 million pixels. Reduce the count, size, or export quality.',
    );
  if (bytes > MAX_BATCH_BYTES)
    throw new Error('This batch exceeds 128 MB of encoded images. Reduce the count or size.');
}
