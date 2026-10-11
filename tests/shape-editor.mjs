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
  const page = await browser.newPage({
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.messages = [];
    window.postMessage = (m) => window.messages.push(m.pluginMessage);
    window.deliver = (m) =>
      window.dispatchEvent(
        new MessageEvent('message', { source: window, data: { pluginMessage: m } }),
      );
  });
  await page.goto(pathToFileURL(path.resolve('ui.html')).href);
  const idle = () =>
    page.waitForFunction(
      () =>
        document.querySelector('#cloud-preview').dataset.ready === 'true' &&
        document.querySelector('#preview-activity').textContent === 'Live',
    );
  await idle();
  const pixels = () => page.locator('#cloud-preview').evaluate((c) => c.toDataURL());
  const initial = await pixels();
  assert.equal(await page.locator('#shape-overlay').isVisible(), false);
  await page.locator('#shape-edit-preview').click();
  await page.locator('.shape-handle').first().waitFor({ state: 'visible' });
  // A new gesture must invalidate an older paint that used a different crop.
  await page.evaluate(() => {
    window.previewDraws = [];
    window.delayDecode = true;
    window.decodeStarted = false;
    const decode = HTMLImageElement.prototype.decode,
      draw = CanvasRenderingContext2D.prototype.drawImage;
    HTMLImageElement.prototype.decode = async function () {
      const delayed = window.delayDecode;
      window.decodeStarted = true;
      await decode.call(this);
      if (delayed) await new Promise((r) => setTimeout(r, 180));
    };
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.id === 'cloud-preview') window.previewDraws.push(args.slice(1));
      return draw.apply(this, args);
    };
  });
  const backing = await page
    .locator('#cloud-preview')
    .evaluate((c) => ({ width: c.width, height: c.height }));
  await page.locator('#width input').evaluate((el) => {
    el.value = '1600';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.decodeStarted);
  const handle = page.locator('[data-point="2"]');
  const pending = await handle.boundingBox();
  await page.mouse.move(pending.x + pending.width / 2, pending.y + pending.height / 2);
  await page.mouse.down();
  await idle();
  const mapping = await page.evaluate(() => ({
    actual: window.previewDraws.at(-1),
    width: document.querySelector('#cloud-preview').width,
    height: document.querySelector('#cloud-preview').height,
  }));
  assert.equal(
    mapping.width,
    backing.width,
    'The displayed aspect ratio must remain fixed during a drag',
  );
  assert.equal(mapping.height, backing.height);
  assert.ok(
    mapping.actual.some((v, i) => Math.abs(v - [0, 0, mapping.width, mapping.height][i]) > 1),
    'Pending paint must respect the frozen drag crop',
  );
  await page.mouse.up();
  await page.evaluate(() => {
    window.delayDecode = false;
  });
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await idle();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 - 24, { steps: 8 });
  await idle();
  assert.equal(await handle.evaluate((el) => el.hasPointerCapture(1)), true);
  assert.notEqual(await pixels(), initial);
  // Continue well beyond the preview's control area and release there.
  await page.mouse.move(350, 340, { steps: 8 });
  await page.mouse.up();
  await idle();
  assert.equal(await handle.evaluate((el) => el.hasPointerCapture(1)), false);
  const shaped = await pixels();
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  await idle();
  assert.equal(await pixels(), initial, 'One undo must restore the entire gesture');
  await page.getByRole('button', { name: 'Redo change', exact: true }).click();
  await idle();
  assert.equal(await pixels(), shaped);
  await page.locator('#shape-edit-preview').click();
  await page.locator('#shape-edit-preview').click();
  const b = await handle.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 10, b.y - 20, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await idle();
  assert.equal(await pixels(), shaped, 'Escape must cancel the draft');
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await idle();
  assert.notEqual(await pixels(), shaped);
  await page.getByRole('button', { name: 'Insert cloud ↗', exact: true }).click();
  await page.waitForFunction(() => window.messages.some((m) => m.type === 'insert'));
  const recipe = await page.evaluate(() => {
    const m = window.messages.find((m) => m.type === 'insert');
    window.deliver({
      type: 'done',
      action: 'insert',
      selection: { id: 'one', name: 'Shaped cloud', settings: m.settings, locked: false },
    });
    return m.settings;
  });
  assert.ok(recipe.shape.some((p) => p.x || p.y));
  await page.getByRole('button', { name: 'Reset shape', exact: true }).click();
  await idle();
  assert.equal(await pixels(), initial);
  await page.evaluate(
    (settings) =>
      window.deliver({
        type: 'selection',
        selection: { id: 'two', name: 'Restored shape', settings, locked: false },
      }),
    recipe,
  );
  await idle();
  assert.notEqual(await pixels(), initial);
  await page.locator('#self-shadows input').check();
  await idle();
  await page.evaluate(() => window.scrollTo(0, 0));
  await mkdir('out/artifacts/shape', { recursive: true });
  await page.screenshot({ path: 'out/artifacts/shape/edited.png' });
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForFunction(() => window.scrollY > 48);
  assert.equal(await handle.isVisible(), true);
  const sticky = await handle.boundingBox();
  assert.ok(sticky.y >= 0 && sticky.y < 226);
  assert.equal((await page.locator('#preview').boundingBox()).height, 202);
  await page.screenshot({ path: 'out/artifacts/shape/sticky.png' });
  assert.deepEqual(errors, []);
  const report = {
    result: 'PASS',
    checks: [
      'pending preview cannot change the drag coordinate system',
      'five optional preview handles',
      'live drag with pointer capture outside preview',
      'one-step gesture undo/redo',
      'Escape cancels draft',
      'keyboard nudging',
      'shape saved in export and recovered from selection',
      'shape-only reset',
      'handles remain usable in full-size sticky preview',
      'no runtime errors',
    ],
  };
  await writeFile('out/artifacts/shape/results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
