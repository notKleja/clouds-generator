import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const results = [];
try {
  for (const target of ['plugin', 'web', 'mobile']) {
    const page = await browser.newPage({
      viewport: target === 'web' ? { width: 1440, height: 960 } : { width: 390, height: 844 },
      reducedMotion: 'no-preference',
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(
      pathToFileURL(path.resolve(target === 'plugin' ? 'ui.html' : 'out/web/index.html')).href,
    );
    await page.waitForFunction(
      () =>
        document.querySelector('#preview-activity').textContent === 'Live' &&
        document.querySelector('#cloud-preview').dataset.ready === 'true',
    );
    await page.locator('#shape-edit-preview').click();
    const sample = (count = 18, event) =>
      page.evaluate(
        ({ count, event }) => {
          const collect = async () => {
            const frames = [];
            for (let i = 0; i < count; i++) {
              await new Promise(requestAnimationFrame);
              const c = document.querySelector('#cloud-preview').getBoundingClientRect(),
                b = document.querySelector('#shape-bounds').getBoundingClientRect();
              const canvas = document.querySelector('#cloud-preview');
              const visibleWidth =
                getComputedStyle(canvas).objectFit === 'fill'
                  ? c.width
                  : Math.min(c.width, (c.height * canvas.width) / canvas.height);
              const visibleX = c.x + (c.width - visibleWidth) / 2;
              frames.push({
                width: b.width,
                x: b.x,
                canvasWidth: c.width,
                alignment: Math.abs(visibleX - b.x) + Math.abs(visibleWidth - b.width),
              });
            }
            return frames;
          };
          if (event) {
            window.addEventListener(
              event,
              () => {
                window.motionFrames = collect();
              },
              { once: true },
            );
            return;
          }
          return collect();
        },
        { count, event },
      );
    const b = await page.locator('[data-resize="se"]').boundingBox();
    await page.mouse.move(b.x + 12, b.y + 12);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await sample(12, 'pointermove');
    await page.mouse.move(b.x - 13, b.y - 8);
    const dragging = await page.evaluate(() => window.motionFrames);
    assert.ok(
      Math.abs(dragging[1].width - dragging.at(-1).width) < 1,
      'Drag geometry must reach the pointer within two frames, without easing lag',
    );
    const held = await page.locator('#shape-bounds').boundingBox();
    await sample(18, 'pointerup');
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const released = await page.evaluate(() => window.motionFrames);
    assert.ok(
      Math.abs(released[0].width - held.width) < (released.at(-1).width - held.width) * 0.65,
      'Release must start from the displayed size rather than jump to fitted size',
    );
    assert.ok(
      new Set(released.map((f) => Math.round(f.width * 10))).size >= 4,
      'Release must animate to the fitted size',
    );
    assert.ok(
      [...dragging, ...released.slice(0, -2)].every((f) => f.alignment < 2),
      'Bounds must follow the animated cloud',
    );
    const continuousHandle = await page.locator('[data-resize="e"]').boundingBox();
    await page.mouse.move(continuousHandle.x + 12, continuousHandle.y + 12);
    await page.mouse.down();
    await page.evaluate(() => {
      window.dragTimes = [];
      window.measureDrag = true;
      const tick = (now) => {
        if (!window.measureDrag) return;
        window.dragTimes.push(now);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.move(continuousHandle.x - 18, continuousHandle.y + 12, { steps: 24 });
    await page.mouse.move(continuousHandle.x + 12, continuousHandle.y + 12, { steps: 24 });
    const continuous = await page.evaluate(() => {
      window.measureDrag = false;
      const gaps = window.dragTimes
        .slice(1)
        .map((t, i) => t - window.dragTimes[i])
        .sort((a, b) => a - b);
      return {
        frames: window.dragTimes.length,
        p95FrameMs: gaps[Math.floor(gaps.length * 0.95)],
        maxFrameMs: gaps.at(-1),
        chasingAnimations: document.querySelector('#cloud-preview').getAnimations().length,
      };
    });
    assert.ok(
      continuous.frames >= 12,
      'The display must keep rendering during continuous resizing',
    );
    assert.equal(
      continuous.chasingAnimations,
      0,
      'Dragging must not queue easing animations behind the pointer',
    );
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        document.querySelector('#cloud-preview').getAnimations().length === 0 &&
        document.querySelector('#preview-activity').textContent === 'Live',
    );
    const next = await page.locator('[data-resize="se"]').boundingBox();
    await page.mouse.move(next.x + 12, next.y + 12);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(next.x + 2, next.y + 4);
    await sample(10);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const committedSize = await page.locator('#preview-size').innerText();
    assert.ok(await page.locator('#cloud-preview').evaluate((c) => c.getAnimations().length > 0));
    const moving = await page.locator('[data-resize="se"]').boundingBox();
    await page.mouse.move(moving.x + 12, moving.y + 12);
    await page.mouse.down();
    assert.equal(
      await page.locator('[data-resize="se"]').evaluate((b) => b.hasPointerCapture(1)),
      true,
      'A new drag takes over the release animation',
    );
    await page.mouse.move(moving.x + 2, moving.y + 4);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        document.querySelector('#cloud-preview').getAnimations().length === 0 &&
        document.querySelector('#preview-activity').textContent === 'Live',
    );
    assert.equal(await page.locator('#preview-size').innerText(), committedSize);
    assert.equal(
      await page.locator('#cloud-preview').evaluate((c) => c.style.length),
      0,
      'An interrupted animation must restore responsive layout',
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const r = await page.locator('[data-resize="e"]').boundingBox();
    await page.mouse.move(r.x + 12, r.y + 12);
    await page.mouse.down();
    await page.mouse.move(r.x - 8, r.y + 12);
    await page.mouse.up();
    assert.equal(
      await page.locator('#cloud-preview').evaluate((c) => c.getAnimations().length),
      0,
      'Reduced motion must not animate',
    );
    assert.deepEqual(errors, []);
    results.push({ target, result: 'PASS', continuous, dragging, released });
    await page.close();
  }
  await mkdir('out/artifacts/motion', { recursive: true });
  await writeFile('out/artifacts/motion/results.json', JSON.stringify(results, null, 2));
  console.log(results.map(({ target, result, continuous }) => ({ target, result, continuous })));
} finally {
  await browser.close();
}
