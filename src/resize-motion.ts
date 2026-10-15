export type PreviewRect = { left: number; top: number; width: number; height: number };
/** Animate only presentation geometry; recipe edits and exports remain immediate. */
export class ResizeMotion {
  private animation?: Animation;
  private frame?: number;
  private originalStyle: string | null | undefined;
  private target?: PreviewRect;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  constructor(
    private canvas: HTMLCanvasElement,
    private changed: () => void,
  ) {
    this.reduced.addEventListener('change', () => this.reset());
  }
  rect(aspect = this.canvas.width / this.canvas.height): PreviewRect {
    const box = this.canvas.getBoundingClientRect();
    const parent = this.canvas.parentElement!.getBoundingClientRect();
    const width =
      this.canvas.style.objectFit === 'fill' ? box.width : Math.min(box.width, box.height * aspect);
    const height = this.canvas.style.objectFit === 'fill' ? box.height : width / aspect;
    return {
      left: box.left - parent.left + (box.width - width) / 2,
      top: box.top - parent.top + (box.height - height) / 2,
      width,
      height,
    };
  }
  hold() {
    const current = this.rect();
    if (this.originalStyle === undefined) this.originalStyle = this.canvas.getAttribute('style');
    this.cancel();
    this.write(current);
    this.changed();
  }
  drag(target: PreviewRect) {
    if (
      this.target &&
      Object.keys(target).every(
        (key) => target[key as keyof PreviewRect] === this.target![key as keyof PreviewRect],
      )
    )
      return;
    this.move(this.rect(), target, false);
  }
  release(aspect: number) {
    if (this.originalStyle === undefined) return;
    const from = this.rect();
    this.cancel();
    this.restore();
    const target = this.rect(aspect);
    this.move(from, target, true);
  }
  reset() {
    this.cancel();
    if (this.originalStyle !== undefined) this.restore();
    this.originalStyle = undefined;
    this.changed();
  }
  private write(rect: PreviewRect) {
    Object.assign(this.canvas.style, {
      inset: 'auto',
      transform: 'none',
      objectFit: 'fill',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }
  private restore() {
    if (this.originalStyle === null) this.canvas.removeAttribute('style');
    else if (this.originalStyle !== undefined)
      this.canvas.setAttribute('style', this.originalStyle);
  }
  private cancel() {
    this.animation?.cancel();
    this.animation = undefined;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.target = undefined;
  }
  private move(from: PreviewRect, target: PreviewRect, settling: boolean) {
    if (this.originalStyle === undefined) this.originalStyle = this.canvas.getAttribute('style');
    this.cancel();
    this.target = target;
    this.write(target);
    const distance =
      Math.abs(from.left - target.left) +
      Math.abs(from.top - target.top) +
      Math.abs(from.width - target.width) +
      Math.abs(from.height - target.height);
    if (this.reduced.matches || distance < 0.1) {
      if (settling) {
        this.restore();
        this.originalStyle = undefined;
      }
      this.changed();
      return;
    }
    const keyframe = (r: PreviewRect) => ({
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    const animation = this.canvas.animate([keyframe(from), keyframe(target)], {
      duration: settling ? 240 : 100,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
    });
    this.animation = animation;
    const tick = () => {
      if (this.animation !== animation) return;
      this.changed();
      this.frame = requestAnimationFrame(tick);
    };
    this.changed();
    this.frame = requestAnimationFrame(tick);
    animation.onfinish = () => {
      if (this.animation !== animation) return;
      this.animation = undefined;
      if (this.frame !== undefined) cancelAnimationFrame(this.frame);
      this.frame = undefined;
      if (settling) {
        this.restore();
        this.originalStyle = undefined;
        this.target = undefined;
      }
      this.changed();
    };
  }
}
