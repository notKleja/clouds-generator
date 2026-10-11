/** Pointer continuity for existing FigUI3 controls, including across an iframe boundary. */
export function installControlCapture(): void {
  type Drag = { element: HTMLElement; pointerId: number; kind: 'range' | 'number' };
  let active: Drag | undefined;
  const rangeValue = (drag: Drag, x: number) => {
    const input = drag.element as HTMLInputElement;
    const rect = input.getBoundingClientRect();
    const thumb = Math.min(rect.height, rect.width);
    const travel = rect.width - thumb;
    if (travel <= 0) return;
    let ratio = Math.max(0, Math.min(1, (x - rect.left - thumb / 2) / travel));
    if (getComputedStyle(input).direction === 'rtl') ratio = 1 - ratio;
    const min = input.min === '' ? 0 : Number(input.min);
    const max = input.max === '' ? 100 : Number(input.max);
    // Native range sanitization retains its own min/max/step rounding rules.
    const previous = input.value;
    input.value = String(min + ratio * (max - min));
    if (input.value !== previous) input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const finish = (cancel: boolean, notifyComponent = true) => {
    const drag = active;
    if (!drag) return;
    active = undefined;
    drag.element.removeEventListener('lostpointercapture', lost);
    document.documentElement.classList.remove('control-dragging');
    if (cancel && notifyComponent) {
      // Reuse the component's existing scrub finalizer for cursor/listener cleanup.
      drag.element.dispatchEvent(
        new PointerEvent('pointercancel', { bubbles: true, pointerId: drag.pointerId }),
      );
    }
    if (drag.kind === 'range') drag.element.dispatchEvent(new Event('change', { bubbles: true }));
    if (drag.element.hasPointerCapture(drag.pointerId))
      drag.element.releasePointerCapture(drag.pointerId);
  };
  const lost = () => finish(true);
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      const path = event
        .composedPath()
        .filter((node): node is HTMLElement => node instanceof HTMLElement);
      const range = path.find((node) => node.matches('fig-slider input[type="range"]'));
      const number = path.find((node) => node.matches('fig-input-number'));
      const scrubbing =
        number &&
        (event.altKey || path.some((node) => node.hasAttribute('slot') && number.contains(node)));
      const element = range || (scrubbing ? number : undefined);
      if (!element || element.hasAttribute('disabled')) return;
      if (active) finish(true);
      // Native range-thumb capture overrides application capture. Use the same input,
      // values and FigUI3 events, with stable capture instead of the UA drag session.
      if (range) {
        event.preventDefault();
        range.focus({ preventScroll: true });
      }
      try {
        element.setPointerCapture(event.pointerId);
        active = { element, pointerId: event.pointerId, kind: range ? 'range' : 'number' };
        element.addEventListener('lostpointercapture', lost);
        document.documentElement.classList.add('control-dragging');
        if (range) rangeValue(active, event.clientX);
      } catch {
        /* The browser may already have cancelled this pointer. */
      }
    },
    true,
  );
  window.addEventListener(
    'pointermove',
    (event) => {
      const drag = active;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (event.buttons === 0) {
        finish(true);
        return;
      }
      if (drag.kind === 'range') {
        event.preventDefault();
        rangeValue(drag, event.clientX);
      }
    },
    true,
  );
  window.addEventListener('pointerup', (event) => {
    if (event.pointerId === active?.pointerId) finish(false);
  });
  window.addEventListener('pointercancel', (event) => {
    if (event.pointerId === active?.pointerId) finish(true, false);
  });
  window.addEventListener('blur', () => finish(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finish(true);
  });
}
