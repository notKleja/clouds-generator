import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.messages = [];
    window.postMessage = (m) => window.messages.push(m.pluginMessage);
    window.deliver = (m) =>
      window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: m } }));
  });
  await page.goto(pathToFileURL(path.resolve('ui.html')).href);
  await page.evaluate(() =>
    window.deliver({
      type: 'init',
      selection: null,
      settings: {
        preset: 'cumulus',
        seed: 992,
        width: 600,
        height: 420,
        quality: 2,
        color: '#FFFFFF',
        gradientEnabled: false,
        shadowMode: 'shade',
        selfShadows: true,
        shadowStrength: 100,
      },
    }),
  );
  const idle = () =>
    page.waitForFunction(
      () =>
        document.querySelector('#cloud-preview').dataset.ready === 'true' &&
        document.querySelector('#preview-activity').textContent === 'Live',
    );
  await idle();
  const preview = () =>
    page.locator('#cloud-preview').evaluate((c) => {
      const p = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let alpha = 0,
        gray = 0;
      for (let i = 0; i < p.length; i += 4) {
        alpha += p[i + 3];
        if (p[i + 3] > 20 && p[i] < 250) gray++;
      }
      return { alpha, gray };
    });
  const darkPreview = await preview();
  assert.ok(darkPreview.gray > 100);
  async function exported() {
    await page.evaluate(() => {
      window.messages = [];
    });
    await page.getByRole('button', { name: 'Insert cloud ↗', exact: true }).click();
    await page.waitForFunction(() => window.messages.some((m) => m.type === 'insert'));
    return page.evaluate(() => {
      const m = window.messages.find((m) => m.type === 'insert');
      window.deliver({
        type: 'done',
        action: 'insert',
        selection: {
          id: `saved-${m.settings.shadowMode}`,
          name: 'Cloud',
          settings: m.settings,
          locked: false,
        },
      });
      return { settings: m.settings, bytes: Array.from(m.bytes) };
    });
  }
  const dark = await exported();
  await page.locator('#shadowMode select').selectOption('transparency');
  await idle();
  const maskPreview = await preview();
  assert.ok(maskPreview.alpha < darkPreview.alpha * 0.95);
  assert.equal(maskPreview.gray, 0, 'Mask preview must retain the white cloud color');
  await page.locator('#shadowMode select').selectOption('shade');
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  await idle();
  assert.equal(await page.locator('#shadowMode select').inputValue(), 'transparency');
  await page.getByRole('button', { name: 'Redo change', exact: true }).click();
  await idle();
  assert.equal(await page.locator('#shadowMode select').inputValue(), 'shade');
  await page.locator('#shadowMode select').selectOption('transparency');
  await idle();
  const mask = await exported();
  assert.equal(mask.settings.shadowMode, 'transparency');
  const metrics = await page.evaluate(
    async ({ dark, mask }) => {
      async function decode(bytes) {
        const img = new Image();
        img.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(img.src);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      }
      const a = await decode(dark),
        b = await decode(mask);
      let reduced = 0,
        increased = 0,
        darkened = 0,
        alphaDifference = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (b[i + 3] < a[i + 3]) reduced++;
        if (b[i + 3] > a[i + 3]) increased++;
        if (b[i + 3] > 20 && Math.min(b[i], b[i + 1], b[i + 2]) < 254) darkened++;
        alphaDifference += a[i + 3] - b[i + 3];
      }
      return { reduced, increased, darkened, alphaDifference };
    },
    { dark: dark.bytes, mask: mask.bytes },
  );
  assert.ok(metrics.reduced > 10000);
  assert.equal(metrics.increased, 0);
  assert.equal(metrics.darkened, 0);
  await page.locator('#shadowMode select').selectOption('shade');
  await page.evaluate(
    (settings) =>
      window.deliver({
        type: 'selection',
        selection: { id: 'reopened-mask', name: 'Reopened cloud', settings, locked: false },
      }),
    mask.settings,
  );
  assert.equal(await page.locator('#shadowMode select').inputValue(), 'transparency');
  await idle();
  await mkdir('out/artifacts/shadow-mode', { recursive: true });
  await writeFile('out/artifacts/shadow-mode/dark.png', new Uint8Array(dark.bytes));
  await writeFile('out/artifacts/shadow-mode/transparency.png', new Uint8Array(mask.bytes));
  await page.locator('#shadow-options').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'out/artifacts/shadow-mode/controls.png' });
  assert.deepEqual(errors, []);
  const report = {
    result: 'PASS',
    metrics,
    checks: [
      'explicit dark shading remains supported',
      'preview switches from RGB shading to alpha masking',
      'high-resolution worker PNG removes opacity without darkening RGB',
      'undo/redo and reopened recipes retain mode',
      'no browser errors',
    ],
  };
  await writeFile('out/artifacts/shadow-mode/results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
