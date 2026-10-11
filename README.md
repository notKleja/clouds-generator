# Clouds generator

A local Figma Design plugin inspired by [beauhaus/Nephele](https://github.com/beauhaus/Nephele). Creates procedural, soft-edged clouds entirely offline.

## Install in Figma Desktop

The build is included; no terminal setup is needed to try it.

1. Open a Figma Design file.
2. Choose **Plugins → Development → Import plugin from manifest…**.
3. Select `manifest.json` in this folder.
4. Run **Plugins → Development → Clouds generator**.

If this starter plugin was already registered, close and rerun it to load the updated build. The original plugin ID is preserved.

## Use

- Pick Cumulus, Cotton, Wispy, Haze, Storm, or Stratus.
- Click **Edit shape** (or the curve icon in the preview) to reveal five handles. Drag to push or pull nearby billows. Arrow keys nudge a focused point; Shift moves farther. A drag is one Undo step; Esc cancels the current drag. **Reset shape** clears only the handle edits. Shapes are saved on inserted clouds and restored when selected.
- Adjust puffiness, softness, cloud color, opacity, or seed. **Shuffle** changes the seed without discarding your settings.
- Enable **Self shadows** for soft darker interiors, with Amount and Light direction controls. It is off by default; 90° lights from above and 180° from the left.
- Expand **Texture** for turbulence, noise frequency, detail, and spread.
- Use **Undo/Redo** to step through local edits. A slider drag is one history step; selecting another cloud or inserting a new copy starts a fresh history. Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z work when a text field is not being edited.
- Choose **Square**, **Wide**, or **Portrait** from Quick size, or enter dimensions directly. The chain button locks the current aspect ratio while either dimension changes.
- Width changes the number and spacing of seeded billows; height changes their upward growth. Set the cloud width and height, then choose a separate 1×/2×/3× resolution multiplier. Exports are limited to 4096 pixels per side and 16 megapixels.
- Use **Preview background** to choose a solid color with the styled FigUI3 picker, or enable **Transparent preview** for a checkerboard. These controls affect only the preview; PNG exports are always transparent.
- Click **Insert cloud**. To edit one later, select a generated cloud and reopen the plugin. **Update selected** applies the requested width and height while preserving its position. If it was resized externally while the plugin was open, reselect it first to refresh its dimensions.

The preview updates while sliders move, stays pinned at its full size while scrolling. Its Live/Updating indicator shows pending preview work. The checkerboard toggle remains available in the fixed preview header. Invalid output dimensions disable Insert/Update with an inline explanation; Update stays available for a recognized, unlocked selected cloud, including when you want to regenerate it without changing settings. The checkerboard toggle and background color affect only the preview surface; they do not enter cloud history or the saved layer recipe.

## UI components

Controls use bundled **FigUI3 11.1.4** components: `fig-slider`, `fig-input-number`, `fig-input-color`, `fig-switch`, `fig-dropdown`, `fig-field`, `fig-button`, `fig-footer`, and the existing `fig-fill-picker` from the Editor module. The supplied fill-picker is styled rather than reimplemented. Undo/Redo use Lucide SVG assets. The controls follow Figma UI3 styling and the host's light/dark theme tokens. No runtime CDN or network permission is needed.

These are reusable Figma-style web components, not Figma's internal editor widgets. Official PropsKit is currently documented for Figma-hosted generative plugins only. This deliverable retains the local development-plugin format and existing ID.

## Rendering and editability

Nephele's core technique is fractal noise displacing a blurred silhouette. This implementation uses a newly written seeded cluster of ellipses, SVG Gaussian blur, and explicit fractal-noise/displacement filters. It is inspired by the original approach, not a pixel-identical port of its viewport-dependent CSS.

Clouds are **PNG image fills**, not editable vector paths. Their versioned settings are stored on the Figma layer, so the plugin can regenerate them. Width/height regenerate the seeded silhouette before blur and turbulence: width changes billow count and spacing, while height develops the upper billows and base depth. The default 1000 × 700 recipe preserves the original plugin silhouette. The result is then tightly cropped and fitted to the requested layer dimensions, so extreme proportions still affect its appearance; this is not a physical cloud simulation. A cached alpha mask detects the visible bounds (alpha greater than 1/255) with a small edge guard, removing the old empty canvas margins. All PNG output retains transparency, including when reopening a legacy recipe that once included a sky. The resolution multiplier increases PNG pixel density without changing layer dimensions. Updating applies the dimensions shown in the plugin.

Optional self shadows use a bounded 2D optical-thickness estimate with a continuous directional pass and warped gradient noise. The light pass follows neighboring density samples instead of layering spaced shadow copies. Its proportions match the output so the light direction stays consistent when resizing. Shadows tint the interior without altering the alpha silhouette. The shading field is cached separately from the geometry, and zero strength produces the same output as disabling shadows.

## Development

Node.js 22 or newer recommended.

```sh
npm ci
npm run build
npm run watch
npm run check
npm run test:browser
npm run test:responsiveness
npm run test:preview-controls
npm run test:procedural
npm run test:shape
```

Browser tests use installed Google Chrome on macOS by default. Set `CHROME_PATH` to another compatible Chromium executable. They write screenshots, sample PNGs, and `artifacts/browser-results.json`. No Figma account is used by these tests.

The preview uses a bounded canvas and an eight-entry shape cache. Color, opacity, background, shadows and resolution changes reuse the mask; width/height edits generate a new mask in one pass; edits are coalesced on animation frames with one render in flight and only the latest pending recipe. Same-size repaints reuse the canvas backing store. Changing only export resolution does not repaint the preview. Exports re-render the SVG at final resolution rather than enlarging the preview bitmap.

Pointer capture keeps slider drags and number scrubbing active outside the control and plugin frame. Releasing, cancelling, losing focus, or hiding the page ends the gesture cleanly. Number scrubbing uses the existing FigUI3 Alt-drag behavior.

Source: `src/shape-editor.ts` (preview handles and gesture coordinates), `src/drag.ts` (pointer continuity), `src/settings.ts` (transparent export recipe boundary), `src/interaction.ts` (preview scheduler, local history and ratio helpers), `src/render.ts` (mask cache, alpha crop, preview and export), `src/cloud.ts` (recipe/rendering), `src/shadows.ts` (optional directional interior shading), `src/ui.ts`, `src/ui.html`, `src/ui.css` (panel), and `code.ts` (Figma controller). `scripts/build.mjs` bundles everything into `code.js` and `ui.html`. Edit source files, not the generated UI.

## Verification boundary

Automated tests cover settings validation, deterministic generation, image limits, insertion/update controller behavior using a Figma mock, selection races, persistence timing, actual browser PNG rendering, UI components, light/dark layouts, and full-size sticky preview scrolling. Shape tests cover live dragging, outside-frame pointer capture, cancellation, undo/redo, persisted edits, full-size sticky mode, and grabbing a handle while a delayed preview is pending. The procedural suite compares default alpha pixels against a fixture from the published baseline, verifies resized geometry differs from a bitmap stretch, and checks that shadows preserve transparency. Live Figma import and canvas behavior are left to the user as requested.

## References

- [Nephele](https://github.com/beauhaus/Nephele), studied at commit `fe0338967426f15d9d9ed54b9bf7bbeb6d64ad43`.
- [FigUI3](https://github.com/rogie/figui3), by Rogie King; upstream Core/Editor/Lab notices included in `THIRD_PARTY_NOTICES.md`.
- [Figma CSS variables and theming](https://developers.figma.com/docs/plugins/css-variables/).
- [Figma UI lifecycle](https://developers.figma.com/docs/plugins/creating-ui/).
- [Figma PropsKit availability](https://developers.figma.com/docs/figma-mcp-server/generative-plugins-and-shaders/).
