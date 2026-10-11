import { IS_WEB, sendHostMessage } from './platform';
import { CLOUD_FIELD_ENABLED } from './features';
import '@rogieking/figui3/src/fig.js';
import '@rogieking/figui3/src/fig-editor.js';
import { CloudLibrary } from './library-ui';
import { batchRecipes, presetRecipe } from './library';
import { ShapeEditor } from './shape-editor';
import { installControlCapture } from './drag';
import { cloudRecipe } from './settings';
import { LatestPreview, RecipeHistory, resizeLocked } from './interaction';
import { paintPreview, rasterize } from './render';
import { DEFAULTS, PRESETS, normalize, createSVG, exportSize, type Settings } from './cloud';

type SelectedCloud = {
  id: string;
  name: string;
  width?: number;
  height?: number;
  settings: Settings;
  locked: boolean;
};
type Selected = SelectedCloud | null;
type SelectionState = {
  selection: Selected;
  selections?: SelectedCloud[];
  selectionReason?: string;
};
type ScatterJob = { settings: Settings; x: number; y: number };
type RenderRun = {
  id: number;
  controller: AbortController;
  started: number;
  timer: ReturnType<typeof setInterval>;
  sent: boolean;
  requestId: string;
  sentAt: number;
  lastCheck: number;
};
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let settings = cloudRecipe(DEFAULTS);
let previewTransparent = false;
let previewColor = DEFAULTS.sky;
let selected: Selected = null;
let selectedClouds: SelectedCloud[] = [];
let selectionReason = '';
let deferredSelection: SelectionState | undefined;
let activeRun: RenderRun | undefined;
let runSequence = 0;
let pendingScatter: { requestId: string; run: RenderRun } | undefined;
let headless = false;
let busy = false,
  touched = false;
