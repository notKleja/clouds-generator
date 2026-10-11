import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, PRESETS, normalize, createSVG, exportSize } from '../src/cloud';

test('untrusted settings are bounded and colors cannot inject SVG', () => {
  const s = normalize({ width: Infinity, height: -4, seed: NaN, color: '"/><script>', octaves: 100, opacity: -20 });
  assert.equal(s.width, DEFAULTS.width);
  assert.equal(s.height, 64);
  assert.equal(s.color, DEFAULTS.color);
  assert.equal(s.octaves, 8);
  assert.equal(s.opacity, 0);
  assert.ok(Number.isFinite(s.seed));
});
test('identical recipes render identically and different seeds change the image definition', () => {
  assert.equal(createSVG(DEFAULTS), createSVG({ ...DEFAULTS }));
  assert.notEqual(createSVG(DEFAULTS), createSVG({ ...DEFAULTS, seed: DEFAULTS.seed + 1 }));
});
test('transparent SVG has no sky rectangle and uses explicit filter inputs', () => {
  const svg = createSVG({ ...DEFAULTS, background: 'transparent' });
  assert.ok(!svg.includes('id="sky"'));
  assert.match(svg, /in2="noise"/);
  assert.match(svg, /viewBox="0 0 1000 700"/);
  assert.ok(createSVG({ ...DEFAULTS, background: 'sky' }).includes('id="sky"'));
});
test('export dimensions enforce memory limits', () => {
  assert.deepEqual(exportSize({ ...DEFAULTS, width: 800, height: 600, quality: 2 }), { width: 1600, height: 1200 });
  assert.throws(() => exportSize({ ...DEFAULTS, width: 4096, height: 4096, quality: 3 }), /4096|megapixel/);
});
test('presets have distinct images and valid normalized recipes', () => {
  assert.equal(PRESETS.length, 6);
  const svgs = new Set(PRESETS.map(p => createSVG(normalize({ ...DEFAULTS, ...p.settings }))));
  assert.equal(svgs.size, 6);
});
