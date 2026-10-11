import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const root = path.resolve('out/web'),
  prefix = '/clouds-generator/';
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html',
      file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const type = file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : file.endsWith('.html')
          ? 'text/html'
          : 'text/plain';
    res.writeHead(200, { 'Content-Type': type });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`,
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
      colorScheme: 'light',
    }),
    page = await context.newPage(),
    errors = [],
    external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith(base)) external.push(r.url());
  });
  await page.goto(base + prefix);
  await page.waitForFunction(
    () => document.querySelector('#cloud-preview').dataset.ready === 'true',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Download PNG', exact: true }).isVisible(),
    true,
  );
  assert.equal(await page.locator('#update').isVisible(), false);
  assert.equal(await page.locator('#cloud-field').isVisible(), false);
  assert.equal(await page.locator('#gradient-enabled input').isChecked(), true);
  await page.locator('#width input').fill('400');
  await page.locator('#width input').press('Tab');
  await page.locator('#height input').fill('300');
  await page.locator('#height input').press('Tab');
  await page.locator('#quality select').selectOption('2');
  await page.locator('#self-shadows input').check();
  await page.locator('#shadowMode select').selectOption('transparency');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const download = await downloading;
  const bytes = await readFile(await download.path());
  await page.waitForFunction(
    () =>
      document.querySelector('#status').textContent === 'PNG download started.' &&
      !document.body.classList.contains('busy'),
  );
  assert.equal(bytes.readUInt32BE(16), 800);
  assert.equal(bytes.readUInt32BE(20), 600);
  assert.match(download.suggestedFilename(), /800x600\.png$/);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('clouds-generator:web:v1')),
  );
  assert.equal(stored.draft.shadowMode, 'transparency');
  // Render the downloaded recipe directly through the shared engine: exact PNG parity.
  const probe = await build({
    stdin: {
      contents: "import {rasterize} from './src/render';window.engineRasterize=rasterize;",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
  });
  await page.addScriptTag({ content: probe.outputFiles[0].text });
  const direct = await page.evaluate(
    async (recipe) => Array.from(await window.engineRasterize(recipe)),
    stored.draft,
  );
  assert.deepEqual(
    bytes,
    Buffer.from(direct),
    'Web download must be exactly the shared renderer output',
  );
  const alpha = await page.evaluate(async (values) => {
    const image = new Image();
    image.src = URL.createObjectURL(new Blob([new Uint8Array(values)], { type: 'image/png' }));
    await image.decode();
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const x = c.getContext('2d');
    x.drawImage(image, 0, 0);
    const p = x.getImageData(0, 0, c.width, c.height).data;
    let transparent = 0,
      partial = 0;
    for (let i = 3; i < p.length; i += 4) {
      if (p[i] === 0) transparent++;
      else if (p[i] < 255) partial++;
    }
    URL.revokeObjectURL(image.src);
    return { transparent, partial };
  }, Array.from(bytes));
  assert.ok(alpha.transparent > 1000 && alpha.partial > 1000);
  let canceledDownloads = 0;
  page.on('download', () => {
    canceledDownloads++;
  });
  await page.evaluate(() => {
    window.pendingDecode = 0;
    window.originalDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      window.pendingDecode++;
      try {
        await window.originalDecode.call(this);
        await new Promise((resolve) => setTimeout(resolve, 300));
      } finally {
        window.pendingDecode--;
      }
    };
  });
  await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  await page.waitForFunction(() => window.pendingDecode > 0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(
    () => !document.body.classList.contains('busy') && window.pendingDecode === 0,
  );
  assert.equal(canceledDownloads, 0, 'Cancel must not trigger a browser download');
  assert.equal(await page.locator('#status').innerText(), 'Download canceled.');
  await page.evaluate(() => {
    HTMLImageElement.prototype.decode = window.originalDecode;
  });
  await page.locator('#seed-lock input').check();
  await page.locator('#saved-library summary').click();
  await page.locator('#preset-name').fill('Web morning');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await page.getByRole('button', { name: 'Apply saved preset Web morning', exact: true }).waitFor();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#width input')?.value === '400');
  assert.equal(await page.locator('#seed-lock input').isChecked(), true);
  await page.locator('#saved-library summary').click();
  await page.getByRole('button', { name: 'Apply saved preset Web morning', exact: true }).waitFor();
  await page.locator('#shape-edit-preview').click();
  const handle = page.locator('[data-point="2"]'),
    point = await handle.boundingBox();
  await page.mouse.move(point.x + 12, point.y + 12);
  await page.mouse.down();
  await page.mouse.move(point.x + 42, point.y - 12, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('#preview-activity').textContent === 'Live',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Undo change', exact: true }).isDisabled(),
    false,
  );
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  await page.locator('#sky fig-swatch').click();
  await page.locator('.fig-fill-picker-dialog[open]').waitFor();
  await page.locator('.fig-fill-picker-ci-hex input').fill('26435A');
  await page.locator('.fig-fill-picker-ci-hex input').press('Tab');
  await page.locator('.fig-fill-picker-ci-hex input').press('Escape');
  await mkdir('out/artifacts/web', { recursive: true });
  await page.screenshot({ path: 'out/artifacts/web/desktop.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.classList.contains('figma-dark'));
  await page.screenshot({ path: 'out/artifacts/web/dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => window.scrollTo(0, 0));
  const height = (await page.locator('#preview').boundingBox()).height;
  await page.evaluate(() => window.scrollTo(0, 600));
  assert.equal((await page.locator('#preview').boundingBox()).height, height);
  assert.ok((await page.locator('#preview-header').boundingBox()).y <= 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.ok((await page.locator('#plugin-footer').boundingBox()).y < 844);
  await page.screenshot({ path: 'out/artifacts/web/mobile.png' });
  await page.locator('#variation-library summary').click();
  await page.getByRole('button', { name: 'Generate 6 variations', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.variation:not(:disabled)').length === 6,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const report = {
    result: 'PASS',
    checks: [
      'real transparent PNG download at requested density',
      'byte-identical output to shared engine',
      'canceled export never starts a download',
      'draft and presets survive reload',
      'seed lock persists',
      'shape editing and undo',
      'styled color picker',
      'responsive desktop and sticky mobile preview',
      'system dark theme',
      'six variations',
      'project-subpath assets',
      'no external requests or browser errors',
    ],
    alpha,
  };
  await writeFile('out/artifacts/web/results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