let lastPreviewKey = '';
const history = new RecipeHistory(settings);
let ratioLocked = false;
let lockedRatio = settings.width / settings.height;
const bridgeSession = document.querySelector<HTMLMetaElement>(
  'meta[name="clouds-session"]',
)?.content;
const post = sendHostMessage;
function status(text: string, error = false) {
  get('status').textContent = text;
  get('status').classList.toggle('error', error);
}
function controlsDisabled(value: boolean) {
  busy = value;
  document.body.classList.toggle('busy', value);
  document
    .querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
      'input,button,select',
    )
    .forEach((el) => {
      el.disabled = value;
    });
  document
    .querySelectorAll(
      'fig-button, fig-slider, fig-input-number, fig-input-color, fig-dropdown, fig-switch',
    )
    .forEach((el) => el.toggleAttribute('disabled', value));
  get('update').toggleAttribute('disabled', value || !selected || selected.locked);
  get('insert').textContent = value ? 'Rendering…' : IS_WEB ? 'Download PNG' : 'Insert cloud ↗';
  syncAvailability();
  shapeEditor.sync(settings);
  library.syncDisabled();
}
const sliders: {
  key: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
  group: string;
}[] = [
  { key: 'puffiness', label: 'Puffiness', min: 0, max: 100, step: 1, group: 'appearance-controls' },
  { key: 'softness', label: 'Softness', min: 1, max: 50, step: 1, group: 'appearance-controls' },
  {
    key: 'displacement',
    label: 'Turbulence',
    min: 0,
    max: 260,
    step: 1,
    group: 'texture-controls',
  },
  {
    key: 'frequency',
    label: 'Frequency',
    min: 0.003,
    max: 0.04,
    step: 0.001,
    group: 'texture-controls',
  },
  { key: 'octaves', label: 'Detail', min: 1, max: 8, step: 1, group: 'texture-controls' },
  { key: 'shadowStrength', label: 'Amount', min: 0, max: 100, step: 1, group: 'shadow-controls' },
  {
    key: 'lightAngle',
    label: 'Light direction',
    min: 0,
    max: 360,
    step: 1,
    group: 'shadow-controls',
  },
  {
    key: 'gradientStrength',
    label: 'Tint amount',
    min: 0,
    max: 100,
    step: 1,
    group: 'gradient-controls',
  },
  { key: 'spread', label: 'Spread', min: 0, max: 60, step: 1, group: 'texture-controls' },
];
for (const item of sliders) {
  const row = document.createElement('fig-field');
  row.setAttribute('direction', 'horizontal');
  row.innerHTML = `<label>${item.label}</label><fig-slider id="${item.key}" aria-label="${item.label}" min="${item.min}" max="${item.max}" step="${item.step}" precision="${item.key === 'frequency' ? 3 : 0}" value="${settings[item.key]}" text></fig-slider>`;
  get(item.group).appendChild(row);
  const update = (commit: boolean) =>
    change(
      {
        [item.key]: Number(get<HTMLInputElement>(item.key).value),
        ...(item.group === 'shadow-controls' || item.group === 'gradient-controls'
          ? {}
          : { preset: 'custom' }),
      },
      commit,
    );
  get(item.key).addEventListener('input', () => update(false));
  get(item.key).addEventListener('change', () => update(true));
}
for (const preset of PRESETS) {
  const button = document.createElement('button');
  button.className = 'preset';
  button.dataset.preset = preset.id;
  button.setAttribute('aria-label', `${preset.name} preset`);
  button.setAttribute('aria-pressed', 'false');
  const img = document.createElement('img');
  img.alt = '';
  img.width = 100;
  img.height = 43;
  img.src = `data:image/svg+xml,${encodeURIComponent(createSVG(normalize({ ...DEFAULTS, ...preset.settings }), 200, 140))}`;
  const label = document.createElement('span');
  label.textContent = preset.name;
  button.append(img, label);
  get('presets').appendChild(button);
  button.onclick = () => {
    shapeEditor.finish();
    change(
      presetRecipe(
        settings,
        { color: DEFAULTS.color, shape: [], ...preset.settings, preset: preset.id },
        library.seedLocked,
      ),
    );
  };
}
function setValue(id: string, value: string | number | boolean) {
  const el = get(id);
  if (el.getAttribute('value') !== String(value)) el.setAttribute('value', String(value));
}
function sync() {
  for (const slider of sliders) {
    setValue(slider.key, settings[slider.key] as number);
  }
  for (const key of [
    'seed',
    'width',
    'height',
    'quality',
    'color',
    'opacity',
    'gradientColor',
    'shadowMode',
  ] as const)
    setValue(key, settings[key]);
  get('self-shadows').toggleAttribute('checked', settings.selfShadows);
  get('shadow-options').hidden = !settings.selfShadows;
  get('shadow-hint').textContent =
    `${settings.shadowMode === 'transparency' ? 'Fade shaded areas into transparency.' : 'Soft internal shading.'} 90° lights from above; 180° from the left.`;
  get('gradient-enabled').toggleAttribute('checked', settings.gradientEnabled);
  get('gradient-options').hidden = !settings.gradientEnabled;
  shapeEditor.sync(settings);
  syncPreviewBackground();
  get('preview-size').textContent = `${settings.width} × ${settings.height}`;
  get('preset-label').textContent =
    PRESETS.find((p) => p.id === settings.preset)?.name || 'Custom cloud';
  get('recipe-label').textContent =
    selectedClouds.length > 1
      ? `Editing ${selectedClouds.length} clouds · Only changed fields apply to all`
      : selected
        ? 'Editing selected cloud'
        : selectionReason || 'Procedural cloud';
  document
    .querySelectorAll<HTMLButtonElement>('#presets .preset')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.preset === settings.preset)),
    );
  syncAvailability();
  get('ratio-lock').setAttribute('aria-pressed', String(ratioLocked));
  get('ratio-lock').toggleAttribute('selected', ratioLocked);
  get('ratio-lock').title = ratioLocked ? 'Aspect ratio locked' : 'Lock aspect ratio';
  const sizePreset =
    settings.width === 512 && settings.height === 512
      ? 'square'
      : settings.width === 1000 && settings.height === 400
        ? 'wide'
        : settings.width === 600 && settings.height === 900
          ? 'portrait'
          : 'custom';
  setValue('size-preset', sizePreset);
  try {
    const size = exportSize(settings);
    get('export-info').textContent = `${size.width} × ${size.height} px · Transparent PNG`;
    get('export-info').style.color = '';
  } catch (e) {
    get('export-info').textContent = (e as Error).message;
    get('export-info').style.color = 'var(--figma-color-text-danger, #d92d20)';
  }
}
function previewKey(recipe: Settings) {
  return JSON.stringify({ ...cloudRecipe(recipe), quality: 1, preset: '' });
}
function syncAvailability() {
  let valid = true;
  try {
    exportSize(settings);
  } catch {
    valid = false;
  }
  get('insert').toggleAttribute('disabled', busy || !valid);
  const locked = selectedClouds.some((cloud) => cloud.locked);
  get('update').textContent =
    selectedClouds.length > 1 ? `Update ${selectedClouds.length} clouds` : 'Update selected';
  get('update').toggleAttribute('disabled', busy || !valid || !selected || locked);
  get('cloud-field').hidden = !CLOUD_FIELD_ENABLED;
  get('scatter').toggleAttribute('disabled', !CLOUD_FIELD_ENABLED || busy || !valid);
  get('update').title = !valid
    ? 'Reduce the cloud size or resolution first'
    : locked
      ? 'Unlock the selected clouds to update them'
      : !selected
        ? 'Select a cloud made with this plugin'
        : `Update ${selected.name}`;
  get('undo').toggleAttribute('disabled', busy || !history.canUndo(settings));
  get('redo').toggleAttribute('disabled', busy || !history.canRedo || !history.matches(settings));
}
const previews = new LatestPreview<Settings>(
  async (recipe, current) => {
    const key = previewKey(recipe) + JSON.stringify(shapeEditor.viewport);
    if (key === lastPreviewKey) return;
    const crop = await paintPreview(
      get<HTMLCanvasElement>('cloud-preview'),
      recipe,
      current,
      shapeEditor.viewport,
    );
    if (current() && crop) {
      lastPreviewKey = key;
      shapeEditor.rendered(crop);
    }
  },
  (error) => status(error instanceof Error ? error.message : 'Preview could not render.', true),
  (callback) => requestAnimationFrame(callback),
  (active) => {
    get('preview-activity').textContent = active ? 'Updating…' : 'Live';
    get('preview-activity').classList.toggle('updating', active);
  },
);
const shapeEditor = new ShapeEditor(
  get<HTMLCanvasElement>('cloud-preview'),
  change,
  () => {
    previews.invalidate();
    lastPreviewKey = '';
    schedulePreview();
  },
  () => busy,
  settings,
);
const library = new CloudLibrary(
  () => settings,
  (recipe) => {
    shapeEditor.finish();
    change(recipe);
  },
  post,
  () => busy,
  status,
);
function schedulePreview() {
  previews.request({ ...settings });
}
function change(patch: Partial<Settings>, commit = true) {
  if (busy) return;
  touched = true;
  const next = cloudRecipe({ ...settings, ...patch });
  if (JSON.stringify(next) !== JSON.stringify(settings)) {
    const previousKey = previewKey(settings);
    settings = next;
    if (previousKey !== previewKey(settings)) schedulePreview();
  }
  if (commit) {
    history.commit(settings);
    if (IS_WEB) post({ type: 'save-draft', settings });
  }
  sync();
}
for (const key of ['seed', 'width', 'height', 'quality', 'opacity'] as const) {
  const update = (commit: boolean) => {
    const raw = get<HTMLInputElement>(key).value;
    if (String(raw).trim() === '' || !Number.isFinite(Number(raw))) {
      if (commit) sync();
      return;
    }
    const value = Number(raw);
    if (!commit && (key === 'width' || key === 'height') && (value < 64 || value > 4096)) return;
    const patch =
      ratioLocked && (key === 'width' || key === 'height')
        ? resizeLocked(key, value, lockedRatio)
        : { [key]: value };
    change(patch, commit);
  };
  get(key).addEventListener('input', () => update(false));
  get(key).addEventListener('change', () => update(true));
}
const updateCloudColor = (commit: boolean) =>
  change({ color: get<HTMLInputElement>('color').value.slice(0, 7) }, commit);
