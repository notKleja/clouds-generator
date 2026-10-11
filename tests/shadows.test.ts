import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateShadows, estimateShadowsCooperatively, shadowPixels } from '../src/shadows';
test('self-shadow estimate changes with light direction and remains deterministic', () => {
  const w = 60,
    h = 40,
    alpha = new Uint8ClampedArray(w * h * 4);
  for (let y = 8; y < 32; y++) for (let x = 5; x < 55; x++) alpha[(y * w + x) * 4 + 3] = 255;
  const left = estimateShadows(alpha, w, h, 992, 180),
    right = estimateShadows(alpha, w, h, 992, 0);
  assert.deepEqual(left, estimateShadows(alpha, w, h, 992, 180));
  assert.notDeepEqual(left, right);
  assert.equal(left[0], 0);
  assert.ok(left[20 * w + 30] > 0.1);
  const pixels = shadowPixels(left, '#FFFFFF', 100);
  assert.ok(Math.min(...pixels) > 100);
  const black = shadowPixels(left, '#000000', 100);
  for (let i = 0; i < black.length; i += 4) assert.equal(black[i] + black[i + 1] + black[i + 2], 0);
});

test('cooperative fallback is identical and stops on a scheduled cancel', async () => {
  const w = 40,
    h = 30,
    alpha = new Uint8ClampedArray(w * h * 4).fill(255);
  assert.deepEqual(
    await estimateShadowsCooperatively(alpha, w, h, 992, 135),
    estimateShadows(alpha, w, h, 992, 135),
  );
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(estimateShadowsCooperatively(alpha, w, h, 992, 135, controller.signal), {
    name: 'AbortError',
  });
});

test('vertical gradient preserves top color, strength, and optical shadow modulation', () => {
  const zero = new Float32Array(6),
    gradient = { color: '#0000FF', strength: 100 };
  const pixels = shadowPixels(zero, '#FF0000', 0, 2, 3, gradient);
  assert.deepEqual(Array.from(pixels.slice(0, 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(pixels.slice(-4)), [0, 0, 255, 255]);
  assert.deepEqual(
    shadowPixels(zero, '#FF0000', 0, 2, 3, { ...gradient, strength: 0 }),
    shadowPixels(zero, '#FF0000', 0),
  );
  const shaded = shadowPixels(new Float32Array(6).fill(0.5), '#FF0000', 100, 2, 3, gradient);
  assert.ok(shaded[0] < pixels[0]);
  assert.ok(shaded[22] < pixels[22]);
  for (let i = 3; i < shaded.length; i += 4) assert.equal(shaded[i], 255);
});

test('a solid slab darkens continuously away from the light without repeated shadow steps', () => {
  const w = 180,
    h = 100,
    alpha = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) alpha[(y * w + x) * 4 + 3] = 255;
  const field = estimateShadows(alpha, w, h, 992, 180);
  // Average a column to distinguish broad density variation from discrete ray bands.
  const columns = Array.from({ length: w }, (_, x) => {
    let n = 0;
    for (let y = 10; y < 90; y++) n += field[y * w + x];
    return n / 80;
  });
  let largest = 0;
  for (let x = 2; x < 80; x++) largest = Math.max(largest, Math.abs(columns[x] - columns[x - 1]));
  assert.ok(largest < 0.025, `Lighting has a repeated sampling step: ${largest}`);
  assert.ok(columns[60] > columns[10]);
});

test('transparency shadows reduce alpha without darkening the cloud color', () => {
  const field = new Float32Array([0, 0.25, 0.5, 1]);
  const pixels = shadowPixels(field, '#AABBCC', 100, 4, 1, undefined, 'transparency');
  assert.deepEqual(
    Array.from(pixels),
    [170, 187, 204, 255, 170, 187, 204, 191, 170, 187, 204, 128, 170, 187, 204, 0],
  );
  const half = shadowPixels(field, '#AABBCC', 50, 4, 1, undefined, 'transparency');
  assert.deepEqual([half[3], half[7], half[11], half[15]], [255, 223, 191, 128]);
  assert.deepEqual(
    shadowPixels(field, '#AABBCC', 0, 4, 1, undefined, 'transparency'),
    shadowPixels(new Float32Array(4), '#AABBCC', 0),
  );
});

test('transparency shadows preserve gradient colors while masking opacity', () => {
  const pixels = shadowPixels(
    new Float32Array([0.5, 0.5]),
    '#FF0000',
    100,
    1,
    2,
    { color: '#0000FF', strength: 100 },
    'transparency',
  );
  assert.deepEqual(Array.from(pixels), [255, 0, 0, 128, 0, 0, 255, 128]);
});
