import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const bundle = await build({
  stdin: {
    contents: "export * from './src/cloud';export * from './src/render';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'CloudProbe',
});
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const samples = [],
      pixels = [];
    for (const amount of [0, 50, 100]) {
      const settings = window.CloudProbe.normalize({
        ...window.CloudProbe.DEFAULTS,
        bottomFlattening: amount,
      });
      const image = new Image();
      image.src = URL.createObjectURL(
        new Blob([window.CloudProbe.createSVG(settings, 600, 420)], { type: 'image/svg+xml' }),
      );
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 420;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      URL.revokeObjectURL(image.src);
      const data = ctx.getImageData(0, 0, 600, 420).data;
      pixels.push(data);
      let mass = 0;
      for (let i = 3; i < data.length; i += 4) mass += data[i];
      const bottoms = [],
        featherWidths = [];
      for (let x = 180; x < 420; x++) {
        let bottom = 0;
        for (let y = 0; y < 420; y++) if (data[(y * 600 + x) * 4 + 3] > 32) bottom = y;
        bottoms.push(bottom);
        let dense = 0,
          faint = 0;
        for (let y = 0; y < 420; y++) {
          const a = data[(y * 600 + x) * 4 + 3];
          if (a > 192) dense = y;
          if (a > 16) faint = y;
        }
        if (dense) featherWidths.push(faint - dense);
      }
      const average = bottoms.reduce((a, b) => a + b) / bottoms.length;
      const deviation = Math.sqrt(
        bottoms.reduce((a, b) => a + (b - average) ** 2, 0) / bottoms.length,
      );
      samples.push({
        amount,
        mass,
        deviation,
        feather: featherWidths.reduce((a, b) => a + b, 0) / featherWidths.length,
        bottom: Math.max(...bottoms),
        png: canvas.toDataURL(),
      });
    }
    let upperDifference = 0;
    for (let y = 0; y < 180; y++)
      for (let x = 0; x < 600; x++)
        upperDifference += Math.abs(
          pixels[0][(y * 600 + x) * 4 + 3] - pixels[2][(y * 600 + x) * 4 + 3],
        );
    return { samples, upperDifference };
  });
  await mkdir('out/artifacts/flatten', { recursive: true });
  await page.setViewportSize({ width: 1200, height: 330 });
  await page.setContent(
    `<body style="margin:0;background:#8CB8DA;font:14px system-ui;color:white;display:flex">${result.samples.map((s) => `<section style="width:400px"><p style="padding:0 20px">Flatten bottom · ${s.amount}%</p><img style="width:400px" src="${s.png}"></section>`).join('')}</body>`,
  );
  await page.screenshot({ path: 'out/artifacts/flatten/comparison.png' });
  for (const s of result.samples) {
    await writeFile(
      `out/artifacts/flatten/${s.amount}.png`,
      Buffer.from(s.png.split(',')[1], 'base64'),
    );
    delete s.png;
  }
  await writeFile('out/artifacts/flatten/results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  assert.ok(
    result.samples[2].deviation > 1.5,
    'The base must retain procedural irregularity rather than a horizontal cutoff',
  );
  assert.ok(
    result.samples[0].mass > result.samples[1].mass &&
      result.samples[1].mass > result.samples[2].mass,
    'Flattening progressively reduces the lower wisps',
  );
  assert.ok(
    result.samples[2].deviation < result.samples[0].deviation * 0.9,
    'Full flattening must produce a visibly flatter base',
  );
  assert.ok(
    result.upperDifference / (180 * 600) < 0.2,
    'Flattening preserves the upper silhouette and texture',
  );
  assert.ok(result.samples[2].feather > 5, 'The natural base retains a soft density falloff');
  const ui = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  ui.on('pageerror', (e) => errors.push(e.message));
  await ui.addInitScript(() => {
    window.messages = [];
    window.postMessage = (m) => window.messages.push(m.pluginMessage);
  });
  await ui.goto(pathToFileURL(path.resolve('ui.html')).href);
  const idle = () =>
    ui.waitForFunction(
      () =>
        document.querySelector('#cloud-preview').dataset.ready === 'true' &&
        document.querySelector('#preview-activity').textContent === 'Live',
    );
  await idle();
  const initial = await ui.locator('#cloud-preview').evaluate((c) => c.toDataURL());
  await ui.locator('#bottomFlattening fig-input-number input').fill('100');
  await ui.locator('#bottomFlattening fig-input-number input').press('Tab');
  await idle();
  const flattened = await ui.locator('#cloud-preview').evaluate((c) => c.toDataURL());
  assert.notEqual(flattened, initial);
  await ui.locator('#undo').click();
  await idle();
  assert.equal(await ui.locator('#cloud-preview').evaluate((c) => c.toDataURL()), initial);
  await ui.locator('#redo').click();
  await idle();
  assert.equal(await ui.locator('#cloud-preview').evaluate((c) => c.toDataURL()), flattened);
  await ui.locator('#self-shadows input').check();
  await idle();
  await ui.locator('#quality select').selectOption('1');
  await ui.locator('#insert').click();
  await ui.waitForFunction(() => window.messages.some((m) => m.type === 'insert'));
  const recipe = await ui.evaluate(() => window.messages.find((m) => m.type === 'insert').settings);
  assert.equal(recipe.bottomFlattening, 100);
  assert.equal(recipe.selfShadows, true);
  assert.deepEqual(errors, []);
  console.log('Plugin flatten slider, undo/redo and shaded export recipe: PASS');
} finally {
  await browser.close();
}
