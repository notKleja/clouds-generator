import '@rogieking/figui3/src/fig.js';
import '@rogieking/figui3/src/fig-editor.js';
import { ShapeEditor } from './shape-editor';
import { installControlCapture } from './drag';
import { cloudRecipe } from './settings';
import { LatestPreview, RecipeHistory, resizeLocked } from './interaction';
import { paintPreview, rasterize } from './render';
import { DEFAULTS, PRESETS, normalize, createSVG, exportSize, type Settings } from './cloud';

type Selected = { id: string; name: string; width?: number; height?: number; settings: Settings; locked: boolean } | null;
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let settings = cloudRecipe(DEFAULTS);
let previewTransparent = false;
let previewColor = DEFAULTS.sky;
let selected: Selected = null;
let deferredSelection: Selected | undefined;
let busy = false, touched = false;
let lastPreviewKey = '';
const history = new RecipeHistory(settings);
let ratioLocked = false;
let lockedRatio = settings.width / settings.height;
const post = (message: unknown) => parent.postMessage({ pluginMessage: message }, '*');
function status(text: string, error = false) {
  get('status').textContent = text;
  get('status').classList.toggle('error', error);
}
function controlsDisabled(value: boolean) {
  busy = value;
  document.body.classList.toggle('busy', value);
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select').forEach(el => { el.disabled = value; });
  document.querySelectorAll('fig-button, fig-slider, fig-input-number, fig-input-color, fig-dropdown, fig-switch').forEach(el => el.toggleAttribute('disabled', value));
  get('update').toggleAttribute('disabled', value || !selected || selected.locked);
  get('insert').textContent = value ? 'Rendering…' : 'Insert cloud ↗';
  syncAvailability(); shapeEditor.sync(settings);
}
const sliders: { key: keyof Settings; label: string; min: number; max: number; step: number; group: string }[] = [
  { key: 'puffiness', label: 'Puffiness', min: 0, max: 100, step: 1, group: 'appearance-controls' },
  { key: 'softness', label: 'Softness', min: 1, max: 50, step: 1, group: 'appearance-controls' },
  { key: 'displacement', label: 'Turbulence', min: 0, max: 260, step: 1, group: 'texture-controls' },
  { key: 'frequency', label: 'Frequency', min: 0.003, max: 0.04, step: 0.001, group: 'texture-controls' },
  { key: 'octaves', label: 'Detail', min: 1, max: 8, step: 1, group: 'texture-controls' },
  { key: 'shadowStrength', label: 'Amount', min: 0, max: 100, step: 1, group: 'shadow-controls' },
  { key: 'lightAngle', label: 'Light direction', min: 0, max: 360, step: 1, group: 'shadow-controls' },
  { key: 'spread', label: 'Spread', min: 0, max: 60, step: 1, group: 'texture-controls' },
];
for (const item of sliders) {
  const row = document.createElement('fig-field'); row.setAttribute('direction', 'horizontal');
  row.innerHTML = `<label>${item.label}</label><fig-slider id="${item.key}" aria-label="${item.label}" min="${item.min}" max="${item.max}" step="${item.step}" precision="${item.key === 'frequency' ? 3 : 0}" value="${settings[item.key]}" text></fig-slider>`;
  get(item.group).appendChild(row);
  const update = (commit: boolean) => change({ [item.key]: Number(get<HTMLInputElement>(item.key).value), ...(item.group === 'shadow-controls' ? {} : { preset: 'custom' }) }, commit);
  get(item.key).addEventListener('input', () => update(false));
  get(item.key).addEventListener('change', () => update(true));
}
for (const preset of PRESETS) {
  const button = document.createElement('button'); button.className = 'preset'; button.dataset.preset = preset.id;
  button.setAttribute('aria-label', `${preset.name} preset`); button.setAttribute('aria-pressed', 'false');
  const img = document.createElement('img'); img.alt = ''; img.width = 100; img.height = 43;
  img.src = `data:image/svg+xml,${encodeURIComponent(createSVG(normalize({ ...DEFAULTS, ...preset.settings }), 200, 140))}`;
  const label = document.createElement('span'); label.textContent = preset.name;
  button.append(img, label); get('presets').appendChild(button);
  button.onclick = () => { shapeEditor.finish(); change({ color: DEFAULTS.color, shape: [], ...preset.settings, preset: preset.id }); };
}
function setValue(id: string, value: string | number | boolean) {
  const el = get(id);
  if (el.getAttribute('value') !== String(value)) el.setAttribute('value', String(value));
}
function sync() {
  for (const slider of sliders) {
    setValue(slider.key, settings[slider.key] as number);
  }
  for (const key of ['seed', 'width', 'height', 'quality', 'color', 'opacity'] as const) setValue(key, settings[key]);
  get('self-shadows').toggleAttribute('checked', settings.selfShadows);
  get('shadow-options').hidden = !settings.selfShadows;
  shapeEditor.sync(settings);
  syncPreviewBackground();
  get('preview-size').textContent = `${settings.width} × ${settings.height}`;
  get('preset-label').textContent = PRESETS.find(p => p.id === settings.preset)?.name || 'Custom cloud';
  get('recipe-label').textContent = selected ? 'Editing selected cloud' : 'Procedural cloud';
  document.querySelectorAll<HTMLButtonElement>('.preset').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === settings.preset)));
  syncAvailability();
  get('ratio-lock').setAttribute('aria-pressed', String(ratioLocked));
  get('ratio-lock').toggleAttribute('selected', ratioLocked);
  get('ratio-lock').title = ratioLocked ? 'Aspect ratio locked' : 'Lock aspect ratio';
  const sizePreset = settings.width === 512 && settings.height === 512 ? 'square' : settings.width === 1000 && settings.height === 400 ? 'wide' : settings.width === 600 && settings.height === 900 ? 'portrait' : 'custom';
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
function previewKey(recipe: Settings) { return JSON.stringify({ ...cloudRecipe(recipe), quality: 1, preset: '' }); }
function syncAvailability() {
  let valid = true;
  try { exportSize(settings); } catch { valid = false; }
  get('insert').toggleAttribute('disabled', busy || !valid);
  get('update').toggleAttribute('disabled', busy || !valid || !selected || selected.locked);
  get('update').title = !valid ? 'Reduce the cloud size or resolution first' : selected?.locked ? 'Unlock this cloud to update it' : !selected ? 'Select a cloud made with this plugin' : `Update ${selected.name}`;
  get('undo').toggleAttribute('disabled', busy || !history.canUndo(settings));
  get('redo').toggleAttribute('disabled', busy || !history.canRedo || !history.matches(settings));
}
const previews = new LatestPreview<Settings>(async (recipe, current) => {
  const key = previewKey(recipe) + JSON.stringify(shapeEditor.viewport);
  if (key === lastPreviewKey) return;
  const crop = await paintPreview(get<HTMLCanvasElement>('cloud-preview'), recipe, current, shapeEditor.viewport);
  if (current() && crop) { lastPreviewKey = key; shapeEditor.rendered(crop); }
}, error => status(error instanceof Error ? error.message : 'Preview could not render.', true),
callback => requestAnimationFrame(callback), active => {
  get('preview-activity').textContent = active ? 'Updating…' : 'Live';
  get('preview-activity').classList.toggle('updating', active);
});
const shapeEditor = new ShapeEditor(get<HTMLCanvasElement>('cloud-preview'), change, () => { previews.invalidate(); lastPreviewKey = ''; schedulePreview(); }, () => busy, settings);
function schedulePreview() { previews.request({ ...settings }); }
function change(patch: Partial<Settings>, commit = true) {
  if (busy) return;
  touched = true;
  const next = cloudRecipe({ ...settings, ...patch });
  if (JSON.stringify(next) !== JSON.stringify(settings)) {
    const previousKey = previewKey(settings);
    settings = next;
    if (previousKey !== previewKey(settings)) schedulePreview();
  }
  if (commit) history.commit(settings);
  sync();
}
for (const key of ['seed', 'width', 'height', 'quality', 'opacity'] as const) {
  const update = (commit: boolean) => {
    const raw = get<HTMLInputElement>(key).value;
    if (String(raw).trim() === '' || !Number.isFinite(Number(raw))) { if (commit) sync(); return; }
    const value = Number(raw);
    if (!commit && (key === 'width' || key === 'height') && (value < 64 || value > 4096)) return;
    const patch = ratioLocked && (key === 'width' || key === 'height') ? resizeLocked(key, value, lockedRatio) : { [key]: value };
    change(patch, commit);
  };
  get(key).addEventListener('input', () => update(false));
  get(key).addEventListener('change', () => update(true));
}
const updateCloudColor = (commit: boolean) => change({ color: get<HTMLInputElement>('color').value.slice(0, 7) }, commit);
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
  get('preview-caption').textContent = previewTransparent ? 'Checkerboard · Preview only' : 'Color background · Preview only';
}
function changePreviewBackground(transparent: boolean) { previewTransparent = transparent; syncPreviewBackground(); }
get('self-shadows').addEventListener('change', () => change({ selfShadows: get<HTMLInputElement>('self-shadows').checked }));
get('transparent').addEventListener('change', () => changePreviewBackground(get<HTMLInputElement>('transparent').checked));
const updatePreviewColor = () => {
  const value = get<HTMLInputElement>('sky').value.slice(0, 7);
  if (/^#[0-9a-f]{6}$/i.test(value)) { previewColor = value; syncPreviewBackground(); }
};
get('sky').addEventListener('input', updatePreviewColor);
get('sky').addEventListener('change', updatePreviewColor);
get('ratio-lock').onclick = () => { ratioLocked = !ratioLocked; lockedRatio = settings.width / settings.height; sync(); };
get('size-preset').addEventListener('change', () => {
  const sizes: Record<string, {width:number;height:number}> = { square:{width:512,height:512}, wide:{width:1000,height:400}, portrait:{width:600,height:900} };
  const size = sizes[get<HTMLInputElement>('size-preset').value];
  if (size) { lockedRatio = size.width / size.height; change(size); }
});
function restoreRecipe(recipe: Settings) {
  if (busy) return;
  touched = true; previews.invalidate(); settings = { ...recipe };
  lockedRatio = settings.width / settings.height; sync(); schedulePreview();
}
get('undo').onclick = () => { shapeEditor.finish(); restoreRecipe(history.undo(settings)); };
get('redo').onclick = () => { shapeEditor.finish(); if (history.matches(settings)) restoreRecipe(history.redo()); };
window.addEventListener('keydown', event => {
  if (busy || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
  if (event.composedPath().some(target => target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable))) return;
  event.preventDefault(); shapeEditor.finish();
  if (event.shiftKey) { if (history.canRedo && history.matches(settings)) restoreRecipe(history.redo()); }
  else if (history.canUndo(settings)) restoreRecipe(history.undo(settings));
});
get('randomize').onclick = () => {
  const value = new Uint32Array(1); crypto.getRandomValues(value);
  change({ seed: (settings.seed + 1 + value[0] % 999999) % 1000000 });
};
get('reset').onclick = () => { shapeEditor.finish(); previews.invalidate(); lockedRatio = DEFAULTS.width / DEFAULTS.height; change({ ...DEFAULTS }); schedulePreview(); status('Default cloud restored.'); };
get('preview-bg').onclick = () => changePreviewBackground(!previewTransparent);

async function generate(type: 'insert' | 'update') {
  if (busy) return;
  shapeEditor.finish();
  touched = true;
  history.commit(settings);
  const recipe = cloudRecipe(settings), targetId = selected?.id;
  const targetSize = selected ? { width: selected.width ?? selected.settings.width, height: selected.height ?? selected.settings.height } : undefined;
  if (type === 'update' && (!selected || selected.locked)) return;
  try { exportSize(recipe); } catch (e) { status((e as Error).message, true); return; }
  controlsDisabled(true); status('Rendering your cloud…');
  try {
    const bytes = await rasterize(recipe);
    post({ type, settings: recipe, targetId, targetSize, bytes });
    status(type === 'insert' ? 'Inserting into Figma…' : 'Updating your cloud…');
  } catch (e) { finishError((e as Error).message); }
}
get('insert').onclick = () => { void generate('insert'); };
get('update').onclick = () => { void generate('update'); };
function applySelection(value: Selected, load: boolean) {
  if (busy && load) { deferredSelection = value; return; }
  const previous = selected;
  const changed = previous?.id !== value?.id;
  const refreshed = previous && value && (previous.width !== value.width || previous.height !== value.height || JSON.stringify(cloudRecipe(previous.settings)) !== JSON.stringify(cloudRecipe(value.settings)));
  if (changed || refreshed || previous?.locked !== value?.locked) shapeEditor.finish();
  const draft = previous && JSON.stringify(cloudRecipe(settings)) !== JSON.stringify(cloudRecipe(previous.settings));
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
    previews.invalidate(); settings = cloudRecipe(value.settings); history.reset(settings); lockedRatio = settings.width / settings.height; sync(); schedulePreview();
    status(value.locked ? 'Unlock the selected cloud to update it.' : 'Cloud settings loaded. Edit and update, or insert a copy.');
  } else sync();
}
function finishError(message: string) {
  controlsDisabled(false);
  if (deferredSelection !== undefined) { const next = deferredSelection; deferredSelection = undefined; applySelection(next, true); }
  status(message, true);
}
window.onmessage = event => {
  // Host-delivered MessageEvents can have no WindowProxy source. Accept those
  // and local bridge relays, while rejecting messages from unrelated windows.
  if (event.source && event.source !== parent && event.source !== window) return;
  const msg = event.data?.pluginMessage;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'init') {
    if (busy) { deferredSelection = msg.selection; return; }
    if (!touched) {
      shapeEditor.finish(); previews.invalidate(); settings = cloudRecipe(msg.selection?.settings || msg.settings || DEFAULTS);
      history.reset(settings); lockedRatio = settings.width / settings.height; selected = msg.selection;
      sync(); schedulePreview();
    } else applySelection(msg.selection, true);
  } else if (msg.type === 'selection') applySelection(msg.selection, true);
  else if (msg.type === 'done') {
    deferredSelection = undefined; controlsDisabled(false); applySelection(msg.selection, false);
    status(msg.action === 'update' ? 'Cloud updated. Size applied; position preserved.' : 'Cloud inserted. Select it anytime to edit its settings.');
  } else if (msg.type === 'error') {
    finishError(String(msg.message));
  }
};
window.addEventListener('focus', () => post({ type: 'selection-request' }));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) post({ type: 'selection-request' });
});
installControlCapture();
sync(); schedulePreview(); post({ type: 'ready' });

function syncPreviewSeparation() {
  get('preview-header').classList.toggle('scrolled', window.scrollY > 0);
}
window.addEventListener('scroll', syncPreviewSeparation, { passive: true });
syncPreviewSeparation();
