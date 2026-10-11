import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage({
    viewport: { width: 360, height: 740 },
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
  await page.waitForFunction(
    () => document.querySelector('#cloud-preview').dataset.ready === 'true',
  );
  assert.equal(await page.evaluate(() => !!customElements.get('fig-fill-picker')), true);
  assert.equal(await page.locator('#undo svg').count(), 1);
  assert.equal(await page.locator('#redo svg').count(), 1);
  const before = await page.locator('#cloud-preview').evaluate((c) => c.toDataURL());
  await page.locator('#sky fig-swatch').click();
  const dialog = page.locator('.fig-fill-picker-dialog[open]');
  await dialog.waitFor({ state: 'visible' });
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 361, 'Picker must fit plugin width');
  const fitted = await dialog.locator('.fig-fill-picker-color-area').evaluate((el) => {
    const c = el.querySelector('canvas').getBoundingClientRect(),
      r = el.getBoundingClientRect();
    return {
      canvasWidth: c.width,
      areaWidth: r.width,
      canvasHeight: c.height,
      areaHeight: r.height,
    };
  });
  assert.ok(
    Math.abs(fitted.canvasWidth - fitted.areaWidth) < 2 &&
      Math.abs(fitted.canvasHeight - fitted.areaHeight) < 2,
    'Color plane must fill its container',
  );
  for (const width of [260, 320]) {
    await dialog.evaluate((el, w) => {
      el.style.width = w + 'px';
    }, width);
    const fill = await dialog.locator('.fig-fill-picker-color-area').evaluate((el) => {
      const c = el.querySelector('canvas').getBoundingClientRect(),
        r = el.getBoundingClientRect();
      return [Math.abs(c.width - r.width), Math.abs(c.height - r.height)];
    });
    assert.ok(
      fill.every((n) => n < 2),
      'Color plane must resize with the picker',
    );
  }
  await dialog.evaluate((el) => {
    el.style.width = '';
  });
  await page.setViewportSize({ width: 300, height: 740 });
  await page.waitForFunction(() => {
    const r = document.querySelector('.fig-fill-picker-dialog[open]').getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth + 1;
  });
  await page.setViewportSize({ width: 360, height: 740 });

  await page.screenshot({ path: 'out/artifacts/preview-color-picker.png' });
  const hex = dialog.locator('.fig-fill-picker-ci-hex input');
  await hex.fill('26374A');
  await hex.press('Tab');
  assert.equal(
    (await page.locator('#sky').getAttribute('value')).slice(0, 7).toUpperCase(),
    '#26374A',
  );
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('#preview').evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(38, 55, 74)',
  );
  assert.equal(
    await page.locator('#cloud-preview').evaluate((c) => c.toDataURL()),
    before,
    'Preview backdrop must not rerender or change cloud pixels',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Undo change', exact: true }).isDisabled(),
    true,
    'Backdrop is not part of cloud undo history',
  );
  await page.locator('#transparent input').check();
  assert.equal(
    await page.locator('#preview').evaluate((el) => el.classList.contains('checker')),
    true,
  );
  await page.getByRole('button', { name: 'Insert cloud ↗', exact: true }).click();
  await page.waitForFunction(() => window.messages.some((m) => m.type === 'insert'));
  const recipe = await page.evaluate(() => {
    const m = window.messages.find((m) => m.type === 'insert');
    window.deliver({
      type: 'done',
      action: 'insert',
      selection: { id: 'one', name: 'Cloud', settings: m.settings, locked: false },
    });
    return m.settings;
  });
  assert.equal(recipe.background, 'transparent');
  assert.equal(await page.locator('#self-shadows input').isChecked(), false);
  assert.equal(await page.locator('#shadow-options').isVisible(), false);
  await page.locator('#self-shadows input').check();
  await page.waitForFunction(
    (previous) => document.querySelector('#cloud-preview').toDataURL() !== previous,
    before,
  );
  assert.equal(await page.locator('#shadow-options').isVisible(), true);
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  assert.equal(await page.locator('#self-shadows input').isChecked(), false);
  await page.getByRole('button', { name: 'Redo change', exact: true }).click();
  assert.equal(await page.locator('#self-shadows input').isChecked(), true);
  await page.locator('#shadowStrength input[type=range]').evaluate((el) => {
    el.value = '65';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Update selected', exact: true }).click();
  await page.waitForFunction(() => window.messages.some((m) => m.type === 'update'));
  const shadedRecipe = await page.evaluate(() => {
    const m = window.messages.find((m) => m.type === 'update');
    window.deliver({
      type: 'done',
      action: 'update',
      selection: { id: 'one', name: 'Cloud', settings: m.settings, locked: false },
    });
    return m.settings;
  });
  assert.equal(shadedRecipe.selfShadows, true);
  assert.equal(shadedRecipe.shadowStrength, 65);
  await page.locator('#color fig-swatch').click();
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('.fig-fill-picker-ci-hex input').fill('F4DCBC');
  await dialog.locator('.fig-fill-picker-ci-hex input').press('Tab');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Shuffle', exact: true }).click();
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Undo change', exact: true }).isDisabled(),
    false,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Redo change', exact: true }).isDisabled(),
    false,
  );
  await page.locator('.history-actions').screenshot({ path: 'out/artifacts/history-icons.png' });
  await page.screenshot({ path: 'out/artifacts/preview-controls-light.png' });
  await page.evaluate(() => document.documentElement.classList.add('figma-dark'));
  await page.locator('#color fig-swatch').click();
  await dialog.waitFor({ state: 'visible' });
  await page.screenshot({ path: 'out/artifacts/cloud-color-picker-dark.png' });
  assert.deepEqual(errors, []);
  const report = {
    result: 'PASS',
    checks: [
      'existing FigUI3 fill-picker component',
      'solid color mode',
      'color plane fills resized picker and fits narrow panels',
      'self shadows toggle, undo, redo and exported settings',
      'backdrop leaves cloud pixels and history unchanged',
      'transparent cloud recipe',
      'SVG undo/redo icons inspected in both-enabled state',
    ],
  };
  await writeFile('out/artifacts/preview-controls-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close();
}
