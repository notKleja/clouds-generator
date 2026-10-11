import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

await mkdir('out/artifacts', { recursive: true });
const worker = await build({
  entryPoints: ['src/shadow-worker.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const renderer = await build({
  stdin: {
    contents:
      "import {rasterize,paintPreview} from './src/render'; import {DEFAULTS,PRESETS} from './src/cloud'; window.renderer={rasterize,paintPreview,DEFAULTS,PRESETS};",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  define: { __SHADOW_WORKER__: JSON.stringify(worker.outputFiles[0].text) },
});
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(
    '<html><body style="margin:0;background:#6689aa;font:16px system-ui;color:white"><div id="gallery" style="display:grid;grid-template-columns:repeat(3,1fr)"></div></body></html>',
  );
  await page.addScriptTag({ content: renderer.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const { rasterize, paintPreview, DEFAULTS: currentDefaults, PRESETS } = window.renderer;
    const DEFAULTS = { ...currentDefaults, gradientEnabled: false, shadowMode: 'shade' };
    const NativeWorker = window.Worker;
    let created = 0,
      terminated = 0;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        created++;
      }
      terminate() {
        terminated++;
        super.terminate();
      }
    };
    const stages = [];
    const samples = [];
    const decode = async (bytes) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      return { url, image, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    const variants = [
      { name: 'Original', settings: { ...DEFAULTS } },
      { name: 'Export shadows', settings: { ...DEFAULTS, selfShadows: true, shadowStrength: 80 } },
      {
        name: 'Shadows + gradient',
        settings: {
          ...DEFAULTS,
          selfShadows: true,
          shadowStrength: 80,
          gradientEnabled: true,
          gradientColor: '#548CCD',
          gradientStrength: 75,
        },
      },
    ];
    let reference;
    for (const variant of variants) {
      const bytes = await rasterize(variant.settings, {
        onProgress: (stage) => stages.push(stage),
      });
      const decoded = await decode(bytes);
      let alphaMismatch = 0,
        differentColor = 0,
        partial = 0,
        edgeAlpha = 0;
      for (let i = 0; i < decoded.data.length; i += 4) {
        if (reference && reference[i + 3] !== decoded.data[i + 3]) alphaMismatch++;
        if (
          reference &&
          reference[i + 3] > 10 &&
          (reference[i] !== decoded.data[i] || reference[i + 2] !== decoded.data[i + 2])
        )
          differentColor++;
        if (decoded.data[i + 3] > 0 && decoded.data[i + 3] < 255) partial++;
      }
      for (let x = 0; x < decoded.image.width; x++)
        edgeAlpha +=
          decoded.data[x * 4 + 3] +
          decoded.data[((decoded.image.height - 1) * decoded.image.width + x) * 4 + 3];
      if (!reference) reference = decoded.data;
      const card = document.createElement('div');
      card.style.padding = '14px';
      card.innerText = variant.name;
      decoded.image.style.width = '100%';
      card.append(decoded.image);
      const preview = document.createElement('canvas');
      await paintPreview(preview, variant.settings, () => true);
      preview.style.width = '100%';
      card.append('Preview', preview);
      document.querySelector('#gallery').append(card);
      samples.push({
        name: variant.name,
        width: decoded.image.naturalWidth,
        height: decoded.image.naturalHeight,
        alphaMismatch,
        differentColor,
        partial,
        edgeAlpha,
      });
    }
    const wispy = {
      ...DEFAULTS,
      ...PRESETS.find((p) => p.id === 'wispy').settings,
      width: 1500,
      height: 500,
      quality: 2,
    };
    const wisps = await decode(await rasterize(wispy));
    const card = document.createElement('div');
    card.style.gridColumn = '1 / 4';
    card.style.padding = '14px';
    card.innerText = 'Large wispy export';
    wisps.image.style.width = '100%';
    card.append(wisps.image);
    document.querySelector('#gallery').append(card);
    const largeOneStages = [];
    const largeOne = await decode(
      await rasterize(
        { ...wispy, quality: 1 },
        { onProgress: (stage) => largeOneStages.push(stage) },
      ),
    );
    // Abort after the worker starts, on a later event-loop turn.
    const abort = new AbortController();
    let cancelName,
      cancelReturnedBytes = false;
    try {
      await rasterize(
        { ...DEFAULTS, selfShadows: true },
        {
          signal: abort.signal,
          onProgress: (stage) => {
            if (stage === 'Computing cloud lighting') setTimeout(() => abort.abort(), 15);
          },
        },
      );
      cancelReturnedBytes = true;
    } catch (error) {
      cancelName = error.name;
    }
    // Cancellation must also win while asynchronous PNG encoding is pending.
    const encodingAbort = new AbortController();
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      encodingAbort.abort();
      return nativeToBlob.apply(this, args);
    };
    let encodingCancelName;
    try {
      await rasterize({ ...DEFAULTS, quality: 1 }, { signal: encodingAbort.signal });
    } catch (error) {
      encodingCancelName = error.name;
    } finally {
      HTMLCanvasElement.prototype.toBlob = nativeToBlob;
    }
    return {
      samples,
      stages,
      largeOneStages,
      largeOne: { width: largeOne.image.naturalWidth, height: largeOne.image.naturalHeight },
      created,
      terminated,
      cancelName,
      cancelReturnedBytes,
      encodingCancelName,
      wispy: { width: wisps.image.naturalWidth, height: wisps.image.naturalHeight },
    };
  });
  assert.deepEqual(errors, []);
  assert.ok(result.created >= 3, 'Shaded exports must use real workers');
  assert.equal(result.created, result.terminated, 'Every worker must be released');
  assert.equal(result.cancelName, 'AbortError');
  assert.equal(result.cancelReturnedBytes, false);
  assert.equal(result.encodingCancelName, 'AbortError');
  assert.ok(result.stages.includes('Refining fine cloud edges'));
  for (const sample of result.samples) {
    assert.equal(sample.width, 2000);
    assert.equal(sample.height, 1400);
    assert.equal(sample.alphaMismatch, 0, `${sample.name} must preserve alpha exactly`);
    assert.ok(sample.partial > 1000, 'Soft cloud fringes must survive');
    assert.equal(sample.edgeAlpha, 0, 'Crop must keep transparent border above and below');
  }
  assert.ok(result.samples[1].differentColor > 1000);
  assert.ok(result.samples[2].differentColor > 1000);
  assert.deepEqual(result.wispy, { width: 3000, height: 1000 });
  assert.deepEqual(result.largeOne, { width: 1500, height: 500 });
  assert.ok(result.largeOneStages.includes('Refining fine cloud edges'));
  await page.screenshot({ path: 'out/artifacts/render-comparison.png', fullPage: true });
  await writeFile('out/artifacts/render-export-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
