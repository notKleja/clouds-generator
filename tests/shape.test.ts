import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalize, cloudLayout } from '../src/cloud';
import { geometryKey } from '../src/render';
import { RecipeHistory } from '../src/interaction';

test('shape edits survive normalization, are bounded and leave the source recipe immutable', () => {
  const raw = { ...DEFAULTS, shape: [{ x: 0.2, y: -0.3 }, { x: Infinity, y: 9 }, null] };
  const s = normalize(raw);
  assert.deepEqual(s.shape, [
    { x: 0.2, y: -0.3 },
    { x: 0, y: 0.5 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]);
  s.shape[0].x = 0;
  assert.equal(raw.shape[0]!.x, 0.2);
  assert.deepEqual(
    normalize({}).shape,
    Array.from({ length: 5 }, () => ({ x: 0, y: 0 })),
  );
});
test('pulling the middle handle develops the cloud locally without changing the original recipe', () => {
  const before = cloudLayout(DEFAULTS),
    s = normalize(DEFAULTS);
  s.shape[2].y = -0.3;
  const after = cloudLayout(s);
  assert.ok(after.ellipses[5].y < before.ellipses[5].y - 30);
  assert.ok(Math.abs(after.ellipses[1].y - before.ellipses[1].y) < 10);
  assert.notEqual(geometryKey(s), geometryKey(DEFAULTS));
  const history = new RecipeHistory(DEFAULTS);
  history.commit(s);
  assert.deepEqual(history.undo(s).shape, DEFAULTS.shape);
  assert.deepEqual(history.redo().shape, s.shape);
});

test('bottom flattening is bounded, defaults off for old recipes, and invalidates geometry', () => {
  assert.equal(normalize({}).bottomFlattening, 0);
  assert.equal(normalize({ bottomFlattening: -5 }).bottomFlattening, 0);
  assert.equal(normalize({ bottomFlattening: 140 }).bottomFlattening, 100);
  assert.equal(normalize({ bottomFlattening: NaN }).bottomFlattening, 0);
  const flattened = normalize({ ...DEFAULTS, bottomFlattening: 65 });
  assert.equal(flattened.bottomFlattening, 65);
  assert.notEqual(geometryKey(flattened), geometryKey(DEFAULTS));
  assert.equal(geometryKey(flattened), geometryKey({ ...flattened, quality: 3 }));
});
