import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { DEFAULTS } from '../src/cloud';

async function harness(command = 'open') {
  const messages: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const storage: Record<string, unknown> = {};
  const shown: Record<string, unknown>[] = [];
  let closed = false;
  let resizeCalls = 0;
  let failResizeId = '';
  let selectionHandler = () => {};
  let imageFailure = false;
  let storageWait: Promise<void> | undefined;
  const page = { selection: [] as Record<string, unknown>[], appendChild: () => {} };
  const figma = {
    command,
    showUI: (_html: string, options: Record<string, unknown>) => {
      shown.push(options);
    },
    closePlugin: () => {
      closed = true;
    },
    ui: {
      show: () => {
        shown.push({ visible: true });
      },
      onmessage: null as unknown,
      postMessage: (m: Record<string, unknown>) => messages.push(m),
    },
    on: (_event: string, handler: () => void) => {
      selectionHandler = handler;
    },
    currentPage: page,
    viewport: { center: { x: 500, y: 500 }, scrollAndZoomIntoView: () => {} },
    clientStorage: {
      getAsync: async (key: string) => storage[key],
      setAsync: async (key: string, value: unknown) => {
        await storageWait;
        storage[key] = value;
      },
    },
    notify: () => {},
    commitUndo: () => {},
    createImage: () => {
      if (imageFailure) throw new Error('Image decode failed');
      return { hash: 'cloud-image' };
    },
    createRectangle: () => {
      const data: Record<string, string> = {};
      const n = {
        id: `cloud-${nodes.length}`,
        type: 'RECTANGLE',
        locked: false,
        parent: null,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        fills: [],
        name: '',
        resize: (w: number, h: number) => {
          resizeCalls++;
          if (failResizeId === n.id) {
            failResizeId = '';
            throw new Error('Resize failed');
          }
          n.width = w;
          n.height = h;
        },
        setRelaunchData: (value: Record<string, string>) => {
          (n as unknown as Record<string, unknown>).relaunch = value;
        },
        getRelaunchData: () => (n as unknown as Record<string, unknown>).relaunch || {},
        setPluginData: (k: string, v: string) => {
          data[k] = v;
        },
        getPluginData: (k: string) => data[k] || '',
        remove: () => {
          nodes.splice(nodes.indexOf(n), 1);
        },
      };
      nodes.push(n);
      return n;
    },
  };
  const result = await build({
    entryPoints: ['code.ts'],
    bundle: true,
    write: false,
    target: 'es2017',
  });
  vm.runInNewContext(result.outputFiles[0].text, { figma, __html__: '', Uint8Array, console });
  const send = (message: unknown) => (figma.ui.onmessage as (m: unknown) => Promise<void>)(message);
  const png = new Uint8Array(32);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  png.set([73, 72, 68, 82], 12);
  const view = new DataView(png.buffer);
  view.setUint32(16, 2000);
  view.setUint32(20, 1400);
  const insert = () => send({ type: 'insert', settings: DEFAULTS, bytes: png });
  return {
    send,
    insert,
    png,
    nodes,
    page,
    messages,
    storage,
    shown,
    closed: () => closed,
    resizeCalls: () => resizeCalls,
    failResize: (id: string) => {
      failResizeId = id;
    },
    selectionChanged: () => selectionHandler(),
    makeNode: () => figma.createRectangle(),
    holdStorage: () => {
      let release!: () => void;
      storageWait = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release();
    },
    failImage: () => {
      imageFailure = true;
    },
  };
}

test('insert creates a centered image and stores a regenerable recipe', async () => {
  const h = await harness();
  await h.insert();
  assert.equal(h.nodes.length, 1);
  assert.equal(h.nodes[0].width, 1000);
  assert.equal(h.nodes[0].x, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(h.nodes[0].fills)), [
    { type: 'IMAGE', imageHash: 'cloud-image', scaleMode: 'FIT' },
  ]);
  assert.equal(h.page.selection[0], h.nodes[0]);
  assert.ok(h.messages.some((m) => m.type === 'done'));
});

