import { estimateShadows, shadowPixels } from './shadows';
import type { ShadowRequest } from './shadows';

self.onmessage = (event: MessageEvent<ShadowRequest>) => {
  try {
    const request = event.data;
    const field =
      request.strength > 0
        ? estimateShadows(
            new Uint8ClampedArray(request.alpha),
            request.width,
            request.height,
            request.seed,
            request.angle,
          )
        : new Float32Array(request.width * request.height);
    const pixels = shadowPixels(
      field,
      request.color,
      request.strength,
      request.width,
      request.height,
      request.gradient,
    );
    self.postMessage({ pixels: pixels.buffer }, { transfer: [pixels.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Cloud lighting failed.' });
  }
};
