import test from 'node:test';
import assert from 'node:assert/strict';
import { LatestPreview, RecipeHistory, resizeLocked } from '../src/interaction';

test('preview scheduler runs during continuous input, serializes work and finishes latest', async () => {
  let active = 0,
    maxActive = 0;
  const paints: number[] = [];
  const scheduler = new LatestPreview<number>(
    async (value) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 12));
      paints.push(value);
      active--;
    },
    () => {},
    (callback) => setTimeout(callback, 2),
  );
  for (let i = 0; i < 10; i++) {
    scheduler.request(i);
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.ok(paints.length >= 2, 'renders must occur before input ends');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(maxActive, 1);
  assert.equal(paints.at(-1), 9);
});
test('rapid synchronous edits coalesce and errors do not wedge scheduling', async () => {
  const paints: number[] = [],
    errors: string[] = [];
  const scheduler = new LatestPreview<number>(
    async (value) => {
      if (value === 39) throw new Error('failed');
      paints.push(value);
    },
    (e) => errors.push(String(e)),
    (callback) => setTimeout(callback, 0),
  );
  for (let i = 0; i < 40; i++) scheduler.request(i);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(errors.length, 1);
  assert.deepEqual(paints, []);
  scheduler.request(40);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(paints, [40]);
});
test('local history groups drafts into a single committed gesture and invalidates redo', () => {
  const h = new RecipeHistory({ seed: 1 });
  h.commit({ seed: 20 });
  assert.deepEqual(h.undo({ seed: 20 }), { seed: 1 });
  assert.deepEqual(h.redo(), { seed: 20 });
  assert.deepEqual(h.undo({ seed: 30 }), { seed: 20 });
  h.commit({ seed: 40 });
  assert.equal(h.canRedo, false);
  h.reset({ seed: 90 });
  assert.equal(h.canUndo({ seed: 90 }), false);
});
test('locked resizing preserves ratio at normal and bounded sizes', () => {
  assert.deepEqual(resizeLocked('width', 800, 2), { width: 800, height: 400 });
  assert.deepEqual(resizeLocked('height', 400, 2), { width: 800, height: 400 });
  assert.deepEqual(resizeLocked('width', 64, 2), { width: 128, height: 64 });
  assert.deepEqual(resizeLocked('height', 4096, 2), { width: 4096, height: 2048 });
});

test('invalidating a pending selection cannot paint the old cloud', async () => {
  const paints: number[] = [];
  let release!: () => void;
  const scheduler = new LatestPreview<number>(
    async (value, current) => {
      if (value === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (current()) paints.push(value);
    },
    () => {},
    (callback) => setTimeout(callback, 0),
  );
  scheduler.request(1);
  await new Promise((r) => setTimeout(r, 10));
  scheduler.invalidate();
  scheduler.request(2);
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(paints, [2]);
});
