import { cloudSize, setCloudSize } from './resize-helpers.mjs';
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const host = await browser.newPage({
      viewport: { width: 800, height: 860 },
      deviceScaleFactor: 1,
    }),
    errors = [];
  host.on('pageerror', (error) => errors.push(error.message));
  await host.setContent(
    '<iframe id="plugin" name="plugin" style="width:360px;height:800px;border:0"></iframe>',
  );
  const page = host.frame({ name: 'plugin' }),
    nodes = [],
    storage = new Map(),
    listeners = {};
  let serial = 0;
  let holdPreferences = false,
    holdPresets = false,
    releasePreferences,
    releasePresets;
  const preferenceBarrier = new Promise((resolve) => {
      releasePreferences = resolve;
    }),
    presetBarrier = new Promise((resolve) => {
      releasePresets = resolve;
    });
  function node(type = 'RECTANGLE', settings) {
    const data = {},
      relaunch = {};
    const n = {
      id: `node-${++serial}`,
      type,
      name: 'Cloud',
      parent: null,
      locked: false,
      x: 0,
      y: 0,
      width: 128,
      height: 96,
      fills: settings ? [{ type: 'IMAGE', imageHash: 'original', scaleMode: 'FIT' }] : [],
      get absoluteBoundingBox() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
      },
      resize(w, h) {
        this.width = w;
        this.height = h;
      },
      getPluginData: (k) => data[k] || '',
      setPluginData: (k, v) => {
        data[k] = v;
      },
      getRelaunchData: () => relaunch,
      setRelaunchData: (v) => Object.assign(relaunch, v),
      remove() {
        nodes.splice(nodes.indexOf(n), 1);
      },
    };
    if (type === 'FRAME') n.children = [];
    if (settings) {
      n.width = settings.width || 128;
      n.height = settings.height || 96;
      data['clouds-recipe-v1'] = JSON.stringify({ version: 1, settings });
    }
    nodes.push(n);
    return n;
  }
  const a = node('RECTANGLE', { preset: 'cumulus', seed: 501, width: 128, height: 96, quality: 1 }),
    b = node('ELLIPSE', {
      preset: 'cumulus',
      seed: 777,
      width: 96,
      height: 128,
      quality: 1,
      shape: [{ x: 0.1, y: 0 }],
    });
  b.x = 200;
  const currentPage = { selection: [a, b] };
  const deliver = (message) =>
    page.evaluate((m) => {
      window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: m } }));
      if (m.type === 'presets') window.presetMessages = (window.presetMessages || 0) + 1;
    }, message);
  const figma = {
    showUI() {},
    ui: {
      postMessage(message) {
        void deliver(message);
      },
      show() {},
      onmessage: null,
    },
    currentPage,
    on(event, fn) {
      listeners[event] = fn;
    },
    viewport: { center: { x: 500, y: 500 }, scrollAndZoomIntoView() {} },
    notify() {},
    commitUndo() {},
    closePlugin() {},
    clientStorage: {
      getAsync: async (key) => storage.get(key),
      setAsync: async (key, value) => {
        if (holdPreferences && key === 'clouds-preferences-v1') await preferenceBarrier;
        if (holdPresets && key === 'clouds-custom-presets-v1') await presetBarrier;
        storage.set(key, structuredClone(value));
      },
    },
    createImage: (bytes) => ({ hash: createHash('sha256').update(bytes).digest('hex') }),
    createRectangle: () => node(),
  };
  vm.runInNewContext(await readFile('code.js', 'utf8'), {
    figma,
    __html__: '',
    Uint8Array,
    console,
  });
  await host.exposeFunction('sendToController', (m) => figma.ui.onmessage(m));
  await host.evaluate(() =>
    window.addEventListener('message', (event) => {
      if (event.source !== document.querySelector('#plugin').contentWindow) return;
      const m = event.data.pluginMessage;
      if (!m) return;
      void window.sendToController({
        ...m,
        ...(m.bytes ? { bytes: Array.from(m.bytes) } : {}),
        ...(m.items
          ? { items: m.items.map((item) => ({ ...item, bytes: Array.from(item.bytes) })) }
          : {}),
      });
    }),
  );
  await host.locator('#plugin').evaluate(
    (el, html) => {
      el.srcdoc = html;
    },
    await readFile('ui.html', 'utf8'),
  );
  await page.waitForFunction(
    () => document.querySelector('#cloud-preview').dataset.ready === 'true',
  );
  const idle = () =>
    page.waitForFunction(
      () =>
        document.querySelector('#preview-activity').textContent === 'Live' &&
        !document.body.classList.contains('busy'),
    );
  await page.getByRole('button', { name: 'Update 2 clouds', exact: true }).waitFor();
  await page.locator('#softness fig-input-number input').fill('22');
  await page.locator('#softness fig-input-number input').press('Tab');
  await page.getByRole('button', { name: 'Update 2 clouds', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('#status').textContent === '2 clouds updated.',
  );
  for (const n of [a, b]) {
    assert.equal(JSON.parse(n.getPluginData('clouds-recipe-v1')).settings.softness, 22);
    assert.notEqual(n.fills[0].imageHash, 'original');
    assert.equal(n.getRelaunchData().edit, 'Edit cloud');
  }
  const second = JSON.parse(b.getPluginData('clouds-recipe-v1')).settings;
  assert.equal(second.seed, 777);
  assert.equal(second.width, 96);
  assert.equal(second.shape[0].x, 0.1);
  holdPreferences = true;
  holdPresets = true;
  await page.locator('#seed-lock input').check();
  await page.getByRole('button', { name: 'Cotton preset', exact: true }).click();
  assert.equal(await page.locator('#seed input').inputValue(), '501');
  assert.equal(await page.locator('#softness fig-input-number input').inputValue(), '19');
  await page.locator('#gradient-enabled input').check();
  await idle();
  assert.equal(await page.locator('#gradient-options').isVisible(), true);
  await page.locator('#saved-library summary').click();
  await page.locator('#preset-name').fill('Soft dawn');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  const priorResponses = await page.evaluate(() => window.presetMessages || 0);
  releasePreferences();
  await page.waitForFunction((count) => window.presetMessages > count, priorResponses);
  assert.equal(
    await page.locator('#preset-name').inputValue(),
    'Soft dawn',
    'Preference reply must not clear a pending preset name',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Save preset', exact: true }).isDisabled(),
    true,
  );
  releasePresets();
  await page.getByRole('button', { name: 'Apply saved preset Soft dawn', exact: true }).waitFor();
  assert.equal(storage.get('clouds-custom-presets-v1').length, 1);
  assert.equal(storage.get('clouds-custom-presets-v1')[0].settings.gradientEnabled, true);
  await page.locator('#gradient-enabled input').uncheck();
  await page.getByRole('button', { name: 'Apply saved preset Soft dawn', exact: true }).click();
  assert.equal(await page.locator('#gradient-enabled input').isChecked(), true);
  assert.equal(storage.get('clouds-preferences-v1').seedLocked, true);
  await page.locator('#variation-library summary').click();
  await page.getByRole('button', { name: 'Generate 6 variations', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.variation:not(:disabled)').length === 6,
  );
  await setCloudSize(page, { width: 160 });
  const oldSeed = await page.locator('#seed input').inputValue();
  await page.locator('.variation').nth(2).click();
  assert.notEqual(await page.locator('#seed input').inputValue(), oldSeed);
  assert.equal(
    String((await cloudSize(page)).width),
    '160',
    'Variation selection must adopt only its seed and preserve later edits',
  );
  await idle();
  // Keep a decode in flight to verify Cancel wins before any scene mutation.
  await page.evaluate(() => {
    window.pendingDecodes = 0;
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      window.pendingDecodes++;
      try {
        await original.call(this);
        await new Promise((r) => setTimeout(r, 350));
      } finally {
        window.pendingDecodes--;
      }
    };
  });
  const beforeCancel = nodes.length;
  await page.getByRole('button', { name: /Insert cloud ↗/ }).click();
  await page.waitForFunction(() => window.pendingDecodes > 0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(
    () => !document.body.classList.contains('busy') && window.pendingDecodes === 0,
  );
  assert.equal(nodes.length, beforeCancel);
  assert.match(await page.locator('#status').innerText(), /canceled/);
  assert.equal(await page.locator('#cloud-field').isVisible(), false);
  assert.equal(await page.locator('#scatter').getAttribute('disabled'), '');
  await page.getByRole('button', { name: 'Delete saved preset Soft dawn', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.saved-preset').length === 0);
  assert.equal(storage.get('clouds-custom-presets-v1').length, 0);
  await mkdir('out/artifacts', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await host.locator('#plugin').screenshot({ path: 'out/artifacts/features.png' });
  assert.deepEqual(errors, []);
  const report = {
    result: 'PASS',
    checks: [
      'all-selected updates retain per-cloud seeds, shapes and dimensions',
      'relaunch data',
      'seed lock',
      'correlated preset save acknowledgements and persistent presets',
      'six adoptable variations',
      'cancel prevents scene mutations',
      'Cloud field is hidden and disabled',
      'real controller and PNG pipeline',
      'no browser errors',
    ],
  };
  await writeFile('out/artifacts/features-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
