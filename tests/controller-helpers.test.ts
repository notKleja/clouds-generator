import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/cloud';
import { readRecipe, writeRecipe } from '../src/recipes';
import { scatterJobs, validateBatchBudget } from '../src/scatter';

test('legacy migration strips preview state and future recipes never fall back to defaults', () => {
  const old = readRecipe(
    JSON.stringify({ version: 1, settings: { ...DEFAULTS, background: 'sky', sky: '#FF0000' } }),
  );
  assert.equal(old.settings?.background, 'transparent');
  assert.equal(old.settings?.sky, DEFAULTS.sky);
  assert.deepEqual(readRecipe(writeRecipe(old.settings!)).settings, old.settings);
  for (const data of [
    { version: 3, settings: DEFAULTS },
    { version: 0, settings: DEFAULTS },
    { version: 2, settings: [] },
    { version: 2 },
  ])
    assert.equal(readRecipe(JSON.stringify(data)).settings, null);
});

test('scatter places every cloud inside narrow bounds even when cells are below minimum dimensions', () => {
  const bounds = { x: 25, y: -75, width: 128, height: 64 };
  const jobs = scatterJobs(DEFAULTS, 24, bounds);
  assert.equal(jobs.length, 24);
  for (const job of jobs) {
    assert.ok(job.x >= bounds.x && job.y >= bounds.y);
    assert.ok(job.x + job.settings.width <= bounds.x + bounds.width);
    assert.ok(job.y + job.settings.height <= bounds.y + bounds.height);
  }
  assert.throws(() => scatterJobs(DEFAULTS, 4, { ...bounds, height: 1 }), /64/);
});

test('batch budget rejects excessive count, aggregate pixels, and encoded bytes', () => {
  assert.throws(() => validateBatchBudget([]), /between 1 and 24/);
  assert.throws(
    () => validateBatchBudget(Array.from({ length: 25 }, () => ({ settings: DEFAULTS }))),
    /between 1 and 24/,
  );
  // Defaults export at 2000 x 1400: 11 are 30.8M; 12 are 33.6M.
  validateBatchBudget(Array.from({ length: 11 }, () => ({ settings: DEFAULTS })));
  assert.throws(
    () => validateBatchBudget(Array.from({ length: 12 }, () => ({ settings: DEFAULTS }))),
    /32 million/,
  );
  const bytes = new Uint8Array(64_000_001);
  assert.throws(
    () =>
      validateBatchBudget([
        { settings: DEFAULTS, bytes },
        { settings: DEFAULTS, bytes },
      ]),
    /128 MB/,
  );
});
