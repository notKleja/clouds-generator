import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { DEFAULTS } from '../src/cloud';

async function harness() {
  const messages: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  let imageFailure = false;
  let storageWait: Promise<void> | undefined;
  const page = { selection: [] as Record<string, unknown>[], appendChild: () => {} };
  const figma = {
    showUI: () => {}, ui: { onmessage: null as unknown, postMessage: (m: Record<string, unknown>) => messages.push(m) },
    on: () => {}, currentPage: page, viewport: { center: { x: 500, y: 500 }, scrollAndZoomIntoView: () => {} },
    clientStorage: { getAsync: async () => undefined, setAsync: async () => { await storageWait; } },
    notify: () => {}, commitUndo: () => {},
    createImage: () => { if (imageFailure) throw new Error('Image decode failed'); return { hash: 'cloud-image' }; },
    createRectangle: () => {
      const data: Record<string, string> = {};
      const n = { id: `cloud-${nodes.length}`, type: 'RECTANGLE', locked: false, parent: null, x: 0, y: 0, width: 0, height: 0, fills: [], name: '',
        resize: (w: number, h: number) => { n.width = w; n.height = h; },
        setPluginData: (k: string, v: string) => { data[k] = v; }, getPluginData: (k: string) => data[k] || '',
        remove: () => { nodes.splice(nodes.indexOf(n), 1); },
      };
      nodes.push(n); return n;
    },
  };
  const result = await build({ entryPoints: ['code.ts'], bundle: true, write: false, target: 'es2017' });
  vm.runInNewContext(result.outputFiles[0].text, { figma, __html__: '', Uint8Array, console });
  const send = (message: unknown) => (figma.ui.onmessage as (m: unknown) => Promise<void>)(message);
  const png = new Uint8Array(32);
  png.set([137,80,78,71,13,10,26,10]); png.set([73,72,68,82], 12);
  const view = new DataView(png.buffer); view.setUint32(16, 2000); view.setUint32(20, 1400);
  const insert = () => send({ type: 'insert', settings: DEFAULTS, bytes: png });
  return { send, insert, png, nodes, page, messages, holdStorage: () => { let release!: () => void; storageWait = new Promise<void>(resolve => { release = resolve; }); return () => release(); }, failImage: () => { imageFailure = true; } };
}

test('insert creates a centered image and stores a regenerable recipe', async () => {
  const h = await harness(); await h.insert();
  assert.equal(h.nodes.length, 1);
  assert.equal(h.nodes[0].width, 1000); assert.equal(h.nodes[0].x, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(h.nodes[0].fills)),  [{ type: 'IMAGE', imageHash: 'cloud-image', scaleMode: 'FIT' }]);
  assert.equal(h.page.selection[0], h.nodes[0]);
  assert.ok(h.messages.some(m => m.type === 'done'));
});

test('update applies cloud dimensions, preserves position and rejects stale targets', async () => {
  const h = await harness(); await h.insert();
  h.nodes[0].x = 42; h.nodes[0].width = 321;
  await h.send({ type: 'update', targetId: 'cloud-0', settings: DEFAULTS, bytes: h.png });
  assert.equal(h.nodes.length, 1); assert.equal(h.nodes[0].x, 42); assert.equal(h.nodes[0].width, 1000);
  h.page.selection = [];
  await h.send({ type: 'update', targetId: 'cloud-0', settings: DEFAULTS, bytes: h.png });
  assert.equal(h.messages.at(-1)?.type, 'error'); assert.equal(h.nodes.length, 1);
});

test('malformed images and decoder failure leave no blank nodes', async () => {
  const h = await harness();
  await h.send({ type: 'insert', settings: DEFAULTS, bytes: new Uint8Array([1,2,3]) });
  assert.equal(h.nodes.length, 0); assert.equal(h.messages.at(-1)?.type, 'error');
  h.failImage(); await h.insert(); assert.equal(h.nodes.length, 0);
});

test('locked cloud cannot be updated', async () => {
  const h = await harness(); await h.insert(); h.nodes[0].locked = true;
  await h.send({ type: 'update', targetId: 'cloud-0', settings: DEFAULTS, bytes: h.png });
  assert.equal(h.messages.at(-1)?.type, 'error');
});


test('slow client storage does not drop the next insert after done', async () => {
  const h = await harness(); const release = h.holdStorage();
  const first = h.insert();
  await new Promise<void>(resolve => setImmediate(resolve));
  const second = h.insert();
  try { assert.equal(h.nodes.length, 2); }
  finally { release(); await Promise.all([first, second]); }
});


test('an external Figma resize cannot be silently reverted by stale controls', async () => {
  const h = await harness(); await h.insert(); h.nodes[0].width = 555;
  await h.send({ type: 'update', targetId: 'cloud-0', targetSize: { width: 1000, height: 700 }, settings: DEFAULTS, bytes: h.png });
  assert.equal(h.nodes[0].width, 555);
  assert.equal(h.messages.at(-1)?.type, 'error');
});


test('stored cloud recipes never retain preview or legacy sky backgrounds', async () => {
  const h=await harness();
  await h.send({type:'insert',settings:{...DEFAULTS,background:'sky',sky:'#FF0000'},bytes:h.png});
  const data=JSON.parse((h.nodes[0].getPluginData as (key:string)=>string)('clouds-recipe-v1'));
  assert.equal(data.settings.background,'transparent');assert.equal(data.settings.sky,DEFAULTS.sky);
});
