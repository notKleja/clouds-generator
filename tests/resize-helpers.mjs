/** Exercise the public bounding-box controls, including in an iframe. */
export async function cloudSize(page) {
  const [width, height] = (await page.locator('#preview-size').innerText())
    .split(' × ')
    .map(Number);
  return { width, height };
}
export async function setCloudSize(page, size) {
  const host = typeof page.mouse === 'object' ? page : page.page();
  const toggle = page.locator('#shape-edit-preview');
  const wasOpen = (await toggle.getAttribute('aria-pressed')) === 'true';
  if (!wasOpen) await toggle.click();
  for (const axis of ['width', 'height']) {
    if (size[axis] === undefined) continue;
    await page.waitForFunction(
      () => document.querySelector('#preview-activity').textContent === 'Live',
    );
    const current = await cloudSize(page);
    if (size[axis] === current[axis]) continue;
    const box = await page.locator('#shape-bounds').boundingBox();
    const handle = await page
      .locator(`[data-resize="${axis === 'width' ? 'e' : 's'}"]`)
      .boundingBox();
    const x = handle.x + handle.width / 2,
      y = handle.y + handle.height / 2;
    const delta = ((size[axis] / current[axis] - 1) * box[axis]) / 2;
    await host.mouse.move(x, y);
    await host.mouse.down();
    await host.mouse.move(x + (axis === 'width' ? delta : 0), y + (axis === 'height' ? delta : 0));
    await host.mouse.up();
    await page.waitForFunction(
      () => document.querySelector('#preview-activity').textContent === 'Live',
    );
  }
  if (!wasOpen) await toggle.click();
}
