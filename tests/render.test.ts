import { cloudRecipe } from '../src/settings';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, createSVG } from '../src/cloud';
import { geometryKey, alphaBounds } from '../src/render';

test('dimensions change geometry while paint and resolution reuse it', () => {
  const key = geometryKey(DEFAULTS);
  assert.equal(geometryKey({ ...DEFAULTS, quality: 3, color: '#FF0000', opacity: 25, background: 'sky' }), key);
  assert.notEqual(geometryKey({ ...DEFAULTS, width: 1400 }), key);
  assert.notEqual(geometryKey({ ...DEFAULTS, height: 400 }), key);
  assert.notEqual(geometryKey({ ...DEFAULTS, seed: 123 }), key);
  assert.notEqual(geometryKey({ ...DEFAULTS, softness: 40 }), key);
});
test('alpha bounds remove empty canvas and preserve a small soft-edge guard', () => {
  const data = new Uint8ClampedArray(100 * 80 * 4);
  for (let y = 30; y <= 49; y++) for (let x = 20; x <= 69; x++) data[(y * 100 + x) * 4 + 3] = 255;
  assert.deepEqual(alphaBounds(data, 100, 80), { x: 18, y: 28, width: 54, height: 24 });
  assert.equal(alphaBounds(new Uint8ClampedArray(16), 2, 2), null);
});
test('cropped output fits the generated silhouette to the requested bounds', () => {
  const svg = createSVG(DEFAULTS, 800, 250, { x: 120, y: 180, width: 760, height: 330 });
  assert.match(svg, /viewBox="120 180 760 330" preserveAspectRatio="none"/);
  assert.match(svg, /width="800" height="250"/);
});


test('legacy sky recipes export transparent clouds without changing their appearance parameters', () => {
  const recipe=cloudRecipe({...DEFAULTS,background:'sky',sky:'#FF0000',color:'#ABCDEF',seed:42});
  assert.equal(recipe.background,'transparent');assert.equal(recipe.sky,DEFAULTS.sky);
  assert.equal(recipe.color,'#ABCDEF');assert.equal(recipe.seed,42);
});
