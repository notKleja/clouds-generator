import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const errors = [];
async function open(file) {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.messages = [];
    window.paints = [];
    window.backingWrites = 0;
    window.svgRenders = 0;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.id === 'cloud-preview') window.paints.push(performance.now());
      return draw.apply(this, args);
    };
    for (const key of ['width', 'height']) {
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key);
      Object.defineProperty(HTMLCanvasElement.prototype, key, {
        ...d,
        set(value) {
          if (this.id === 'cloud-preview') window.backingWrites++;
          d.set.call(this, value);
        },
      });
    }
    const url = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      if (b.type === 'image/svg+xml') window.svgRenders++;
      return url(b);
    };
    window.postMessage = (m) => window.messages.push(m.pluginMessage);
    window.deliver = (m) =>
      window.dispatchEvent(
        new MessageEvent('message', { source: window, data: { pluginMessage: m } }),
      );
  });
  await page.goto(pathToFileURL(path.resolve(file)).href);
  await page.waitForFunction(
    () => document.querySelector('#cloud-preview').dataset.ready === 'true',
  );
  return page;
}
async function sustained(page) {
  return page.evaluate(async () => {
    window.paints = [];
    window.backingWrites = 0;
    const start = performance.now(),
      input = document.querySelector('#puffiness');
    for (let i = 0; i < 30; i++) {
      input.setAttribute('value', String(30 + i * 2));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    }
    const during = window.paints.length;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    return {
      rendersDuringDrag: during,
      totalRenders: window.paints.length,
      firstPreviewMs: window.paints.length ? window.paints[0] - start : null,
      backingStoreWrites: window.backingWrites,
      finalValue: input.value,
    };
  });
}
try {
  let before = null;
  try {
    await readFile('/private/tmp/clouds-responsiveness-baseline-ui.html');
    const old = await open('/private/tmp/clouds-responsiveness-baseline-ui.html');
    before = await sustained(old);
    await old.close();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const page = await open('ui.html');
  const originalPreview = await page.locator('#cloud-preview').evaluate((c) => c.toDataURL());
  const after = await sustained(page);
  assert.ok(after.rendersDuringDrag >= 5, 'Preview must keep updating during input');
  assert.equal(Number(after.finalValue), 88);
  assert.equal(after.backingStoreWrites, 0, 'Same-size edits must reuse the canvas backing store');
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  assert.equal(await page.locator('#puffiness fig-input-number input').inputValue(), '75');
  await page.getByRole('button', { name: 'Redo change', exact: true }).click();
  assert.equal(await page.locator('#puffiness fig-input-number input').inputValue(), '88');
  await page.evaluate(() => {
    document.querySelector('#reset').click();
    document.querySelector('#reset').click();
  });
  await page.waitForFunction(
    (original) => document.querySelector('#cloud-preview').toDataURL() === original,
    originalPreview,
  );
  await page.locator('#size-preset select').selectOption('wide');
  assert.equal(await page.locator('#width input').inputValue(), '1000');
  assert.equal(await page.locator('#height input').inputValue(), '400');
  await page.getByRole('button', { name: 'Lock aspect ratio', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: 'Lock aspect ratio', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.locator('#width input').fill('800');
  await page.locator('#width input').press('Tab');
  assert.equal(await page.locator('#height input').inputValue(), '320');
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  assert.equal(await page.locator('#width input').inputValue(), '1000');
  await page.getByRole('button', { name: 'Redo change', exact: true }).click();
  assert.equal(await page.locator('#width input').inputValue(), '800');
  await page.waitForTimeout(100);
  const count = await page.evaluate(() => window.paints.length),
    noise = await page.evaluate(() => window.svgRenders);
  await page.locator('#quality select').selectOption('1');
  await page.waitForTimeout(80);
  assert.equal(
    await page.evaluate(() => window.paints.length),
    count,
    'Resolution-only changes should not repaint',
  );
  assert.equal(await page.evaluate(() => window.svgRenders), noise);
  // New selection resets local history; local undo never reaches a different cloud's recipe.
  await page.evaluate(() =>
    window.deliver({
      type: 'selection',
      selection: {
        id: 'B',
        name: 'Cloud B',
        settings: {
          preset: 'cumulus',
          seed: 456,
          softness: 13,
          spread: 12,
          frequency: 0.011,
          displacement: 145,
          octaves: 5,
          puffiness: 75,
          color: '#FFFFFF',
          opacity: 100,
          width: 800,
          height: 400,
          quality: 2,
          background: 'transparent',
          sky: '#8CB8DA',
        },
        locked: false,
      },
    }),
  );
  assert.equal(
    await page.getByRole('button', { name: 'Undo change', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Update selected', exact: true }).isDisabled(),
    false,
    'A recognized selected cloud can be regenerated without changing a setting',
  );
  await page.getByRole('button', { name: 'Update selected', exact: true }).click();
  await page.waitForFunction(() => window.messages.some((m) => m.type === 'update'));
  const unchangedUpdate = await page.evaluate(() => {
    const m = window.messages.find((m) => m.type === 'update');
    window.deliver({
      type: 'done',
      action: 'update',
      selection: { id: 'B', name: 'Cloud B', settings: m.settings, locked: false },
    });
    return m;
  });
  assert.equal(unchangedUpdate.targetId, 'B');
  assert.equal(unchangedUpdate.settings.seed, 456);
  assert.equal(
    await page.getByRole('button', { name: 'Update selected', exact: true }).isDisabled(),
    false,
    'Regenerating a cloud must not latch Update disabled',
  );
  await page.locator('#seed input').fill('123');
  await page.locator('#seed input').press('Tab');
  assert.equal(
    await page.getByRole('button', { name: 'Undo change', exact: true }).isDisabled(),
    false,
  );
  await page.getByRole('button', { name: 'Insert cloud ↗', exact: true }).click();
  await page.waitForFunction(() => window.messages.some((m) => m.type === 'insert'));
  await page.evaluate(() => {
    const msg = window.messages.find((m) => m.type === 'insert');
    window.deliver({
      type: 'done',
      action: 'insert',
      selection: { id: 'copy-C', name: 'Cloud copy', settings: msg.settings, locked: false },
    });
  });
  assert.equal(
    await page.getByRole('button', { name: 'Undo change', exact: true }).isDisabled(),
    true,
  );

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'out/artifacts/enhanced-light.png' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => window.scrollY > 48);
  assert.equal((await page.locator('#preview').boundingBox()).height, 202);
  await page.getByRole('button', { name: 'Toggle preview checkerboard', exact: true }).click();
  assert.equal(
    await page.locator('#preview').evaluate((el) => el.classList.contains('checker')),
    true,
  );
  await page.evaluate(() => document.documentElement.classList.add('figma-dark'));
  await page.screenshot({ path: 'out/artifacts/enhanced-sticky.png' });
  assert.equal((await page.locator('#preview-header').boundingBox()).y, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  const report = {
    result: 'PASS',
    before,
    after,
    checks: [
      'continuous drag updates',
      'canvas backing-store reuse',
      'one-step gesture undo/redo',
      'ratio lock',
      'size presets',
      'export-resolution repaint skipped',
      'selection and inserted copies reset history',
      'repeated Reset keeps preview current',
      'unchanged selected cloud remains updateable',
      'full-size sticky preview controls remain accessible',
    ],
  };
  await writeFile('out/artifacts/responsiveness-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
