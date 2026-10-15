import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve('out/web', '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(path.resolve('out/web') + path.sep)) throw new Error('Invalid path');
    res.setHeader(
      'Content-Type',
      file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html',
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const reports = [];
try {
  for (const target of ['plugin', 'web', 'mobile']) {
    const page = await browser.newPage({
      viewport: target === 'web' ? { width: 1440, height: 960 } : { width: 390, height: 844 },
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(
      target === 'plugin'
        ? pathToFileURL(path.resolve('ui.html')).href
        : `http://127.0.0.1:${server.address().port}/`,
    );
    const idle = () =>
      page.waitForFunction(
        () =>
          document.querySelector('#cloud-preview').dataset.ready === 'true' &&
          document.querySelector('#preview-activity').textContent === 'Live' &&
          document.querySelector('#cloud-preview').getAnimations().length === 0,
      );
    const size = async () =>
      (await page.locator('#preview-size').innerText()).split(' × ').map(Number);
    const pixels = () => page.locator('#cloud-preview').evaluate((c) => c.toDataURL());
    await idle();
    await page.locator('#shape-edit-preview').click();
    assert.equal(
      await page.locator('[data-resize]').count(),
      8,
      'Shape editing must expose edge and corner resize handles',
    );
    assert.equal(
      await page.locator('#width, #height, #size-preset').count(),
      0,
      'Pixel size editing is replaced by the preview bounds',
    );
    const initial = await pixels();
    const drag = async (handle, dx, dy, cancel = false, shift = false) => {
      const locator = page.locator(`[data-resize="${handle}"]`),
        b = await locator.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      if (shift) await page.keyboard.down('Shift');
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 6 });
      assert.equal(await locator.evaluate((el) => el.hasPointerCapture(1)), true);
      await idle();
      const heldBounds = await page.locator('#shape-bounds').boundingBox();
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
      if (shift) await page.keyboard.up('Shift');
      await idle();
      assert.equal(await locator.evaluate((el) => el.hasPointerCapture(1)), false);
      return heldBounds;
    };
    await drag('e', -25, 0);
    const wide = await size();
    assert.ok(wide[0] < 1000);
    assert.equal(wide[1], 700);
    assert.notEqual(await pixels(), initial, 'Resizing must regenerate the cloud');
    const resized = await pixels();
    await page.locator('#undo').click();
    await idle();
    assert.deepEqual(await size(), [1000, 700]);
    assert.equal(await pixels(), initial, 'One undo restores the complete resize gesture');
    await page.locator('#redo').click();
    await idle();
    assert.equal(await pixels(), resized);
    await drag('se', -20, -12, true);
    assert.deepEqual(await size(), wide, 'Escape restores both dimensions');
    const beforeBounds = await page.locator('#shape-bounds').boundingBox();
    const heldBounds = await drag('se', -20, -12, false, true);
    assert.ok(
      heldBounds.width < beforeBounds.width - 5,
      'Proportional resizing visibly shrinks the box during the drag',
    );
    const proportional = await size();
    assert.ok(Math.abs(proportional[0] / proportional[1] - wide[0] / wide[1]) < 0.01);
    await page.locator('[data-resize="s"]').focus();
    await page.keyboard.press('ArrowDown');
    await idle();
    assert.equal((await size())[1], proportional[1] + 1);
    await page.locator('[data-point="2"]').focus();
    await page.keyboard.press('ArrowUp');
    await idle();
    assert.equal(await page.locator('#shape-reset').isDisabled(), false);
    await drag('w', 15, 0);
    assert.equal(
      await page.locator('#shape-reset').isDisabled(),
      false,
      'Resizing retains point edits',
    );
    await mkdir('out/artifacts/resize', { recursive: true });
    await page.screenshot({ path: `out/artifacts/resize/${target}.png` });
    assert.deepEqual(errors, []);
    reports.push({ target, size: await size(), result: 'PASS' });
    await page.close();
  }
  await writeFile('out/artifacts/resize/results.json', JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} finally {
  await browser.close();
  server.close();
}