test('update applies cloud dimensions, preserves position and rejects stale targets', async () => {
  const h = await harness();
  await h.insert();
  h.nodes[0].x = 42;
  h.nodes[0].width = 321;
  await h.send({ type: 'update', targetId: 'cloud-0', settings: DEFAULTS, bytes: h.png });
  assert.equal(h.nodes.length, 1);
  assert.equal(h.nodes[0].x, 42);
  assert.equal(h.nodes[0].width, 1000);
  h.page.selection = [];
  await h.send({ type: 'update', targetId: 'cloud-0', settings: DEFAULTS, bytes: h.png });
  assert.equal(h.messages.at(-1)?.type, 'error');
  assert.equal(h.nodes.length, 1);
});

test('malformed images and decoder failure leave no blank nodes', async () => {
  const h = await harness();
  await h.send({ type: 'insert', settings: DEFAULTS, bytes: new Uint8Array([1, 2, 3]) });
  assert.equal(h.nodes.length, 0);
  assert.equal(h.messages.at(-1)?.type, 'error');
  h.failImage();
  await h.insert();
  assert.equal(h.nodes.length, 0);
});

test('locked cloud cannot be updated', async () => {
  const h = await harness();
  await h.insert();
  h.nodes[0].locked = true;
  await h.send({ type: 'update', targetId: 'cloud-0', settings: DEFAULTS, bytes: h.png });
  assert.equal(h.messages.at(-1)?.type, 'error');
});

test('slow client storage does not drop the next insert after done', async () => {
  const h = await harness();
  const release = h.holdStorage();
  const first = h.insert();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = h.insert();
  try {
    assert.equal(h.nodes.length, 2);
  } finally {
    release();
    await Promise.all([first, second]);
  }
});

test('an external Figma resize cannot be silently reverted by stale controls', async () => {
  const h = await harness();
  await h.insert();
  h.nodes[0].width = 555;
  await h.send({
    type: 'update',
    targetId: 'cloud-0',
    targetSize: { width: 1000, height: 700 },
    settings: DEFAULTS,
    bytes: h.png,
  });
  assert.equal(h.nodes[0].width, 555);
  assert.equal(h.messages.at(-1)?.type, 'error');
});

test('stored cloud recipes never retain preview or legacy sky backgrounds', async () => {
  const h = await harness();
  await h.send({
    type: 'insert',
    settings: { ...DEFAULTS, background: 'sky', sky: '#FF0000' },
    bytes: h.png,
  });
  const data = JSON.parse(
    (h.nodes[0].getPluginData as (key: string) => string)('clouds-recipe-v1'),
  );
  assert.equal(data.settings.background, 'transparent');
  assert.equal(data.settings.sky, DEFAULTS.sky);
});

test('written recipes use current version, relaunch metadata and a single resize', async () => {
  const h = await harness();
  await h.insert();
  const recipe = JSON.parse(
    (h.nodes[0].getPluginData as (key: string) => string)('clouds-recipe-v1'),
  );
  assert.equal(recipe.version, 2);
  assert.equal(h.resizeCalls(), 1);
  assert.equal((h.nodes[0].relaunch as Record<string, string>).edit, 'Edit cloud');
});

test('selection discovers nested image recipes and rejects future versions', async () => {
  const h = await harness();
  await h.insert();
  await h.insert();
  h.nodes[1].type = 'ELLIPSE';
  const group = { id: 'group', type: 'GROUP', children: h.nodes, name: 'Group' };
  h.page.selection = [group, h.nodes[0]];
  await h.send({ type: 'selection-request' });
  assert.equal((h.messages.at(-1)?.selections as unknown[]).length, 2);
  assert.equal(h.messages.at(-1)?.selection, null);
  (h.nodes[0].setPluginData as (key: string, value: string) => void)(
    'clouds-recipe-v1',
    JSON.stringify({ version: 99, settings: DEFAULTS }),
  );
  h.nodes[1].fills = [];
  await h.send({ type: 'selection-request' });
  assert.equal((h.messages.at(-1)?.selections as unknown[]).length, 0);
  assert.match(String(h.messages.at(-1)?.selectionReason), /newer|unsupported/i);
});

