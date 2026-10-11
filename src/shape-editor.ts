import { cloudLayout, normalize, type Settings, type CropBounds } from './cloud';

type Gesture = {
  id: number; index: number; button: HTMLButtonElement; recipe: Settings;
  x: number; y: number; crop: CropBounds; width: number; height: number;
};
/** Edit procedural control points in the same coordinates as the visible mask. */
export class ShapeEditor {
  private recipe: Settings;
  private crop?: CropBounds;
  private active?: Gesture;
  private enabled = false;
  private buttons: HTMLButtonElement[] = [];
  private overlay: HTMLElement;
  constructor(
    private canvas: HTMLCanvasElement,
    private change: (patch: Partial<Settings>, commit?: boolean) => void,
    private reframe: () => void,
    private busy: () => boolean,
    initial: Settings,
  ) {
    this.recipe = initial;
    this.overlay = document.getElementById('shape-overlay')!;
    for (let i = 0; i < 5; i++) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'shape-handle'; button.dataset.point = String(i);
      button.setAttribute('aria-label', `Shape point ${i + 1}`);
      button.setAttribute('aria-describedby', 'shape-help');
      button.title = `Shape point ${i + 1}: drag or use arrow keys`;
      button.addEventListener('pointerdown', event => this.start(event, i, button));
      button.addEventListener('lostpointercapture', () => this.finish());
      button.addEventListener('keydown', event => {
        const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const direction = directions[event.key];
        if (!direction || this.busy()) return;
        event.preventDefault(); this.finish();
        const shape = this.recipe.shape.map(p => ({ ...p })), step = event.shiftKey ? .05 : .01;
        shape[i].x += direction[0] * step; shape[i].y += direction[1] * step;
        this.change({ shape, preset: 'custom' });
      });
      this.overlay.append(button); this.buttons.push(button);
    }
    for (const id of ['shape-edit', 'shape-edit-preview']) document.getElementById(id)!.onclick = () => {
      if (this.busy()) return;
      this.finish(); this.enabled = !this.enabled;
      if (this.enabled) window.scrollTo({ top: 0, behavior: 'instant' });
      this.sync(this.recipe);
    };
    document.getElementById('shape-reset')!.onclick = () => {
      this.finish(); this.change({ shape: [] });
    };
    window.addEventListener('pointermove', event => {
      const drag = this.active;
      if (!drag || drag.id !== event.pointerId) return;
      if (!event.buttons) { this.finish(); return; }
      event.preventDefault();
      const scale = cloudLayout(drag.recipe).shapeScale;
      const shape = drag.recipe.shape.map(p => ({ ...p }));
      shape[drag.index].x += (event.clientX - drag.x) / drag.width * drag.crop.width / scale.x;
      shape[drag.index].y += (event.clientY - drag.y) / drag.height * drag.crop.height / scale.y;
      this.change({ shape, preset: 'custom' }, false);
    });
    for (const type of ['pointerup', 'pointercancel'] as const) window.addEventListener(type, event => {
      if (event.pointerId === this.active?.id) this.finish();
    });
    window.addEventListener('blur', () => this.finish());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.finish(); });
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (this.active) {
        const { shape, preset } = this.active.recipe;
        this.change({ shape, preset }, false); this.finish();
      } else if (this.enabled) { this.enabled = false; this.sync(this.recipe); }
    });
    new ResizeObserver(() => this.position()).observe(canvas);
  }
  get viewport() { return this.active?.crop; }
  rendered(crop: CropBounds) { if (!this.active) this.crop = crop; this.position(); }
  sync(recipe: Settings) {
    this.recipe = recipe;
    this.overlay.hidden = !this.enabled || !this.crop;
    for (const id of ['shape-edit', 'shape-edit-preview']) {
      const control = document.getElementById(id)!;
      control.setAttribute('aria-pressed', String(this.enabled)); control.toggleAttribute('selected', this.enabled);
    }
    document.getElementById('shape-help')!.hidden = !this.enabled;
    document.getElementById('shape-reset')!.toggleAttribute('disabled', this.busy() || !recipe.shape.some(p => p.x || p.y));
    this.buttons.forEach(b => { b.disabled = this.busy(); });
    this.position();
  }
  finish() {
    const drag = this.active;
    if (!drag) return;
    this.active = undefined;
    drag.button.classList.remove('dragging');
    if (drag.button.hasPointerCapture(drag.id)) drag.button.releasePointerCapture(drag.id);
    this.change({}, true); this.reframe();
  }
  private contentRect() {
    const r = this.canvas.getBoundingClientRect(), scale = Math.min(r.width / this.canvas.width, r.height / this.canvas.height);
    const width = this.canvas.width * scale, height = this.canvas.height * scale;
    return { left: r.left + (r.width - width) / 2, top: r.top + (r.height - height) / 2, width, height };
  }
  private start(event: PointerEvent, index: number, button: HTMLButtonElement) {
    if (!event.isPrimary || event.button !== 0 || this.busy() || !this.crop) return;
    event.preventDefault(); this.finish();
    const rect = this.contentRect();
    if (!rect.width || !rect.height) return;
    button.focus({ preventScroll: true }); button.setPointerCapture(event.pointerId);
    this.active = { id: event.pointerId, index, button, recipe: normalize(this.recipe), x: event.clientX, y: event.clientY,
      crop: { ...this.crop }, width: rect.width, height: rect.height };
    button.classList.add('dragging');
    // A pending tight-crop paint must not replace this gesture's frozen view.
    this.reframe();
  }
  private position() {
    const crop = this.viewport || this.crop;
    if (!crop) return;
    this.overlay.hidden = !this.enabled;
    const rect = this.contentRect(), parent = this.overlay.getBoundingClientRect();
    cloudLayout(this.recipe).handles.forEach((point, i) => {
      // Keep the hit target reachable even when a strong pull leaves the viewport.
      const x = rect.left - parent.left + (point.x - crop.x) / crop.width * rect.width;
      const y = rect.top - parent.top + (point.y - crop.y) / crop.height * rect.height;
      this.buttons[i].style.left = `${Math.max(12, Math.min(parent.width - 12, x))}px`;
      this.buttons[i].style.top = `${Math.max(30, Math.min(parent.height - 24, y))}px`;
    });
  }
}
