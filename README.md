# Clouds generator

An offline Figma Design plugin inspired by [beauhaus/Nephele](https://github.com/beauhaus/Nephele). Generate soft procedural clouds, reshape them in the preview, and regenerate them later from saved layer recipes.

## Install in Figma Desktop

The repository includes `manifest.json`, `code.js`, and `ui.html`; no build is required to try it.

1. Open a Figma Design file.
2. Choose **Plugins → Development → Import plugin from manifest…**.
3. Select this folder's `manifest.json`.
4. Run **Clouds generator → Open cloud generator**.

Close and rerun an already-open plugin after updating its build. The existing plugin ID is preserved. Selecting a generated cloud also exposes **Edit cloud** through Figma's relaunch controls. The **Insert random cloud** menu command renders through a hidden UI and inserts without opening the panel; errors reveal the panel.

## Shape and appearance

- Choose Cumulus, Cotton, Wispy, Haze, Storm, or Stratus, then adjust puffiness, softness, color, opacity, and texture.
- **Keep seed when switching presets** retains the current seed while comparing styles. The preference persists between sessions. **Shuffle** and **Variations** intentionally choose new seeds.
- **Edit shape**, or the curve icon in the preview, reveals five handles. Drag to push or pull nearby billows. Arrow keys nudge a focused handle; Shift moves farther; Esc cancels a drag. Each drag is one Undo step. **Reset shape** clears only handle edits.
- Shape handles fade while hovering over sliders, inputs, or the existing color picker. Active handle drags and keyboard editing remain visible.
- **Self shadows** adds directional interior shading. Amount and Light direction control it; 90° lights from above and 180° from the left. **Shadow style** switches between **Dark shading** and the default **Transparency mask**, which fades shadowed regions into transparency while preserving their color. Shadows are off by default.
- **Vertical color gradient**, enabled for new clouds by default, blends the cloud's main color toward a base tint. The gradient can be combined with either shadow style. Dark shading preserves the alpha silhouette; transparency masking reduces opacity in shaded areas.
- **Undo/Redo** tracks edits locally, grouping slider and shape drags into one step. Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z work outside text inputs. Selecting another cloud or inserting a new cloud starts a new history.

The full-size preview stays pinned while the controls scroll. A bottom divider and soft shadow fade in when content passes beneath it. Preview background color and checkerboard affect only this surface, never exported images or layer history.

## Presets and variations

**Saved presets** stores up to 12 named recipes, including shape, size, color, and lighting. Name the current recipe and choose **Save preset**. Select a saved tile to apply it; its trash button removes it. Data is stored in Figma client storage, not sent to a server.

**Variations** generates six seed previews from the current recipe on demand. Select a thumbnail to adopt that seed. Other appearance settings are retained.

## Insert and update

- **Insert cloud** places the cloud 48 pixels to the right of the selection's bounds, or at the viewport center when nothing is selected.
- Select a generated cloud and choose **Update selected** to replace its image in place. Update also works without changing any controls, so old clouds can be regenerated with the current renderer.
- Selecting several clouds changes the action to **Update N clouds**. Only edited fields are applied across the selection; each cloud retains its own seed, shape, size, and other untouched settings. An unchanged batch regenerates each original recipe. Up to 24 clouds and 32 million exported pixels are allowed per batch.
- Image-filled rectangles, ellipses, and frames with valid recipes are editable. Selecting a group or frame discovers its cloud descendants. Duplicate references are removed, ancestor locks are respected, and unrelated layers are ignored with an explanation. Arbitrary images without a cloud recipe are not treated as generated clouds.
  Cloud field is disabled in the shipped UI and controller. Its implementation remains in `src/scatter.ts`, guarded by `CLOUD_FIELD_ENABLED` in `src/features.ts`, for possible future use.

Batch actions validate every image and target before changing document nodes. A failed batch rolls back its changes. If the selection or dimensions change during rendering, update/scatter refuses the stale operation. Selection refreshes when returning to the plugin, preserving pending edits and the original update target.

Each insertion/update has a unique operation ID. If its completion message is missed, the UI asks for the recorded result without submitting the image again. A bounded confirmation timeout restores the controls with an explicit unknown-outcome message.

Rendering shows its current stage and elapsed time. **Cancel** stops pending export work and prevents its insertion or update. Cancel becomes unavailable once the completed images are sent to Figma for the short document-application step.

## Dimensions and export quality

Width changes the seeded billow count and spacing; height develops their upward growth. The original default silhouette is preserved until a shape control changes it. The generated cloud is tightly cropped and fitted to the requested dimensions, so extreme proportions still affect its appearance.

Quick sizes and the aspect-ratio lock simplify resizing. A separate 1×/2×/3× resolution multiplier changes PNG density without changing layer dimensions. Each export is limited to 4096 pixels per side and 16 megapixels. Aggregate batches are limited to 32 megapixels and 128 MB of encoded image data.

Clouds are transparent PNG image fills, not editable vector paths. Their versioned recipes are stored on the layer. Version 1 recipes migrate to version 2; existing recipes retain their saved lighting choices, and recipes predating these controls retain dark-shading/no-gradient behavior; malformed or future versions are reported explicitly rather than guessed.

## Rendering and UI implementation

The cloud uses a seeded ellipse silhouette, Gaussian blur, fractal noise, and displacement. This is an independent implementation inspired by Nephele's technique, not a pixel-identical port of its viewport-dependent CSS.

The preview uses a bounded canvas, a 500×350 geometry sample, and an eight-entry shape cache. Paint, lighting, background, and resolution changes reuse the geometry. Frame-coalesced edits keep one preview in flight and only the latest pending recipe. Same-size repaints reuse the canvas backing store.

Exports render the SVG again at output resolution. Quality ≥2 or an output side above 1200 pixels triggers full-filter-frame crop refinement up to 2048 pixels, retaining alpha-1 wisps and the union with the preview bounds. Preview lighting uses at most 240×180 samples; export lighting scales up to a 1024-pixel long side. Export shadow math runs in a bundled Worker, released on completion, failure, or cancellation. Lighting uses a continuous directional pass and warped gradient noise; base tint blends in linear light before shadow modulation.

Browser SVG decoding, canvas readback, and PNG encoding still use browser APIs outside the shadow worker. Progress yields between stages, cancellation is checked throughout, and canceled native work is discarded when it returns. Export limits and worker/canvas bounds keep resource usage predictable.

The interface uses bundled **FigUI3 11.1.4** components and Figma theme tokens. Its existing Editor fill picker is styled, not rebuilt. Undo/Redo are Lucide SVG assets. The build retains only needed component registrations plus their dependencies and prunes unrelated component CSS while preserving dynamic picker/Editor/Lab styles. No runtime CDN or network permission is required. These are Figma-style web components, not Figma's private internal widgets.

## Development

Node.js **22.13+ or 24+** is required by the upgraded tooling.

```sh
npm ci
npm run format
npm run check
npm run test:e2e
npm run build:verify
npm run package
```

- `check`: split typechecks, lint, unit tests, and build.
- `test:e2e`: browser rendering, responsiveness, preview/picker controls, procedural parity, shaping, integrated updates, high-resolution worker exports, FigUI3 integrity, and all new feature workflows.
- `build:verify`: compares two builds byte-for-byte.
- `build:check`: additionally fails if the build differs from committed `code.js` or `ui.html`; run after committing the intended build.
- `format:check`: checks Prettier formatting without changing files.
- `watch`: rebuilds controller, UI, and worker sources during development.

The controller typecheck has no DOM library; UI and worker contexts are checked separately. Browser tests use installed Google Chrome on macOS by default; set `CHROME_PATH` for another Chromium executable. No CI workflow is installed, as requested.

Build reports, screenshots, PNGs, test results, and the installable ZIP are written beneath **`out/artifacts/`**. Package staging is **`out/dist/`**. The entire `out/` directory is ignored and disposable; old `artifacts/` and `dist/` outputs are not automatically deleted. `npm run package` includes the manifest, current build, README, and third-party notices.

Tooling upgrades use compatible stable releases. TypeScript is on 6.0 because the current typescript-eslint parser declares support below 6.1; upgrading to TypeScript 7 requires compatible parser support first.

## Verification boundary

Unit tests cover normalization, migrations, deterministic generation, batching, transactional rollback, placement, relaunch metadata, menu commands, persistence, and memory limits. Integrated browser tests run the actual UI and controller with a simulated Figma API, checking real PNG replacement on selected nodes, message delivery, selection races, presets, variations, scatter, gradients, and cancellation.

Renderer checks cover original silhouette parity, transparent alpha, export-specific shadow sampling, worker cleanup, and high-resolution wisps. Visual checks supplement these tests. Live Figma canvas behavior and host-specific Worker policy still require verification in Figma itself.

## References

- [Nephele](https://github.com/beauhaus/Nephele), studied at commit `fe0338967426f15d9d9ed54b9bf7bbeb6d64ad43`.
- [FigUI3](https://github.com/rogie/figui3), by Rogie King; Core/Editor/Lab notices are in `THIRD_PARTY_NOTICES.md`.
- [Figma CSS variables and theming](https://developers.figma.com/docs/plugins/css-variables/).
- [Figma UI lifecycle](https://developers.figma.com/docs/plugins/creating-ui/).