get('color').addEventListener('input', () => updateCloudColor(false));
get('color').addEventListener('change', () => updateCloudColor(true));
function syncPreviewBackground() {
  const preview = get('preview');
  preview.classList.toggle('checker', previewTransparent);
  preview.style.backgroundImage = previewTransparent ? '' : 'none';
  preview.style.backgroundColor = previewTransparent ? '' : previewColor;
  get('transparent').toggleAttribute('checked', previewTransparent);
  get('preview-bg').toggleAttribute('selected', previewTransparent);
  get('preview-bg').setAttribute('aria-pressed', String(previewTransparent));
  get('sky').hidden = previewTransparent;
  setValue('sky', previewColor);
  get('preview-caption').textContent = previewTransparent
    ? 'Checkerboard · Preview only'
    : 'Color background · Preview only';
}
function changePreviewBackground(transparent: boolean) {
  previewTransparent = transparent;
  syncPreviewBackground();
}
get('gradient-enabled').addEventListener('change', () =>
  change({ gradientEnabled: get<HTMLInputElement>('gradient-enabled').checked }),
);
const updateGradientColor = (commit: boolean) =>
  change({ gradientColor: get<HTMLInputElement>('gradientColor').value.slice(0, 7) }, commit);
get('gradientColor').addEventListener('input', () => updateGradientColor(false));
get('gradientColor').addEventListener('change', () => updateGradientColor(true));
get('shadowMode').addEventListener('change', () =>
  change({
    shadowMode:
      get<HTMLSelectElement>('shadowMode').value === 'transparency' ? 'transparency' : 'shade',
  }),
);
get('self-shadows').addEventListener('change', () =>
  change({ selfShadows: get<HTMLInputElement>('self-shadows').checked }),
);
get('transparent').addEventListener('change', () =>
  changePreviewBackground(get<HTMLInputElement>('transparent').checked),
);
const updatePreviewColor = () => {
  const value = get<HTMLInputElement>('sky').value.slice(0, 7);
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    previewColor = value;
    syncPreviewBackground();
  }
};
get('sky').addEventListener('input', updatePreviewColor);
get('sky').addEventListener('change', updatePreviewColor);
get('ratio-lock').onclick = () => {
  ratioLocked = !ratioLocked;
  lockedRatio = settings.width / settings.height;
  sync();
};
get('size-preset').addEventListener('change', () => {
  const sizes: Record<string, { width: number; height: number }> = {
    square: { width: 512, height: 512 },
    wide: { width: 1000, height: 400 },
    portrait: { width: 600, height: 900 },
  };
  const size = sizes[get<HTMLInputElement>('size-preset').value];
  if (size) {
    lockedRatio = size.width / size.height;
    change(size);
  }
});
function restoreRecipe(recipe: Settings) {
  if (busy) return;
  touched = true;
  previews.invalidate();
  settings = { ...recipe };
  lockedRatio = settings.width / settings.height;
  sync();
  schedulePreview();
  if (IS_WEB) post({ type: 'save-draft', settings });
}
get('undo').onclick = () => {
  shapeEditor.finish();
  restoreRecipe(history.undo(settings));
};
get('redo').onclick = () => {
  shapeEditor.finish();
  if (history.matches(settings)) restoreRecipe(history.redo());
};
window.addEventListener('keydown', (event) => {
  if (busy || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
  if (
    event
      .composedPath()
      .some(
        (target) =>
          target instanceof HTMLElement &&
          (target.matches('input,textarea,select') || target.isContentEditable),
      )
  )
    return;
  event.preventDefault();
  shapeEditor.finish();
  if (event.shiftKey) {
    if (history.canRedo && history.matches(settings)) restoreRecipe(history.redo());
  } else if (history.canUndo(settings)) restoreRecipe(history.undo(settings));
});
get('randomize').onclick = () => {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  change({ seed: (settings.seed + 1 + (value[0] % 999999)) % 1000000 });
};
get('reset').onclick = () => {
  shapeEditor.finish();
  previews.invalidate();
  lockedRatio = DEFAULTS.width / DEFAULTS.height;
  change({ ...DEFAULTS });
  schedulePreview();
  status('Default cloud restored.');
};
get('preview-bg').onclick = () => changePreviewBackground(!previewTransparent);

function beginRun(label: string): RenderRun {
  library.cancelVariations();
  controlsDisabled(true);
  status(label);
  get('render-progress').hidden = false;
  get('cancel-render').removeAttribute('disabled');
  const run: RenderRun = {
    id: ++runSequence,
    controller: new AbortController(),
    started: performance.now(),
    timer: 0,
    sent: false,
    requestId: `render-${Date.now()}-${runSequence}`,
    sentAt: 0,
    lastCheck: 0,
  };
  run.timer = setInterval(() => {
    if (activeRun !== run) return;
    const now = performance.now();
    get('render-elapsed').textContent = `${((now - run.started) / 1000).toFixed(1)}s`;
    if (!run.sent) return;
    if (now - run.sentAt > 15000) {
      finishError(
        IS_WEB
          ? 'The download has not completed. Please try again.'
          : 'Figma has not confirmed completion. Check the canvas before inserting again.',
      );
      return;
    }
    if (now - run.lastCheck > 1500) {
      run.lastCheck = now;
      post({ type: 'operation-status', requestId: run.requestId });
    }
  }, 100);
  activeRun = run;
  get('render-elapsed').textContent = '0.0s';
  return run;
}
function endRun() {
  if (activeRun) clearInterval(activeRun.timer);
  activeRun = undefined;
  pendingScatter = undefined;
  get('render-progress').hidden = true;
}
function currentRun(run: RenderRun) {
  if (activeRun !== run || run.controller.signal.aborted)
    throw new DOMException('Rendering canceled', 'AbortError');
}
async function beforeSend(run: RenderRun) {
  // Let a pending click on Cancel run before any document mutation is sent.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  currentRun(run);
  run.sent = true;
  run.sentAt = run.lastCheck = performance.now();
  get('cancel-render').setAttribute('disabled', '');
}
get('cancel-render').onclick = () => {
  const run = activeRun;
  if (!run || run.sent) return;
  run.controller.abort();
  endRun();
  controlsDisabled(false);
  if (deferredSelection) {
    const next = deferredSelection;
    deferredSelection = undefined;
    applySelectionState(next, true);
  }
  status(IS_WEB ? 'Download canceled.' : 'Rendering canceled. No clouds were changed.');
};
function failRun(run: RenderRun, error: unknown) {
  if (activeRun !== run) return;
  const message = error instanceof Error ? error.message : 'Could not render this cloud.';
  if (headless) post({ type: 'headless-error', message });
  finishError(message);
}
function checkBatchBudget(recipes: Settings[]) {
  if (recipes.length > 24) throw new Error('Select up to 24 clouds at a time.');
  const pixels = recipes.reduce((sum, recipe) => {
    const size = exportSize(recipe);
    return sum + size.width * size.height;
  }, 0);
  if (pixels > 32000000)
    throw new Error(
      'This batch is too large. Lower resolution or select fewer clouds (32 megapixels maximum).',
    );
}
async function generate(type: 'insert' | 'update') {
  if (busy) return;
  shapeEditor.finish();
  touched = true;
  history.commit(settings);
  const targets = selectedClouds.map((cloud) => ({
    ...cloud,
    settings: cloudRecipe(cloud.settings),
  }));
  if (type === 'update' && (!targets.length || targets.some((cloud) => cloud.locked))) return;
  const recipes =
    type === 'update'
      ? batchRecipes(
          targets[0].settings,
          settings,
          targets.map((cloud) => cloud.settings),
        )
      : [cloudRecipe(settings)];
  try {
    checkBatchBudget(recipes);
  } catch (error) {
    status((error as Error).message, true);
    return;
  }
  const run = beginRun('Preparing your cloud…');
  try {
    const items = [];
    let totalBytes = 0;
    for (let i = 0; i < recipes.length; i++) {
      const recipe = recipes[i],
        target = targets[i];
      const bytes = await rasterize(recipe, {
        signal: run.controller.signal,
        onProgress: (stage) => {
          if (activeRun === run)
            status(recipes.length > 1 ? `Cloud ${i + 1} of ${recipes.length} · ${stage}` : stage);
        },
      });
      currentRun(run);
      totalBytes += bytes.length;
      if (totalBytes > 128000000)
        throw new Error('This batch is too large. Lower resolution or select fewer clouds.');
      items.push({
        settings: recipe,
        bytes,
        targetId: target?.id,
        targetSize: target
          ? {
              width: target.width ?? target.settings.width,
              height: target.height ?? target.settings.height,
            }
          : undefined,
      });
    }
    await beforeSend(run);
    status(
      IS_WEB
        ? 'Preparing PNG download…'
        : type === 'insert'
          ? 'Inserting into Figma…'
          : 'Updating selected clouds…',
    );
    if (type === 'update' && items.length > 1)
      post({ type: 'update-many', requestId: run.requestId, items });
    else post({ type, requestId: run.requestId, ...items[0] });
  } catch (error) {
    failRun(run, error);
  }
}
get('insert').onclick = () => {
  void generate('insert');
};
get('update').onclick = () => {
  void generate('update');
};
get('scatter').onclick = () => {
  if (!CLOUD_FIELD_ENABLED || busy) return;
  shapeEditor.finish();
  touched = true;
  const count = Math.max(
    1,
    Math.min(24, Math.round(Number(get<HTMLInputElement>('scatter-count').value) || 8)),
  );
  const run = beginRun('Preparing cloud field…'),
    requestId = `scatter-${run.id}`;
  pendingScatter = { requestId, run };
  post({ type: 'prepare-scatter', requestId, count, settings: cloudRecipe(settings) });
};
async function renderScatter(message: { requestId: string; planId: string; jobs: ScatterJob[] }) {
  if (!CLOUD_FIELD_ENABLED) return;
  const pending = pendingScatter;
  if (!pending || pending.requestId !== message.requestId || !activeRun) return;
  pendingScatter = undefined;
  const run = pending.run;
  try {
    if (!Array.isArray(message.jobs) || message.jobs.length < 1 || message.jobs.length > 24)
      throw new Error('Invalid cloud field plan. Try again.');
    checkBatchBudget(message.jobs.map((job) => job.settings));
    const items = [];
    let totalBytes = 0;
    for (let i = 0; i < message.jobs.length; i++) {
      const job = message.jobs[i];
      const bytes = await rasterize(job.settings, {
        signal: run.controller.signal,
        onProgress: (stage) => {
          if (activeRun === run) status(`Cloud ${i + 1} of ${message.jobs.length} · ${stage}`);
        },
      });
      currentRun(run);
      totalBytes += bytes.length;
      if (totalBytes > 128000000)
        throw new Error('This cloud field is too large. Lower resolution or reduce the count.');
      items.push({ ...job, bytes });
    }
    await beforeSend(run);
    status('Inserting cloud field…');
    post({ type: 'insert-many', requestId: run.requestId, planId: message.planId, items });
  } catch (error) {
    failRun(run, error);
  }
}
function applySelectionState(state: SelectionState, load: boolean) {
  if (busy && load) {
    deferredSelection = state;
    return;
  }
  const next = Array.isArray(state.selections)
    ? state.selections
    : state.selection
      ? [state.selection]
      : [];
  const sameIds =
    selectedClouds.map((cloud) => cloud.id).join(':') === next.map((cloud) => cloud.id).join(':');
  const draft =
    selected &&
    JSON.stringify(cloudRecipe(settings)) !== JSON.stringify(cloudRecipe(selected.settings));
  const previous = new Map(selectedClouds.map((cloud) => [cloud.id, cloud]));
  selectedClouds = next.map((cloud) =>
    load && sameIds && draft && previous.has(cloud.id)
      ? { ...previous.get(cloud.id)!, name: cloud.name, locked: cloud.locked }
      : cloud,
  );
  selectionReason = state.selectionReason || '';
  if (load && !sameIds && selected?.id === selectedClouds[0]?.id) selected = null;
  applySelection(selectedClouds[0] || null, load);
}
function applySelection(value: Selected, load: boolean) {
  const previous = selected;
  const changed = previous?.id !== value?.id;
  const refreshed =
    previous &&
    value &&
    (previous.width !== value.width ||
      previous.height !== value.height ||
      JSON.stringify(cloudRecipe(previous.settings)) !==
        JSON.stringify(cloudRecipe(value.settings)));
  if (changed || refreshed || previous?.locked !== value?.locked) shapeEditor.finish();
  const draft =
    previous &&
    JSON.stringify(cloudRecipe(settings)) !== JSON.stringify(cloudRecipe(previous.settings));
  // A focus refresh must neither discard local edits nor silently accept an
  // external resize as the draft's baseline. The controller checks that size.
  if (load && !changed && previous && value && draft) {
    selected = { ...previous, name: value.name, locked: value.locked };
    sync();
    return;
  }
  selected = value;
  if (changed && value && !busy && !load) history.reset(settings);
  if (load && (changed || refreshed) && value && !busy) {
    previews.invalidate();
    settings = cloudRecipe(value.settings);
    history.reset(settings);
    lockedRatio = settings.width / settings.height;
    sync();
    schedulePreview();
    status(
      value.locked
        ? 'Unlock the selected cloud to update it.'
        : 'Cloud settings loaded. Edit and update, or insert a copy.',
    );
  } else sync();
}
function finishError(message: string) {
  endRun();
  controlsDisabled(false);
  if (deferredSelection !== undefined) {
    const next = deferredSelection;
    deferredSelection = undefined;
    applySelectionState(next, true);
  }
  status(message, true);
}
window.onmessage = (event) => {
  if (IS_WEB && event.source !== window) return;
  const msg = event.data?.pluginMessage;
  if (!msg || typeof msg !== 'object') return;
  // Match the controller's per-launch token rather than assuming which host
  // window relayed a message. Standalone browser previews have no injected token.
  if (
    bridgeSession
      ? msg.bridgeSession !== bridgeSession
      : event.source && event.source !== parent && event.source !== window
  )
    return;
  if (msg.type === 'operation-status') {
    if (msg.requestId === activeRun?.requestId && msg.state === 'unknown')
      finishError('Figma did not receive this operation. No automatic retry was made.');
    return;
  }
  if (
    (msg.type === 'done' || msg.type === 'error') &&
    msg.requestId &&
    msg.requestId !== activeRun?.requestId &&
    msg.requestId !== pendingScatter?.requestId
  )
    return;
  if (IS_WEB && msg.type === 'web-notice') {
    status(String(msg.message));
    return;
  }
  if (msg.type === 'presets') {
    library.receive(msg);
    return;
  }
  if (msg.type === 'preset-error') {
    library.failed(String(msg.message), msg.requestId);
    return;
  }
  if (msg.type === 'scatter-plan') {
    void renderScatter(msg);
    return;
  }
  if (msg.type === 'headless-insert') {
    headless = true;
    settings = cloudRecipe(msg.settings);
    sync();
    void generate('insert');
    return;
  }
  if (msg.type === 'init') {
    if (busy) {
      deferredSelection = msg;
      return;
    }
    if (!touched) {
      shapeEditor.finish();
      previews.invalidate();
      settings = cloudRecipe(
        msg.selection?.settings || msg.selections?.[0]?.settings || msg.settings || DEFAULTS,
      );
      history.reset(settings);
      lockedRatio = settings.width / settings.height;
      applySelectionState(msg, true);
      sync();
      schedulePreview();
    } else applySelectionState(msg, true);
  } else if (msg.type === 'selection') applySelectionState(msg, true);
  else if (msg.type === 'done') {
    deferredSelection = undefined;
    endRun();
    controlsDisabled(false);
    if (msg.recovered) {
      selected = null;
      selectedClouds = [];
    }
    applySelectionState(msg, msg.recovered === true || msg.action === 'insert-many');
    status(
      IS_WEB
        ? 'PNG download started.'
        : msg.action === 'update-many'
          ? `${selectedClouds.length} clouds updated.`
          : msg.action === 'insert-many'
            ? 'Cloud field inserted.'
            : msg.action === 'update'
              ? 'Cloud updated. Size applied; position preserved.'
              : 'Cloud inserted. Select it anytime to edit its settings.',
    );
  } else if (msg.type === 'error') {
    finishError(String(msg.message));
  }
};
window.addEventListener('focus', () => post({ type: 'selection-request' }));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) post({ type: 'selection-request' });
});
if (IS_WEB) {
  const theme = window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    document.documentElement.classList.toggle('figma-dark', theme.matches);
    document.documentElement.classList.toggle('figma-light', !theme.matches);
  };
  applyTheme();
  theme.addEventListener('change', applyTheme);
  get('insert').textContent = 'Download PNG';
  get('update').hidden = true;
}
installControlCapture();
sync();
schedulePreview();
post({ type: 'ready' });

function syncPreviewSeparation() {
  get('preview-header').classList.toggle('scrolled', window.scrollY > 0);
}
window.addEventListener('scroll', syncPreviewSeparation, { passive: true });
syncPreviewSeparation();