test('legacy recipes migrate safely and inserts sit beside selected bounds', async () => {
  const h = await harness();
  const node = h.makeNode();
  node.resize(400, 300);
  node.x = 100;
  node.y = 80;
  node.fills = [{ type: 'IMAGE', imageHash: 'legacy' }] as never[];
  node.setPluginData('clouds-recipe-v1', JSON.stringify({ version: 1, settings: DEFAULTS }));
  h.page.selection = [node];
  await h.send({ type: 'selection-request' });
  assert.equal((h.messages.at(-1)?.selection as { width: number }).width, 400);
  await h.insert();
  assert.equal(h.nodes[1].x, 548);
  assert.equal(h.nodes[1].y, 80);
});

test('bulk update validates every target before mutation and rolls back failed changes', async () => {
  const h = await harness();
  await h.insert();
  await h.insert();
  h.page.selection = [...h.nodes];
  const items = h.nodes.map((n) => ({
    targetId: n.id,
    targetSize: { width: 1000, height: 700 },
    settings: { ...DEFAULTS, seed: 99 },
    bytes: h.png,
  }));
  await h.send({ type: 'update-many', items: [items[0], { ...items[1], bytes: [1] }] });
  assert.equal(h.messages.at(-1)?.type, 'error');
  const before = h.nodes.map((n) =>
    (n.getPluginData as (key: string) => string)('clouds-recipe-v1'),
  );
  h.failResize(String(h.nodes[1].id));
  await h.send({ type: 'update-many', items });
  assert.equal(h.messages.at(-1)?.type, 'error');
  assert.deepEqual(
    h.nodes.map((n) => (n.getPluginData as (key: string) => string)('clouds-recipe-v1')),
    before,
  );
  await h.send({ type: 'update-many', items });
  assert.equal(h.messages.at(-1)?.action, 'update-many');
  assert.equal((h.messages.at(-1)?.selections as unknown[]).length, 2);
});

test('scatter plans are bounded, deterministic and reject stale selections', async () => {
  const h = await harness();
  await h.send({ type: 'prepare-scatter', requestId: 'a', count: 4, settings: DEFAULTS });
  const first = h.messages.at(-1) as {
    type: string;
    planId: string;
    jobs: { settings: typeof DEFAULTS; x: number; y: number }[];
  };
  assert.equal(first.type, 'scatter-plan');
  assert.equal(first.jobs.length, 4);
  await h.send({ type: 'prepare-scatter', requestId: 'b', count: 4, settings: DEFAULTS });
  assert.deepEqual(h.messages.at(-1)?.jobs, first.jobs);
  await h.send({ type: 'prepare-scatter', requestId: 'c', count: 25, settings: DEFAULTS });
  assert.equal(h.messages.at(-1)?.type, 'error');
  assert.equal(h.messages.at(-1)?.requestId, 'c');
  const plan = h.messages.findLast((m) => m.type === 'scatter-plan')!;
  const items = (plan.jobs as typeof first.jobs).map((job) => {
    const bytes = new Uint8Array(h.png);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, Math.round(job.settings.width * job.settings.quality));
    view.setUint32(20, Math.round(job.settings.height * job.settings.quality));
    return { ...job, bytes };
  });
  h.page.selection = [h.makeNode()];
  await h.send({ type: 'insert-many', planId: plan.planId, items });
  assert.equal(h.messages.at(-1)?.type, 'error');
  assert.equal(h.nodes.length, 1);
});

test('custom presets enforce bounds and preferences survive ready', async () => {
  const h = await harness();
  await h.send({ type: 'save-preset', name: '  My cloud  ', settings: DEFAULTS });
  assert.equal(h.messages.at(-1)?.type, 'presets');
  const presets = h.messages.at(-1)?.presets as { id: string; name: string }[];
  assert.equal(presets[0].name, 'My cloud');
  await h.send({ type: 'save-preferences', seedLocked: true });
  await h.send({ type: 'ready' });
  assert.ok(h.messages.some((m) => m.type === 'presets' && m.seedLocked === true));
  await h.send({ type: 'save-preset', name: 'x'.repeat(49), settings: DEFAULTS });
  assert.equal(h.messages.at(-1)?.type, 'preset-error');
  await h.send({ type: 'delete-preset', id: presets[0].id });
  assert.equal((h.messages.at(-1)?.presets as unknown[]).length, 0);
});

