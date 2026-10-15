import { ResizeMotion } from './resize-motion';
import { resizeLocked } from './interaction';
import { cloudLayout, normalize, type Settings, type CropBounds } from './cloud';

type Gesture = {
  id: number;
  index: number;
  edge?: string;
  button: HTMLButtonElement;
  recipe: Settings;
  x: number;
  y: number;
  crop: CropBounds;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};
/** Edit procedural control points in the same coordinates as the visible mask. */
export class ShapeEditor {
  private recipe: Settings;
  private crop?: CropBounds;
  private active?: Gesture;
  private enabled = false;
  private buttons: HTMLButtonElement[] = [];
  private overlay: HTMLElement;
  private bounds: HTMLDivElement;
  private motion: ResizeMotion;
  private resizeButtons: HTMLButtonElement[] = [];
  constructor(
    private canvas: HTMLCanvasElement,
    private change: (patch: Partial<Settings>, commit?: boolean) => void,
    private reframe: () => void,
    private busy: () => boolean,
    initial: Settings,
  ) {
    this.recipe = initial;
    this.overlay = document.getElementById('shape-overlay')!;
    this.bounds = document.createElement('div');
    this.bounds.id = 'shape-bounds';
    this.bounds.setAttribute('aria-hidden', 'true');
    this.overlay.append(this.bounds);
    this.motion = new ResizeMotion(canvas, () => this.positionControls());
    const edges: Record<string, string> = {
      nw: 'top left',
      n: 'top',
      ne: 'top right',
      e: 'right',
      se: 'bottom right',
      s: 'bottom',
      sw: 'bottom left',
      w: 'left',
    };
    for (const [edge, label] of Object.entries(edges)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'resize-handle';
      button.dataset.resize = edge;
      button.setAttribute('aria-label', `Resize cloud ${label}`);
      button.setAttribute('aria-describedby', 'shape-help');
      button.title = `Resize ${label}; Shift keeps proportions`;
      button.addEventListener('pointerdown', (event) => this.start(event, -1, button, edge));
      button.addEventListener('lostpointercapture', () => this.finish());
      button.addEventListener('keydown', (event) => {
        if (this.busy() || !event.key.startsWith('Arrow')) return;
        const x = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const y = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (!(x && /[ew]/.test(edge)) && !(y && /[ns]/.test(edge))) return;
        event.preventDefault();
        this.finish();
        const step = event.shiftKey ? 10 : 1;
        this.change({
          width: this.recipe.width + (edge.includes('e') ? x : edge.includes('w') ? -x : 0) * step,
          height:
            this.recipe.height + (edge.includes('s') ? y : edge.includes('n') ? -y : 0) * step,
          preset: 'custom',
        });
      });
      this.overlay.append(button);
      this.resizeButtons.push(button);
    }
    for (let i = 0; i < 5; i++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shape-handle';
      button.dataset.point = String(i);
      button.setAttribute('aria-label', `Shape point ${i + 1}`);
      button.setAttribute('aria-describedby', 'shape-help');
      button.title = `Shape point ${i + 1}: drag or use arrow keys`;
      button.addEventListener('pointerdown', (event) => this.start(event, i, button));
      button.addEventListener('lostpointercapture', () => this.finish());
      button.addEventListener('keydown', (event) => {
        const directions: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const direction = directions[event.key];
        if (!direction || this.busy()) return;
        event.preventDefault();
        this.finish();
        const shape = this.recipe.shape.map((p) => ({ ...p })),
          step = event.shiftKey ? 0.05 : 0.01;
        shape[i].x += direction[0] * step;
        shape[i].y += direction[1] * step;
        this.change({ shape, preset: 'custom' });
      });
      this.overlay.append(button);
      this.buttons.push(button);
    }
    for (const id of ['shape-edit', 'shape-edit-preview'])
      document.getElementById(id)!.onclick = () => {
        if (this.busy()) return;
        this.finish();
        this.enabled = !this.enabled;
        if (this.enabled) window.scrollTo({ top: 0, behavior: 'instant' });
        this.sync(this.recipe);
      };
    document.getElementById('shape-reset')!.onclick = () => {
      this.finish();
      this.change({ shape: [] });
    };
    window.addEventListener('pointermove', (event) => {
      const drag = this.active;
      if (!drag || drag.id !== event.pointerId) return;
      if (!event.buttons) {
        this.finish();
        return;
      }
      event.preventDefault();
      if (drag.edge) {
        const dx = (2 * (event.clientX - drag.x)) / drag.width;
        const dy = (2 * (event.clientY - drag.y)) / drag.height;
        const sx = drag.edge.includes('e') ? dx : drag.edge.includes('w') ? -dx : 0;
        const sy = drag.edge.includes('s') ? dy : drag.edge.includes('n') ? -dy : 0;
        let size = {
          width: drag.recipe.width * (1 + sx),
          height: drag.recipe.height * (1 + sy),
        };
        if (event.shiftKey) {
          const axis = Math.abs(sx) >= Math.abs(sy) ? 'width' : 'height';
          size = resizeLocked(axis, size[axis], drag.recipe.width / drag.recipe.height);
        }
        this.change({ ...size, preset: 'custom' }, false);
        return;
      }
      const scale = cloudLayout(drag.recipe).shapeScale;
      const shape = drag.recipe.shape.map((p) => ({ ...p }));
      shape[drag.index].x += (((event.clientX - drag.x) / drag.width) * drag.crop.width) / scale.x;
      shape[drag.index].y +=
        (((event.clientY - drag.y) / drag.height) * drag.crop.height) / scale.y;
      this.change({ shape, preset: 'custom' }, false);
    });
    for (const type of ['pointerup', 'pointercancel'] as const)
      window.addEventListener(type, (event) => {
        if (event.pointerId === this.active?.id) this.finish();
      });
    window.addEventListener('blur', () => this.finish());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.finish();
    });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (this.active) {
        const { shape, preset, width, height } = this.active.recipe;
        this.change({ shape, preset, width, height }, false);
        this.finish();
      } else if (this.enabled) {
        this.enabled = false;
        this.sync(this.recipe);
      }
    });
    new ResizeObserver(() => this.positionControls()).observe(canvas);
    window.addEventListener('resize', () => {
      this.finish();
      this.motion.reset();
      this.position();
    });
  }
  get viewport() {
    return this.active?.edge ? undefined : this.active?.crop;
  }
  rendered(crop: CropBounds) {
    if (!this.active || this.active.edge) this.crop = crop;
    this.position();
  }
  sync(recipe: Settings) {
    if (
      !this.active &&
      (recipe.width !== this.recipe.width || recipe.height !== this.recipe.height)
    )
      this.motion.reset();
    this.recipe = recipe;
    this.overlay.hidden = !this.enabled || !this.crop;
    for (const id of ['shape-edit', 'shape-edit-preview']) {
      const control = document.getElementById(id)!;
      control.setAttribute('aria-pressed', String(this.enabled));
      control.toggleAttribute('selected', this.enabled);
    }
    document.getElementById('shape-help')!.hidden = !this.enabled;
    document
      .getElementById('shape-reset')!
      .toggleAttribute('disabled', this.busy() || !recipe.shape.some((p) => p.x || p.y));
    [...this.buttons, ...this.resizeButtons].forEach((b) => {
      b.disabled = this.busy();
    });
    this.position();
  }
  finish() {
    const drag = this.active;
    if (!drag) return;
    this.active = undefined;
    drag.button.classList.remove('dragging');
    if (drag.edge) this.motion.release(this.recipe.width / this.recipe.height);
    if (drag.button.hasPointerCapture(drag.id)) drag.button.releasePointerCapture(drag.id);
    this.change({}, true);
    this.reframe();
  }
  private contentRect() {
    const rect = this.motion.rect(),
      parent = this.overlay.getBoundingClientRect();
    return { ...rect, left: rect.left + parent.left, top: rect.top + parent.top };
  }
  private start(event: PointerEvent, index: number, button: HTMLButtonElement, edge?: string) {
    if (!event.isPrimary || event.button !== 0 || this.busy() || !this.crop) return;
    event.preventDefault();
    this.finish();
    if (edge) this.motion.hold();
    else this.motion.reset();
    const rect = this.contentRect();
    if (!rect.width || !rect.height) return;
    const parent = this.overlay.getBoundingClientRect();
    button.focus({ preventScroll: true });
    button.setPointerCapture(event.pointerId);
    this.active = {
      id: event.pointerId,
      index,
      edge,
      button,
      recipe: normalize(this.recipe),
      x: event.clientX,
      y: event.clientY,
      crop: { ...this.crop },
      width: rect.width,
      height: rect.height,
      centerX: rect.left - parent.left + rect.width / 2,
      centerY: rect.top - parent.top + rect.height / 2,
    };
    button.classList.add('dragging');
    // A pending tight-crop paint must not replace this gesture's frozen view.
    this.reframe();
  }
  private position() {
    const crop = this.viewport || this.crop;
    if (!crop) return;
    this.overlay.hidden = !this.enabled;
    const parent = this.overlay.getBoundingClientRect();
    const drag = this.active;
    if (drag?.edge) {
      // Keep the gesture's scale stable instead of auto-fitting every draft.
      // Cap growth to the stage; the preview container itself never resizes.
      const width = (drag.width * this.recipe.width) / drag.recipe.width;
      const height = (drag.height * this.recipe.height) / drag.recipe.height;
      const scale = Math.min(
        1,
        (2 * Math.max(1, Math.min(drag.centerX - 12, parent.width - drag.centerX - 12))) / width,
        (2 * Math.max(1, Math.min(drag.centerY - 44, parent.height - drag.centerY - 36))) / height,
      );
      this.motion.drag({
        left: drag.centerX - (width * scale) / 2,
        top: drag.centerY - (height * scale) / 2,
        width: width * scale,
        height: height * scale,
      });
    }
    this.positionControls();
  }
  private positionControls() {
    const crop = this.viewport || this.crop;
    if (!crop) return;
    const parent = this.overlay.getBoundingClientRect();
    const rect = this.contentRect();
    const left = rect.left - parent.left,
      top = rect.top - parent.top;
    Object.assign(this.bounds.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    for (const button of this.resizeButtons) {
      const edge = button.dataset.resize!;
      const x = edge.includes('w') ? 0 : edge.includes('e') ? 1 : 0.5;
      const y = edge.includes('n') ? 0 : edge.includes('s') ? 1 : 0.5;
      button.style.left = `${left + x * rect.width}px`;
      button.style.top = `${top + y * rect.height}px`;
    }
    cloudLayout(this.recipe).handles.forEach((point, i) => {
      // Keep the hit target reachable even when a strong pull leaves the viewport.
      const x = rect.left - parent.left + ((point.x - crop.x) / crop.width) * rect.width;
      const y = rect.top - parent.top + ((point.y - crop.y) / crop.height) * rect.height;
      this.buttons[i].style.left = `${Math.max(12, Math.min(parent.width - 12, x))}px`;
      this.buttons[i].style.top = `${Math.max(30, Math.min(parent.height - 24, y))}px`;
    });
  }
}
