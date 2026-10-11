/** One frame-aligned render at a time; new requests replace pending work. */
export class LatestPreview<T> {
  private pending: { value: T; epoch: number } | undefined;
  private running = false;
  private scheduled = false;
  private epoch = 0;
  constructor(
    private render: (value: T, current: () => boolean) => Promise<void>,
    private onError: (error: unknown) => void,
    private frame: (callback: () => void) => unknown = (callback) =>
      requestAnimationFrame(callback),
    private activity: (active: boolean) => void = () => {},
  ) {}
  request(value: T) {
    this.pending = { value, epoch: this.epoch };
    this.activity(true);
    this.schedule();
  }
  invalidate() {
    this.epoch++;
    this.pending = undefined;
    if (!this.running) this.activity(false);
  }
  private schedule() {
    if (this.running || this.scheduled || !this.pending) return;
    this.scheduled = true;
    this.frame(() => {
      this.scheduled = false;
      void this.run();
    });
  }
  private async run() {
    const work = this.pending;
    if (!work) return;
    this.pending = undefined;
    this.running = true;
    try {
      await this.render(work.value, () => work.epoch === this.epoch);
    } catch (error) {
      if (work.epoch === this.epoch) this.onError(error);
    } finally {
      this.running = false;
      if (this.pending) this.schedule();
      else this.activity(false);
    }
  }
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Draft edits do not enter history until their gesture commits. */
export class RecipeHistory<T extends object> {
  private entries: T[];
  private index = 0;
  constructor(
    initial: T,
    private limit = 30,
  ) {
    this.entries = [{ ...initial }];
  }
  matches(value: T) {
    return equal(value, this.entries[this.index]);
  }
  canUndo(draft: T) {
    return this.index > 0 || !this.matches(draft);
  }
  get canRedo() {
    return this.index < this.entries.length - 1;
  }
  commit(value: T) {
    if (this.matches(value)) return;
    this.entries.splice(this.index + 1);
    this.entries.push({ ...value });
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
  }
  undo(draft: T): T {
    if (this.matches(draft) && this.index > 0) this.index--;
    return { ...this.entries[this.index] };
  }
  redo(): T {
    if (this.canRedo) this.index++;
    return { ...this.entries[this.index] };
  }
  reset(value: T) {
    this.entries = [{ ...value }];
    this.index = 0;
  }
}
export function resizeLocked(
  axis: 'width' | 'height',
  value: number,
  ratio: number,
): { width: number; height: number } {
  const r = Number.isFinite(ratio) && ratio > 0 ? Math.max(1 / 64, Math.min(64, ratio)) : 1;
  let width = axis === 'width' ? value : value * r;
  width = Math.max(Math.max(64, 64 * r), Math.min(Math.min(4096, 4096 * r), width));
  return { width: Math.round(width), height: Math.round(width / r) };
}
