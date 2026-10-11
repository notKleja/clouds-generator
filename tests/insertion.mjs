import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const host = await browser.newPage({ viewport: { width: 800, height: 820 } });
  await host.setContent(
    '<iframe id="plugin" name="plugin" style="width:360px;height:740px;border:0"></iframe><iframe id="relay" name="relay" hidden></iframe>',
  );
  const page = host.frame({ name: 'plugin' }),
    nodes = [],
    errors = [];
  let runtimeHTML = '',
    dropped = false,
    insertRequests = 0,
    statusRequests = 0,
    lastInsert;
  host.on('pageerror', (e) => errors.push(e.message));
  const currentPage = { selection: [] };
  const figma = {
    showUI(html) {
      runtimeHTML = html;
    },
    ui: {
      onmessage: null,
      show() {},
      postMessage(message) {
        if (message.type === 'done' && !dropped) {
          dropped = true;
          void host.evaluate(() => {
            window.droppedDone = true;
          });
          return;
        }
        void page.evaluate(
          (m) =>
            window.dispatchEvent(
              new MessageEvent('message', { source: parent.frames[1], data: { pluginMessage: m } }),
            ),
          message,
        );
      },
    },
    on() {},
    currentPage,
    viewport: { center: { x: 400, y: 300 }, scrollAndZoomIntoView() {} },
    notify() {},
    commitUndo() {},
    clientStorage: { getAsync: async () => undefined, setAsync: async () => {} },
    createImage() {
      return { hash: 'inserted-png' };
    },
    createRectangle() {
      const data = {},
        relaunch = {};
      const n = {
        id: `cloud-${nodes.length}`,
        type: 'RECTANGLE',
        name: '',
        locked: false,
        parent: null,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        fills: [],
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
      nodes.push(n);
      return n;
    },
  };
  vm.runInNewContext(await readFile('code.js', 'utf8'), {
    figma,
    __html__: await readFile('ui.html', 'utf8'),
    Uint8Array,
    console,
  });
  await host.exposeFunction('sendToController', (m) => {
    if (m.type === 'insert') {
      insertRequests++;
      lastInsert = m;
    }
    if (m.type === 'operation-status') statusRequests++;
    return figma.ui.onmessage(m);
  });
  await host.evaluate(() =>
    window.addEventListener('message', (event) => {
      if (event.source !== document.querySelector('#plugin').contentWindow) return;
      const m = event.data.pluginMessage;
      if (m)
        void window.sendToController({ ...m, ...(m.bytes ? { bytes: Array.from(m.bytes) } : {}) });
    }),
  );
  await host.locator('#plugin').evaluate((el, html) => {
    el.srcdoc = html;
  }, runtimeHTML);
  await page.waitForFunction(
    () => document.querySelector('#cloud-preview').dataset.ready === 'true',
  );
  assert.equal(await page.locator('#shadowMode select').inputValue(), 'transparency');
  assert.equal(await page.locator('#gradient-enabled input').isChecked(), true);
  assert.equal(await page.locator('#cloud-field').isVisible(), false);
  await page.locator('#width input').fill('128');
  await page.locator('#width input').press('Tab');
  await page.locator('#height input').fill('96');
  await page.locator('#height input').press('Tab');
  await page.locator('#quality select').selectOption('1');
  await page.getByRole('button', { name: 'Insert cloud ↗', exact: true }).click();
  await host.waitForFunction(() => window.droppedDone === true);
  assert.equal(nodes.length, 1);
  const otherSettings = {
    seed: 4321,
    width: 192,
    height: 128,
    quality: 1,
    color: '#ABCDEF',
    gradientEnabled: false,
    shadowMode: 'shade',
  };
  currentPage.selection = [
    {
      ...nodes[0],
      id: 'other-cloud',
      name: 'Other cloud',
      width: 192,
      height: 128,
      getPluginData: () => JSON.stringify({ version: 2, settings: otherSettings }),
    },
  ];
  await figma.ui.onmessage({ type: 'selection-request' });
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          pluginMessage: {
            type: 'done',
            bridgeSession: 'wrong-session',
            action: 'insert',
            selection: null,
          },
        },
      }),
    ),
  );
  assert.equal(
    await page.locator('body').evaluate((el) => el.classList.contains('busy')),
    true,
    'Unrelated message must not finish an operation',
  );
  await page.waitForFunction(
    () =>
      document.querySelector('#status').textContent.startsWith('Cloud inserted.') &&
      !document.body.classList.contains('busy'),
    null,
    { timeout: 7000 },
  );
  assert.equal(await page.locator('#seed input').inputValue(), '4321');
  assert.equal(await page.locator('#width input').inputValue(), '192');
  assert.equal(
    (await page.locator('#color').getAttribute('value')).slice(0, 7).toUpperCase(),
    '#ABCDEF',
  );
  assert.equal(insertRequests, 1);
  assert.ok(statusRequests >= 1);
  assert.equal(nodes.length, 1);
  assert.equal(await page.locator('#render-progress').isVisible(), false);
  await figma.ui.onmessage(lastInsert);
  assert.equal(nodes.length, 1, 'Duplicate delivery cannot insert twice');
  await host.close();
  // The host may complete before postMessage returns: success must not be overwritten.
  const fast = await browser.newPage({ viewport: { width: 360, height: 740 } });
  await fast.addInitScript(() => {
    window.postMessage = ({ pluginMessage: m }) => {
      if (m.type === 'ready')
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              pluginMessage: {
                type: 'init',
                selection: null,
                settings: { width: 128, height: 96, quality: 1 },
              },
            },
          }),
        );
      if (m.type === 'insert') {
        window.inserted = true;
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              pluginMessage: {
                type: 'done',
                requestId: m.requestId,
                action: 'insert',
                selection: { id: 'fast', name: 'Cloud', settings: m.settings, locked: false },
              },
            },
          }),
        );
      }
    };
  });
  await fast.goto(pathToFileURL(path.resolve('ui.html')).href);
  await fast.waitForFunction(
    () => document.querySelector('#cloud-preview').dataset.ready === 'true',
  );
  await fast.getByRole('button', { name: 'Insert cloud ↗', exact: true }).click();
  await fast.waitForFunction(() => window.inserted);
  assert.match(await fast.locator('#status').innerText(), /^Cloud inserted\./);
  assert.equal(await fast.locator('body').evaluate((el) => el.classList.contains('busy')), false);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        checks: [
          'actual insertion with dropped completion recovers without duplicate',
          'authenticated host relay outside parent is accepted',
          'wrong-session reply ignored',
          'recovery loads the current selection without carrying over the inserted recipe',
          'fast completion keeps success status',
          'progress and controls reset',
          'Cloud field disabled',
          'transparency and gradient defaults',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
