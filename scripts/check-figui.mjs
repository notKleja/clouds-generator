import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
const bundle = JSON.parse(await readFile('out/artifacts/bundle.json', 'utf8'));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('ui.html')).href);
  await page.waitForFunction(
    () => document.querySelector('#cloud-preview').dataset.ready === 'true',
  );
  const missing = await page.evaluate(
    (tags) => tags.filter((tag) => !customElements.get(tag)),
    bundle.components,
  );
  assert.deepEqual(missing, [], 'Every retained dependency must register');
  assert.equal(
    await page.evaluate(() => !!customElements.get('fig-avatar')),
    false,
    'Unused component registration must be removed',
  );
  await page.locator('#color fig-swatch').click();
  await page.locator('.fig-fill-picker-dialog[open]').waitFor();
  const picker = await page.evaluate(() => {
    const dialog = document.querySelector('.fig-fill-picker-dialog[open]');
    const wheel = document.createElement('fig-input-wheel');
    document.body.append(wheel);
    const labStyle = getComputedStyle(wheel)
      .getPropertyValue('--fig-input-wheel-tick-width')
      .trim();
    wheel.remove();
    const unknown = [...dialog.querySelectorAll('*')]
      .map((el) => el.localName)
      .filter((tag) => tag.startsWith('fig-') && !customElements.get(tag));
    return { labStyle, unknown, editorStyled: getComputedStyle(dialog).position === 'fixed' };
  });
  assert.deepEqual(picker.unknown, [], 'Dynamically created picker elements must register');
  assert.ok(picker.labStyle, 'Lab stylesheet must be present for dynamically created components');
  assert.ok(picker.editorStyled, 'Editor dialog styles must survive CSS pruning');
  assert.deepEqual(errors, []);
  const report = { result: 'PASS', components: bundle.components.length, ...picker };
  await writeFile('out/artifacts/figui-results.json', JSON.stringify(report, null, 2) + '\n');
  console.log(report);
} finally {
  await browser.close();
}
