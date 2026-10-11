import { cloudRecipe } from './src/settings';
import { normalize, exportSize, PRESETS, type Settings } from './src/cloud';

const RECIPE_KEY = 'clouds-recipe-v1';
const STORAGE_KEY = 'clouds-last-settings-v1';
figma.showUI(__html__, { width: 360, height: 740, themeColors: true });

function isLocked(node: BaseNode): boolean {
  let current: BaseNode | null = node;
  while (current) {
    if ('locked' in current && current.locked) return true;
    current = current.parent;
  }
  return false;
}
function recipe(node: SceneNode): Settings | null {
  if (node.type !== 'RECTANGLE') return null;
  try {
    const raw = node.getPluginData(RECIPE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.version === 1 && data.settings ? normalize(data.settings) : null;
  } catch { return null; }
}
function selection() {
  const nodes = figma.currentPage.selection;
  const node = nodes.length === 1 ? nodes[0] : null;
  const settings = node && recipe(node);
  return settings && node ? { id: node.id, name: node.name, width: node.width, height: node.height, settings: normalize({ ...settings, width: node.width, height: node.height }), locked: isLocked(node) } : null;
}
function sendSelection() {
  figma.ui.postMessage({ type: 'selection', selection: selection() });
}
figma.on('selectionchange', sendSelection);

function imageBytes(input: unknown, settings: Settings): Uint8Array {
  if (!(input instanceof Uint8Array) && !Array.isArray(input)) throw new Error('Invalid cloud image. Try inserting again.');
  if (input.length < 24 || input.length > 64000000) throw new Error('Cloud image is empty or too large.');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((n, i) => bytes[i] === n) || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') {
    throw new Error('Cloud image is not a valid PNG.');
  }
  const size = exportSize(settings);
  const uint32 = (i: number) => bytes[i] * 16777216 + bytes[i + 1] * 65536 + bytes[i + 2] * 256 + bytes[i + 3];
  if (uint32(16) !== size.width || uint32(20) !== size.height) throw new Error('Image dimensions do not match the cloud settings.');
  return bytes;
}
let busy = false;
let saveQueue = Promise.resolve();
figma.ui.onmessage = async (raw: unknown) => {
  if (!raw || typeof raw !== 'object') return;
  const msg = raw as Record<string, unknown>;
  if (msg.type === 'ready') {
    let saved: unknown;
    try { saved = await figma.clientStorage.getAsync(STORAGE_KEY); } catch { /* Defaults remain usable. */ }
    figma.ui.postMessage({ type: 'init', settings: saved ? normalize(saved) : null, selection: selection() });
    return;
  }
  if (msg.type !== 'insert' && msg.type !== 'update') return;
  if (busy) return;
  busy = true;
  let created: RectangleNode | null = null;
  try {
    const settings = cloudRecipe(msg.settings);
    const bytes = imageBytes(msg.bytes, settings);
    let target: RectangleNode | null = null;
    if (msg.type === 'update') {
      const nodes = figma.currentPage.selection;
      if (nodes.length !== 1 || nodes[0].id !== msg.targetId || nodes[0].type !== 'RECTANGLE' || !recipe(nodes[0]) || isLocked(nodes[0])) {
        throw new Error('Select the original unlocked cloud, then try Update again.');
      }
      target = nodes[0];
      const expected = msg.targetSize as { width?: unknown; height?: unknown } | undefined;
      if (expected && (expected.width !== target.width || expected.height !== target.height)) {
        throw new Error('This cloud was resized in Figma. Reselect it to load its current size, then update.');
      }
    }
    const image = figma.createImage(bytes);
    if (!target) {
      created = figma.createRectangle();
      target = created;
      target.resize(settings.width, settings.height);
      target.x = figma.viewport.center.x - settings.width / 2;
      target.y = figma.viewport.center.y - settings.height / 2;
    }
    target.resize(settings.width, settings.height);
    target.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FIT' }];
    target.setPluginData(RECIPE_KEY, JSON.stringify({ version: 1, settings }));
    if (created) target.name = `Cloud / ${PRESETS.find(p => p.id === settings.preset)?.name || 'Custom'} / ${settings.seed}`;
    figma.currentPage.selection = [target];
    if (created) figma.viewport.scrollAndZoomIntoView([target]);
    figma.commitUndo();
    created = null;
    figma.ui.postMessage({ type: 'done', action: msg.type, selection: selection() });
    figma.notify(msg.type === 'update' ? 'Cloud updated' : 'Cloud inserted');
    saveQueue = saveQueue.then(() => figma.clientStorage.setAsync(STORAGE_KEY, settings)).catch(() => { /* Node recipe is already saved. */ });
  } catch (error) {
    if (created) created.remove();
    figma.ui.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Could not create this cloud. Try again.' });
  } finally { busy = false; }
};
