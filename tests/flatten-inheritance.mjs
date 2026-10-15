import { build } from 'esbuild';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const bundle = await build({
  stdin: { contents: "export * from './src/cloud';", resolveDir: process.cwd() },
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
  const results = await page.evaluate(async () => {
    const cases = {
      Defaults: {},
      'Low turbulence': { displacement: 30 },
      'High turbulence': { displacement: 240 },
      'Low frequency': { frequency: 0.004 },
      'High frequency': { frequency: 0.03 },
      'Low detail': { octaves: 1 },
      'High detail': { octaves: 8 },
      'Low softness': { softness: 3 },
      'High softness': { softness: 35 },
      'High spread': { spread: 50 },
      'Low puffiness': { puffiness: 20 },
      'Other seed': { seed: 398 },
    };
    async function raster(svg) {
      const image = new Image();
      image.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await image.decode();
      const c = document.createElement('canvas');
      c.width = 500;
      c.height = 350;
      const x = c.getContext('2d');
      x.drawImage(image, 0, 0);
      URL.revokeObjectURL(image.src);
      return x.getImageData(0, 0, 500, 350).data;
    }
    const results = [];
    for (const [name, patch] of Object.entries(cases)) {
      const s = window.CloudProbe.normalize({
        ...window.CloudProbe.DEFAULTS,
        bottomFlattening: 100,
        ...patch,
      });
      const actual = window.CloudProbe.createSVG(s, 500, 350);
      // Apply the user's ordinary blur/noise settings to the same base geometry.
      // Any hidden regional suppression or replacement noise must fail parity.
      const reference = new DOMParser().parseFromString(actual, 'image/svg+xml');
      reference.querySelector('filter').innerHTML =
        `<feGaussianBlur in="SourceGraphic" stdDeviation="${s.softness}" result="soft"/><feTurbulence type="fractalNoise" baseFrequency="${s.frequency}" numOctaves="${s.octaves}" seed="${s.seed}" result="noise"/><feDisplacementMap in="soft" in2="noise" scale="${s.displacement}" xChannelSelector="R" yChannelSelector="G"/>`;
      const a = await raster(actual),
        b = await raster(new XMLSerializer().serializeToString(reference));
      let maxDifference = 0,
        bottomDifference = 0;
      for (let i = 3; i < a.length; i += 4) {
        const d = Math.abs(a[i] - b[i]);
        maxDifference = Math.max(maxDifference, d);
        if (i >= 200 * 500 * 4) bottomDifference += d;
      }
      let bottomHash = 2166136261;
      for (let i = 200 * 500 * 4 + 3; i < a.length; i += 4)
        bottomHash = Math.imul(bottomHash ^ a[i], 16777619) >>> 0;
      results.push({ name, maxDifference, bottomDifference, bottomHash });
    }
    return results;
  });
  await mkdir('out/artifacts/flatten', { recursive: true });
  await writeFile('out/artifacts/flatten/inheritance.json', JSON.stringify(results, null, 2));
  for (const r of results)
    assert.equal(
      r.maxDifference,
      0,
      `${r.name}: the flattened base must inherit the ordinary procedural filter at full strength`,
    );
  for (const result of results.slice(1))
    assert.notEqual(
      result.bottomHash,
      results[0].bottomHash,
      `${result.name} must affect the rendered bottom`,
    );
  const variations = await page.evaluate(() =>
    [
      ['Flatten 100 · existing settings', {}],
      ['Turbulence · 240', { displacement: 240 }],
      ['Frequency · 0.030', { frequency: 0.03 }],
      ['Detail · 8', { octaves: 8 }],
      ['Softness · 35', { softness: 35 }],
      ['Puffiness · 20', { puffiness: 20 }],
    ].map(([label, patch]) => ({
      label,
      src:
        'data:image/svg+xml,' +
        encodeURIComponent(
          window.CloudProbe.createSVG(
            window.CloudProbe.normalize({
              ...window.CloudProbe.DEFAULTS,
              bottomFlattening: 100,
              ...patch,
            }),
            360,
            252,
          ),
        ),
    })),
  );
  await page.setViewportSize({ width: 1080, height: 590 });
  await page.setContent(
    `<body style="margin:0;background:#8CB8DA;font:14px system-ui;color:white;display:grid;grid-template-columns:repeat(3,360px)">${variations.map((v) => `<section><p style="padding:0 20px">${v.label}</p><img width="360" height="252" src="${v.src}"></section>`).join('')}</body>`,
  );
  await page.screenshot({ path: 'out/artifacts/flatten/inherited-sliders.png' });
  console.log(JSON.stringify({ result: 'PASS', cases: results }, null, 2));
} finally {
  await browser.close();
}