test('random menu runs hidden headless insertion and closes on success', async () => {
  const h = await harness('random');
  assert.equal(h.shown[0].visible, false);
  await h.send({ type: 'ready' });
  assert.ok(h.messages.some((m) => m.type === 'headless-insert'));
  await h.insert();
  assert.equal(h.closed(), true);
});

test('scatter inserts planned images once and rolls back all created nodes on failure', async () => {
  const h = await harness();
  await h.send({ type: 'prepare-scatter', requestId: 'ok', count: 3, settings: DEFAULTS });
  const plan = h.messages.at(-1)!;
  const items = (plan.jobs as { settings: typeof DEFAULTS; x: number; y: number }[]).map((job) => {
    const bytes = new Uint8Array(h.png);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, Math.round(job.settings.width * job.settings.quality));
    view.setUint32(20, Math.round(job.settings.height * job.settings.quality));
    return { ...job, bytes };
  });
  h.failResize('cloud-1');
  await h.send({ type: 'insert-many', planId: plan.planId, items });
  assert.equal(h.nodes.length, 0);
  assert.equal(h.messages.at(-1)?.type, 'error');
  await h.send({ type: 'insert-many', planId: plan.planId, items });
  assert.equal(h.nodes.length, 3);
  assert.equal(h.messages.at(-1)?.action, 'insert-many');
  assert.equal((h.messages.at(-1)?.selections as unknown[]).length, 3);
  await h.send({ type: 'insert-many', planId: plan.planId, items });
  assert.equal(h.nodes.length, 3);
  assert.equal(h.messages.at(-1)?.type, 'error');
});

test('preset writes serialize, enforce twelve entries and reload in a new ready response', async () => {
  const h = await harness();
  await Promise.all(
    Array.from({ length: 13 }, (_, i) =>
      h.send({ type: 'save-preset', name: `Preset ${i}`, settings: { ...DEFAULTS, seed: i } }),
    ),
  );
  assert.equal(h.messages.at(-1)?.type, 'preset-error');
  await h.send({ type: 'ready' });
  const response = h.messages.findLast((m) => m.type === 'presets')!;
  assert.equal((response.presets as unknown[]).length, 12);
  assert.equal((h.storage['clouds-custom-presets-v1'] as unknown[]).length, 12);
});

test('headless failures show the UI and carry a useful error', async () => {
  const h = await harness('random');
  h.failImage();
  await h.insert();
  assert.equal(h.closed(), false);
  assert.equal(h.shown.at(-1)?.visible, true);
  assert.equal(h.messages.at(-1)?.type, 'error');
});

test('frame recipes and ancestor locks are recognized without accepting arbitrary images', async () => {
  const h = await harness();
  await h.insert();
  h.nodes[0].type = 'FRAME';
  h.nodes[0].children = [];
  h.nodes[0].parent = { id: 'parent', type: 'GROUP', locked: true, parent: null };
  await h.send({ type: 'selection-request' });
  assert.equal((h.messages.at(-1)?.selection as { locked: boolean }).locked, true);
  await h.send({ type: 'update', targetId: h.nodes[0].id, settings: DEFAULTS, bytes: h.png });
  assert.equal(h.messages.at(-1)?.type, 'error');
  (h.nodes[0].setPluginData as (key: string, value: string) => void)('clouds-recipe-v1', '');
  await h.send({ type: 'selection-request' });
  assert.equal(h.messages.at(-1)?.selection, null);
  assert.equal((h.messages.at(-1)?.selections as unknown[]).length, 0);
});

test('headless renderer failures reveal the generator UI', async () => {
  const h = await harness('random');
  await h.send({ type: 'headless-error', message: 'Rendering was canceled' });
  assert.equal(h.shown.at(-1)?.visible, true);
  assert.equal(h.messages.at(-1)?.message, 'Rendering was canceled');
  assert.equal(h.closed(), false);
});
