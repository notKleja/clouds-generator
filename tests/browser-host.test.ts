import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserHost } from '../src/browser-host';

const settings = { seed: 123, width: 64, height: 64, quality: 1 };
function png() {
  const bytes = new Uint8Array(32);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const v = new DataView(bytes.buffer);
  v.setUint32(16, 64);
  v.setUint32(20, 64);
  return bytes;
}
function fixture() {
  const values = new Map<string, string>(),
    messages: Record<string, unknown>[] = [],
    downloads: { bytes: Uint8Array; name: string }[] = [];
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const host = new BrowserHost(
    storage,
    (m) => messages.push(m),
    (bytes, name) => {
      downloads.push({ bytes, name });
    },
  );
  return { host, storage, values, messages, downloads };
}

test('web download validates PNG dimensions, completes, and never downloads a replay twice', async () => {
  const f = fixture();
  await f.host.receive({ type: 'insert', requestId: 'one', settings, bytes: png() });
  assert.equal(f.downloads.length, 1);
  assert.match(f.downloads[0].name, /123-64x64\.png$/);
  assert.equal(f.messages.at(-1)?.type, 'done');
  await f.host.receive({ type: 'operation-status', requestId: 'one' });
  await f.host.receive({ type: 'insert', requestId: 'one', settings, bytes: png() });
  assert.equal(f.downloads.length, 1);
  await f.host.receive({
    type: 'insert',
    requestId: 'bad',
    settings: { ...settings, width: 65 },
    bytes: png(),
  });
  assert.equal(f.downloads.length, 1);
  assert.equal(f.messages.at(-1)?.type, 'error');
});
test('web drafts, custom presets and seed lock survive a new browser host', async () => {
  const f = fixture();
  await f.host.receive({ type: 'save-draft', settings });
  await f.host.receive({ type: 'save-preferences', seedLocked: true });
  await f.host.receive({ type: 'save-preset', requestId: 'save', name: 'Morning', settings });
  assert.equal(f.messages.at(-1)?.requestId, 'save');
  const messages: Record<string, unknown>[] = [];
  const next = new BrowserHost(
    f.storage,
    (m) => messages.push(m),
    () => {},
  );
  await next.receive({ type: 'ready' });
  assert.equal((messages.find((m) => m.type === 'init')?.settings as typeof settings).seed, 123);
  const library = messages.find((m) => m.type === 'presets')!;
  assert.equal(library.seedLocked, true);
  const presets = library.presets as { id: string; name: string }[];
  assert.equal(presets[0].name, 'Morning');
  await next.receive({ type: 'delete-preset', id: presets[0].id });
  assert.deepEqual(messages.at(-1)?.presets, []);
});
test('unavailable browser storage does not prevent generation or temporary presets', async () => {
  const messages: Record<string, unknown>[] = [];
  let downloads = 0;
  const host = new BrowserHost(
    {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    },
    (m) => messages.push(m),
    () => {
      downloads++;
    },
  );
  await host.receive({ type: 'save-preset', requestId: 'save', name: 'Temporary', settings });
  assert.ok(messages.some((m) => m.type === 'presets'));
  assert.ok(messages.some((m) => m.type === 'web-notice'));
  await host.receive({ type: 'insert', requestId: 'png', settings, bytes: png() });
  assert.equal(downloads, 1);
  assert.equal(messages.at(-1)?.type, 'done');
});

test('editing in another tab preserves newer presets and preferences', async () => {
  const f = fixture(),
    second = new BrowserHost(
      f.storage,
      () => {},
      () => {},
    );
  await f.host.receive({ type: 'save-preset', name: 'Saved in A', settings });
  await f.host.receive({ type: 'save-preferences', seedLocked: true });
  await second.receive({ type: 'save-draft', settings: { ...settings, seed: 456 } });
  let value = JSON.parse([...f.values.values()][0]);
  assert.equal(value.presets[0].name, 'Saved in A');
  assert.equal(value.seedLocked, true);
  assert.equal(value.draft.seed, 456);
  await second.receive({ type: 'save-preset', name: 'Saved in B', settings });
  await f.host.receive({ type: 'save-draft', settings });
  value = JSON.parse([...f.values.values()][0]);
  assert.deepEqual(
    value.presets.map((p: { name: string }) => p.name),
    ['Saved in A', 'Saved in B'],
  );
});
