import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, PRESETS, normalize, createSVG, exportSize, cloudLayout } from '../src/cloud';

test('untrusted settings are bounded and colors cannot inject SVG', () => {
  const s = normalize({
    width: Infinity,
    height: -4,
    seed: NaN,
    color: '"/><script>',
    octaves: 100,
    opacity: -20,
  });
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
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
  assert.ok(createSVG({ ...DEFAULTS, background: 'sky' }).includes('id="sky"'));
});
test('export dimensions enforce memory limits', () => {
  assert.deepEqual(exportSize({ ...DEFAULTS, width: 800, height: 600, quality: 2 }), {
    width: 1600,
    height: 1200,
  });
  assert.throws(
    () => exportSize({ ...DEFAULTS, width: 4096, height: 4096, quality: 3 }),
    /4096|megapixel/,
  );
});
test('presets have distinct images and valid normalized recipes', () => {
  assert.equal(PRESETS.length, 6);
  const svgs = new Set(PRESETS.map((p) => createSVG(normalize({ ...DEFAULTS, ...p.settings }))));
  assert.equal(svgs.size, 6);
});

test('default geometry preserves the original base and nine seeded billows', () => {
  const layout = cloudLayout(DEFAULTS);
  assert.equal(layout.ellipses.length, 10);
  assert.deepEqual(layout.ellipses[0], { x: 500, y: 410, rx: 265, ry: 55 });
  assert.deepEqual(layout.frame, { x: 0, y: 0, width: 1000, height: 700 });
  assert.equal(layout.blur, DEFAULTS.softness);
  assert.equal(layout.displacement, DEFAULTS.displacement);
});
test('procedural dimensions change billow count and upward development', () => {
  const original = cloudLayout(DEFAULTS),
    wide = cloudLayout({ ...DEFAULTS, width: 1600 }),
    tall = cloudLayout({ ...DEFAULTS, height: 1100 });
  assert.ok(wide.ellipses.length > original.ellipses.length);
  assert.ok(tall.ellipses[5].y < original.ellipses[5].y);
  assert.equal(wide.ellipses[5].rx, original.ellipses[5].rx);
  assert.notEqual(wide.ellipses.length, original.ellipses.length);
  assert.deepEqual(original, cloudLayout(DEFAULTS));
  assert.ok(cloudLayout({ ...DEFAULTS, width: 4096, height: 4096 }).ellipses.length < 40);
  for (const [width, height] of [
    [4096, 64],
    [64, 4096],
    [4096, 4096],
  ]) {
    const { frame, ellipses } = cloudLayout({
      ...DEFAULTS,
      width,
      height,
      softness: 1,
      displacement: 0,
      spread: 60,
      puffiness: 100,
    });
    for (const e of ellipses) {
      assert.ok(e.x - e.rx > frame.x && e.x + e.rx < frame.x + frame.width);
      assert.ok(e.y - e.ry > frame.y && e.y + e.ry < frame.y + frame.height);
    }
  }
});
test('self shadows are opt-in and malformed controls are normalized', () => {
  assert.equal(normalize({}).selfShadows, false);
  assert.equal(
    normalize({ selfShadows: true, shadowStrength: 999, lightAngle: -9 }).shadowStrength,
    100,
  );
  assert.equal(normalize({ lightAngle: -9 }).lightAngle, 0);
});
