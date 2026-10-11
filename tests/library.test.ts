import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalize } from '../src/cloud';
import { batchRecipes, presetRecipe, variantRecipes } from '../src/library';

test('batch edits apply only changed fields and retain each layer geometry', () => {
  const first = normalize(DEFAULTS),
    second = normalize({ ...DEFAULTS, seed: 345, width: 600, shape: [{ x: 0.1, y: 0 }] });
  const result = batchRecipes(first, { ...first, color: '#DDEEFF', softness: 22 }, [first, second]);
  assert.equal(result[1].seed, 345);
  assert.equal(result[1].width, 600);
  assert.equal(result[1].shape[0].x, 0.1);
  assert.equal(result[1].color, '#DDEEFF');
  assert.equal(result[1].softness, 22);
  assert.equal(second.color, '#FFFFFF');
});
test('seed lock preserves a seed while changing styles; variations intentionally vary seeds', () => {
  assert.equal(presetRecipe(DEFAULTS, { seed: 123, softness: 30 }, true).seed, 992);
  assert.equal(presetRecipe(DEFAULTS, { seed: 123, softness: 30 }, false).seed, 123);
  const variants = variantRecipes(DEFAULTS);
  assert.equal(variants.length, 6);
  assert.equal(new Set(variants.map((s) => s.seed)).size, 6);
  assert.ok(variants.every((s) => s.seed !== 992 && s.softness === 13));
  assert.deepEqual(variants, variantRecipes(DEFAULTS));
});
test('gradient is optional, bounded, and cannot inject color data', () => {
  const defaults = normalize({}),
    s = normalize({ gradientEnabled: true, gradientStrength: 400, gradientColor: '<bad>' });
  assert.equal(defaults.gradientEnabled, true);
  assert.equal(normalize({ gradientEnabled: false }).gradientEnabled, false);
  assert.equal(s.gradientStrength, 100);
  assert.equal(s.gradientColor, '#8FABC5');
});
