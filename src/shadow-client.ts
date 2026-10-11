import { estimateShadowsCooperatively, shadowPixels, type ShadowRequest } from './shadows';

declare const __SHADOW_WORKER__: string;
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Rendering canceled.', 'AbortError');
}
/** One worker per export: terminating it makes cancellation immediate and releases its buffers. */
export async function exportShadowPixels(
  request: ShadowRequest,
  signal?: AbortSignal,
): Promise<Uint8ClampedArray> {
  checkAbort(signal);
  if (typeof __SHADOW_WORKER__ !== 'undefined' && typeof Worker !== 'undefined') {
    const url = URL.createObjectURL(new Blob([__SHADOW_WORKER__], { type: 'text/javascript' }));
    let worker: Worker;
    try {
      worker = new Worker(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal?.removeEventListener('abort', abort);
        worker.terminate();
      };
      const abort = () => {
        cleanup();
        reject(new DOMException('Rendering canceled.', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = (event: MessageEvent<{ pixels?: ArrayBuffer; error?: string }>) => {
        cleanup();
        if (signal?.aborted) reject(new DOMException('Rendering canceled.', 'AbortError'));
        else if (event.data.pixels) resolve(new Uint8ClampedArray(event.data.pixels));
        else reject(new Error(event.data.error || 'Cloud lighting failed.'));
      };
      worker.onerror = (event) => {
        cleanup();
        reject(new Error(event.message || 'Cloud lighting failed.'));
      };
      try {
        worker.postMessage(request, [request.alpha]);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
  const field =
    request.strength > 0
      ? await estimateShadowsCooperatively(
          new Uint8ClampedArray(request.alpha),
          request.width,
          request.height,
          request.seed,
          request.angle,
          signal,
        )
      : new Float32Array(request.width * request.height);
  checkAbort(signal);
  const pixels = shadowPixels(
    field,
    request.color,
    request.strength,
    request.width,
    request.height,
    request.gradient,
  );
  checkAbort(signal);
  return pixels;
}
