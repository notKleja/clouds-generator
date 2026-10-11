import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const file = process.argv[2] || 'ui.html';
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 840 } });
  await page.setContent(
    '<iframe id="plugin" name="plugin" style="position:absolute;left:20px;top:20px;width:360px;height:740px;border:0"></iframe>',
  );
  await page.locator('#plugin').evaluate(
    (el, html) => {
      el.srcdoc = html;
    },
    await readFile(file, 'utf8'),
  );
  const frame = page.frame({ name: 'plugin' });
  await frame.waitForFunction(
    () => document.querySelector('#cloud-preview')?.dataset.ready === 'true',
  );
  const input = frame.locator('#width input');
  await input.scrollIntoViewIfNeeded();
  await frame.evaluate(() => {
    window.outsideMoves = 0;
    document.addEventListener('pointermove', (e) => {
      if (e.clientX > innerWidth) window.outsideMoves++;
    });
  });
  const b = await input.boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  const captured = await frame
    .locator('#width')
    .evaluate((el) => el.hasPointerCapture(1) || el.querySelector('input').hasPointerCapture(1));
  await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2, { steps: 2 });
  const insideValue = await input.inputValue();
  await page.mouse.move(800, b.y + b.height / 2, { steps: 12 });
  const outsideValue = await input.inputValue();
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const result = {
    captured,
    insideValue,
    outsideValue,
    outsideMoves: await frame.evaluate(() => window.outsideMoves),
    captureAfterRelease: await frame.locator('#width').evaluate((el) => el.hasPointerCapture(1)),
  };
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  result.valueAfterReturn = await input.inputValue();
  if (!file.includes('/private/tmp')) {
    assert.equal(result.captured, true);
    assert.ok(result.outsideMoves > 0);
    assert.ok(Number(result.outsideValue) > Number(result.insideValue));
    assert.equal(result.captureAfterRelease, false);
    assert.equal(result.valueAfterReturn, result.outsideValue);
    const range = frame.locator('#puffiness input[type=range]');
    await range.scrollIntoViewIfNeeded();
    const r = await range.boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await frame.waitForFunction(
      () => document.querySelector('#puffiness input[type=range]').hasPointerCapture(1),
      null,
      { timeout: 3000 },
    );
    assert.equal(await range.evaluate((el) => el.hasPointerCapture(1)), true);
    await page.mouse.move(800, r.y + r.height / 2, { steps: 8 });
    assert.equal(Number(await range.inputValue()), 100);
    await page.mouse.move(r.x + r.width * 0.3, r.y + r.height + 70, { steps: 8 });
    assert.ok(
      Number(await range.inputValue()) < 60,
      'Slider drag should continue outside its track',
    );
    await page.mouse.up();
    assert.equal(await range.evaluate((el) => el.hasPointerCapture(1)), false);
    const keyStart = Number(await range.inputValue());
    await page.keyboard.press('ArrowRight');
    assert.equal(Number(await range.inputValue()), Math.min(100, keyStart + 1));
    const cancelStart = Number(await range.inputValue());
    await page.mouse.move(r.x + r.width * 0.8, r.y + r.height / 2);
    await page.mouse.down();
    await frame
      .locator('#puffiness input[type=range]')
      .evaluate((el) =>
        el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })),
      );
    await page.mouse.up();
    assert.equal(
      await frame.evaluate(() => document.documentElement.classList.contains('control-dragging')),
      false,
    );
    await frame.getByRole('button', { name: 'Undo change', exact: true }).click();
    assert.equal(Number(await range.inputValue()), cancelStart);

    await input.scrollIntoViewIfNeeded();
    const n = await input.boundingBox();
    await page.keyboard.down('Alt');
    await page.mouse.move(n.x + n.width / 2, n.y + n.height / 2);
    await page.mouse.down();
    await frame.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(
      await frame.evaluate(() => document.documentElement.classList.contains('control-dragging')),
      false,
    );
    assert.equal(await frame.locator('#width').evaluate((el) => el.hasPointerCapture(1)), false);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await frame.locator('#sky fig-swatch').scrollIntoViewIfNeeded();
    await frame.locator('#sky fig-swatch').click();
    const plane = frame.locator('.fig-fill-picker-dialog[open] .fig-fill-picker-color-area');
    await plane.waitFor({ state: 'visible' });
    const c = await plane.boundingBox();
    await page.mouse.move(c.x + c.width * 0.8, c.y + c.height * 0.4);
    await page.mouse.down();
    assert.equal(
      await frame.evaluate(() =>
        [...document.querySelectorAll('*')].some((el) => el.hasPointerCapture?.(1)),
      ),
      true,
    );
    await page.mouse.move(850, c.y + c.height * 0.4, { steps: 6 });
    const outsideColor = await frame.locator('#sky').getAttribute('value');
    await page.mouse.move(c.x + c.width * 0.2, c.y + c.height * 0.7, { steps: 6 });
    const returnedColor = await frame.locator('#sky').getAttribute('value');
    assert.notEqual(returnedColor, outsideColor);
    await page.mouse.up();
    assert.equal(
      await frame.evaluate(() =>
        [...document.querySelectorAll('*')].some((el) => el.hasPointerCapture?.(1)),
      ),
      false,
    );
    await page.keyboard.press('Escape');
    await frame.locator('#shape-edit-preview').click();
    await frame.waitForFunction(
      () => document.querySelector('#preview').getBoundingClientRect().height > 201,
    );
    const point = frame.locator('[data-point="2"]'),
      pointBox = await point.boundingBox();
    const beforeShape = await frame.locator('#cloud-preview').evaluate((c) => c.toDataURL());
    await page.mouse.move(pointBox.x + 12, pointBox.y + 12);
    await page.mouse.down();
    assert.equal(await point.evaluate((el) => el.hasPointerCapture(1)), true);
    await page.mouse.move(800, pointBox.y + 24, { steps: 10 });
    await page.mouse.up();
    await frame.waitForFunction(
      () => document.querySelector('#preview-activity').textContent === 'Live',
    );
    const afterShape = await frame.locator('#cloud-preview').evaluate((c) => c.toDataURL());
    assert.notEqual(afterShape, beforeShape);
    assert.equal(await point.evaluate((el) => el.hasPointerCapture(1)), false);
    await page.mouse.move(pointBox.x + 12, pointBox.y + 12);
    assert.equal(await frame.locator('#cloud-preview').evaluate((c) => c.toDataURL()), afterShape);
    const nextPoint = await point.boundingBox();
    await page.mouse.move(nextPoint.x + 12, nextPoint.y + 12);
    await page.mouse.down();
    await frame.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    assert.equal(await point.evaluate((el) => el.hasPointerCapture(1)), false);
    result.checks = [
      'shape drag and release outside iframe',
      'shape blur cleanup',
      'number scrub outside iframe',
      'slider outside track and iframe',
      'release outside frame',
      'blur and pointercancel cleanup',
      'range keyboard behavior',
      'cancelled drag commits one undo step',
      'existing picker drag capture and return',
    ];
  }
  console.log(JSON.stringify(result, null, 2));
  await writeFile(
    file.includes('/private/tmp')
      ? 'out/artifacts/drag-before.json'
      : 'out/artifacts/drag-after.json',
    JSON.stringify(result, null, 2),
  );
} finally {
  await browser.close();
}
