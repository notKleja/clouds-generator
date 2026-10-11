import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 360, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const external = [];
page.on('request', req => { if (/^https?:/.test(req.url())) external.push(req.url()); });
await page.addInitScript(() => {
  window.messages = [];
  window.svgRenders = 0;window.previewPaints=0;
  const draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(...args){if(this.canvas.id==='cloud-preview')window.previewPaints++;return draw.apply(this,args);};
  const originalURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = blob => { if (blob.type === 'image/svg+xml') window.svgRenders++; return originalURL(blob); };
  window.postMessage = message => { window.messages.push(message.pluginMessage); };
  window.deliver = message => window.dispatchEvent(new MessageEvent('message', { source: window, data: { pluginMessage: message } }));
});
async function exportCloud(lateInit = false) {
  await page.evaluate(() => { window.messages = []; });
  await page.getByRole('button', { name: /Insert cloud/ }).click();
  if (lateInit) await page.evaluate(() => window.deliver({ type: 'init', settings: { seed: 12345 }, selection: null }));
  await page.waitForFunction(() => window.messages.some(m => m.type === 'insert'), { timeout: 20000 });
  const result = await page.evaluate(async () => {
    const msg = window.messages.find(m => m.type === 'insert');
    const url = URL.createObjectURL(new Blob([msg.bytes], { type: 'image/png' }));
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    let opaque = 0, transparent = 0, partial = 0;
    let left = image.width, right = -1, top = image.height, bottom = -1;
    for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) transparent++; else if (data[i] === 255) opaque++; else partial++; }
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (data[(y * image.width + x) * 4 + 3] > 1) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    URL.revokeObjectURL(url);
    window.deliver({ type: 'done', action: 'insert', selection: { id: 'test-cloud', name: 'Cloud', settings: msg.settings, locked: false } });
    return { bounds: { left, right, top, bottom }, width: image.width, height: image.height, corner: Array.from(data.slice(0, 4)), opaque, transparent, partial, bytes: Array.from(msg.bytes), settings: msg.settings };
  });
  return result;
}
try {
  await page.goto(pathToFileURL(path.resolve('ui.html')).href);
  await page.waitForFunction(() => document.querySelector('#cloud-preview').dataset.ready === 'true');
  assert.equal(await page.locator('.preset').count(), 6);
  assert.equal(await page.locator('.preset').evaluateAll(buttons => buttons.every(b => b.querySelector('span').getBoundingClientRect().bottom <= b.getBoundingClientRect().bottom)), true);
  assert.equal(await page.evaluate(() => Boolean(customElements.get('fig-slider') && customElements.get('fig-input-color') && customElements.get('fig-button'))), true);
  assert.equal(await page.getByRole('button', { name: 'Update selected' }).isDisabled(), true);
  await page.screenshot({ path: 'artifacts/plugin-light.png', fullPage: true });
  const first = await exportCloud(true);
  assert.equal(await page.locator('#seed input').inputValue(), String(first.settings.seed));
  assert.equal(first.width, 2000); assert.equal(first.height, 1400);
  assert.equal(first.corner[3], 0); assert.ok(first.opaque > 1000); assert.ok(first.transparent > 1000); assert.ok(first.partial > 1000);
  assert.ok(first.bounds.left / first.width < .04 && first.bounds.top / first.height < .04, 'Crop must remove outer padding');
  assert.ok(first.bounds.right / first.width > .96 && first.bounds.bottom / first.height > .96);
  await writeFile('artifacts/cumulus-2x.png', new Uint8Array(first.bytes));
  await page.locator('#quality select').selectOption('1');
  const second = await exportCloud(); assert.equal(second.width, 1000); assert.equal(second.height, 700);
  await page.waitForTimeout(200);
  const cachedRenders = await page.evaluate(() => window.svgRenders);
  const editStarted = Date.now();
  await page.locator('#width input').fill('800'); await page.locator('#width input').press('Tab');
  await page.locator('#height input').fill('240'); await page.locator('#height input').press('Tab');
  await page.locator('#quality select').selectOption('3');
  await page.waitForFunction(() => document.querySelector('#cloud-preview').width / document.querySelector('#cloud-preview').height > 3);
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => window.svgRenders) > cachedRenders, 'Procedural sizing must rebuild cloud geometry');
  const resizeInteractionMs = Date.now() - editStarted;
  const sized = await exportCloud();
  assert.equal(sized.width, 2400); assert.equal(sized.height, 720);
  assert.ok(sized.bounds.left / sized.width < .05 && sized.bounds.top / sized.height < .05);
  await writeFile('artifacts/wide-cloud-3x.png', new Uint8Array(sized.bytes));
  await page.locator('#quality select').selectOption('1');
  const beforeBurst = await page.evaluate(() => window.previewPaints);
  await page.evaluate(() => {
    const seed = document.querySelector('#seed');
    for (let value = 2000; value < 2040; value++) {
      seed.setAttribute('value', String(value)); seed.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForFunction(count => window.previewPaints === count + 1, beforeBurst);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.previewPaints), beforeBurst + 1, '40 rapid edits should coalesce into one preview render');
  const seed = await page.locator('#seed input').inputValue();
  await page.getByRole('button', { name: 'Shuffle' }).click();
  assert.notEqual(await page.locator('#seed input').inputValue(), seed);
  const hashes = new Set();
  for (const name of ['Cumulus', 'Cotton', 'Wispy', 'Haze', 'Storm', 'Stratus']) {
    await page.getByRole('button', { name: `${name} preset`, exact: true }).click();
    const cloud = await exportCloud(); assert.ok(cloud.opaque + cloud.partial > 1000);
    assert.ok(cloud.bounds.left / cloud.width < .05 && cloud.bounds.top / cloud.height < .05, `${name} crop padding`);
    assert.ok(cloud.bounds.right / cloud.width > .95 && cloud.bounds.bottom / cloud.height > .95, `${name} crop coverage`);
    hashes.add(Buffer.from(cloud.bytes).toString('base64'));
    await writeFile(`artifacts/${name.toLowerCase()}.png`, new Uint8Array(cloud.bytes));
  }
  assert.equal(hashes.size, 6);
  await page.locator('#transparent input').uncheck();
  await page.locator('#width input').fill('800'); await page.locator('#width input').press('Tab');
  await page.locator('#height input').fill('600'); await page.locator('#height input').press('Tab');
  const coloredPreview = await exportCloud(); assert.equal(coloredPreview.corner[3], 0);
  await page.locator('#transparent input').check();
  const checkerPreview = await exportCloud();
  assert.deepEqual(checkerPreview.bytes, coloredPreview.bytes, 'Preview backgrounds must not affect export');
  assert.equal(checkerPreview.settings.background, 'transparent');
  await page.locator('#width input').fill('4096'); await page.locator('#width input').press('Tab');
  await page.locator('#quality select').selectOption('3');
  assert.equal(await page.getByRole('button', { name: /Insert cloud/ }).isDisabled(), true);
  assert.match(await page.locator('#export-info').innerText(), /4096/);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.evaluate(settings => window.deliver({ type: 'selection', selection: { id: 'A', name: 'A', settings, locked: false } }), first.settings);
  await page.locator('#softness fig-input-number input').fill('40');
  await page.locator('#softness fig-input-number input').press('Tab');
  await page.evaluate(() => { window.messages = []; });
  await page.getByRole('button', { name: 'Update selected', exact: true }).click();
  await page.waitForFunction(() => window.messages.some(m => m.type === 'update'));
  await page.evaluate(settings => {
    window.deliver({ type: 'selection', selection: { id: 'B', name: 'B', settings: { ...settings, softness: 31, seed: 456 }, locked: false } });
    window.deliver({ type: 'init', settings, selection: { id: 'B', name: 'B', settings: { ...settings, softness: 31, seed: 456 }, locked: false } });
    window.deliver({ type: 'error', message: 'Selection changed' });
  }, first.settings);
  assert.equal(await page.locator('#softness fig-input-number input').inputValue(), '31');
  assert.equal(await page.locator('#seed input').inputValue(), '456');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    document.documentElement.classList.add('figma-dark');
    const style = document.createElement('style');
    style.textContent = ':root{--figma-color-bg:#2c2c2c;--figma-color-text:#fff;--figma-color-text-secondary:#ffffffb3;--figma-color-bg-secondary:#383838;--figma-color-border:#444;--figma-color-border-strong:#666;--figma-color-bg-hover:#383838;--figma-color-bg-brand:#0d99ff;--figma-color-text-onbrand:#fff}';
    document.head.append(style);
  });
  await page.screenshot({ path: 'artifacts/plugin-dark.png', fullPage: true });
  await page.locator('#texture summary').click();
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForFunction(() => window.scrollY > 48);
  await page.waitForFunction(() => document.querySelector('#preview').getBoundingClientRect().height === 202);
  const sticky = await page.locator('#preview-header').boundingBox();
  assert.equal(sticky.y, 0); assert.equal(sticky.height, 227);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({ path: 'artifacts/plugin-sticky.png' });
  assert.equal((await page.locator('#preview-header').boundingBox()).y, 0);
  assert.equal(Math.round((await page.locator('fig-footer').boundingBox()).y + (await page.locator('fig-footer').boundingBox()).height), 740);
  await page.screenshot({ path: 'artifacts/plugin-texture.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const summary = { result: 'PASS', checks: ['tight alpha bounds for all six presets', 'width/height change cloud proportions', 'resizing regenerates geometry; resolution remains independent', '40 rapid edits coalesce to one preview render', 'PNG transparency and soft alpha', '1x and 2x pixel dimensions', 'shuffle changes seed', 'late init preserves active recipe', 'overlapping selection and init race reloads correct recipe', 'preview backgrounds never affect transparent exports', 'export bounds', 'light/dark FigUI3 components', 'full-size preview stays pinned while scrolling', 'no horizontal overflow', 'no runtime errors', 'zero network requests'], performance: { sizeChangesRegenerateGeometry: true, previewRendersFor40RapidEdits: 1, resizeInteractionMs, maximumPreviewPixels: 120000 }, samples: { opaquePixels: first.opaque, transparentPixels: first.transparent, partialAlphaPixels: first.partial } };
  await writeFile('artifacts/browser-results.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally { await browser.close(); }
