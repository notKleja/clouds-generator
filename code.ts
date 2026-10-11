import { CLOUD_FIELD_ENABLED } from './src/features';
import { cloudRecipe } from './src/settings';
import { normalize, exportSize, PRESETS, DEFAULTS, type Settings } from './src/cloud';
import { RECIPE_KEY, readRecipe, writeRecipe } from './src/recipes';
import { scatterJobs, validateBatchBudget, type Bounds, type ScatterJob } from './src/scatter';

const STORAGE_KEY = 'clouds-last-settings-v1';
const PRESETS_KEY = 'clouds-custom-presets-v1';
const PREFERENCES_KEY = 'clouds-preferences-v1';
type CloudNode = RectangleNode | EllipseNode | FrameNode;
type Selected = {
  id: string;
  name: string;
  width: number;
  height: number;
  settings: Settings;
  locked: boolean;
};
type Preset = { id: string; name: string; settings: Settings };
const headless = figma.command === 'random';
const bridgeSession = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const uiHTML = __html__.replace(
  '<!-- CLOUDS_SESSION -->',
  () => `<meta name="clouds-session" content="${bridgeSession}">`,
);
figma.showUI(uiHTML, { width: 360, height: 740, themeColors: true, visible: !headless });

function sendUI(message: Record<string, unknown>): void {
  figma.ui.postMessage({ ...message, bridgeSession });
}
const outcomes = new Map<string, Record<string, unknown>>();
function sendOutcome(message: Record<string, unknown>, requestId?: unknown): void {
  const result = { ...message, requestId };
  if (typeof requestId === 'string' && requestId.length <= 200) {
    outcomes.set(requestId, result);
    while (outcomes.size > 16) outcomes.delete(outcomes.keys().next().value!);
  }
  sendUI(result);
}
function isLocked(node: BaseNode): boolean {
  let current: BaseNode | null = node;
  while (current) {
    if ('locked' in current && current.locked) return true;
    current = current.parent;
  }
  return false;
}
function discover() {
  const targets: { node: CloudNode; selected: Selected }[] = [];
  const seen = new Set<string>();
  let reason = '';
  let ignored = 0;
  function visit(node: SceneNode): void {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE' || node.type === 'FRAME') {
      const result = readRecipe(node.getPluginData(RECIPE_KEY));
      const hasImage =
        Array.isArray(node.fills) &&
        node.fills.some((paint) => paint.type === 'IMAGE' && !!paint.imageHash);
      if (result.settings && hasImage) {
        targets.push({
          node,
          selected: {
            id: node.id,
            name: node.name,
            width: node.width,
            height: node.height,
            settings: cloudRecipe({ ...result.settings, width: node.width, height: node.height }),
            locked: isLocked(node),
          },
        });
      } else if (node.getPluginData(RECIPE_KEY)) {
        reason ||=
          result.reason || 'This cloud has no image fill. Restore its image before editing.';
      }
    }
    if ('children' in node) node.children.forEach(visit);
    else if (!targets.some((target) => target.node.id === node.id)) ignored++;
  }
  figma.currentPage.selection.forEach(visit);
  const selections = targets.map((target) => target.selected);
  const selectionReason =
    reason ||
    (ignored
      ? 'Unrelated layers were ignored; only image layers with cloud recipes can be edited.'
      : !selections.length
        ? 'Select a cloud layer, or a group or frame containing clouds.'
        : selections.some((item) => item.locked)
          ? 'Some selected clouds are locked. Unlock them before updating.'
          : undefined);
  return {
    targets,
    selections,
    selection: selections.length === 1 ? selections[0] : null,
    selectionReason,
  };
}
function selectionMessage() {
  const { selections, selection, selectionReason } = discover();
  return { selections, selection, selectionReason };
}
function sendSelection() {
  sendUI({ type: 'selection', ...selectionMessage() });
}
figma.on('selectionchange', sendSelection);

function selectedBounds(): Bounds | null {
  const bounds = figma.currentPage.selection
    .map(
      (node) =>
        node.absoluteBoundingBox ||
        ('width' in node ? { x: node.x, y: node.y, width: node.width, height: node.height } : null),
    )
    .filter(
      (rect): rect is Bounds =>
        !!rect &&
        [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
        rect.width > 0 &&
        rect.height > 0,
    );
  if (!bounds.length) return null;
  const x = Math.min(...bounds.map((rect) => rect.x)),
    y = Math.min(...bounds.map((rect) => rect.y));
  return {
    x,
    y,
    width: Math.max(...bounds.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...bounds.map((rect) => rect.y + rect.height)) - y,
  };
}
function selectionSignature(): string {
  return JSON.stringify({
    ids: figma.currentPage.selection.map((node) => node.id),
    bounds: selectedBounds(),
    clouds: discover().selections,
  });
}
function imageBytes(input: unknown, settings: Settings): Uint8Array {
  if (!(input instanceof Uint8Array) && !Array.isArray(input))
    throw new Error('Invalid cloud image. Try inserting again.');
  if (input.length < 24 || input.length > 64000000)
    throw new Error('Cloud image is empty or too large.');
  if (Array.isArray(input) && input.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    throw new Error('Invalid cloud image bytes.');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    !signature.every((n, i) => bytes[i] === n) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR'
  )
    throw new Error('Cloud image is not a valid PNG.');
  const size = exportSize(settings);
  const uint32 = (i: number) =>
    bytes[i] * 16777216 + bytes[i + 1] * 65536 + bytes[i + 2] * 256 + bytes[i + 3];
  if (uint32(16) !== size.width || uint32(20) !== size.height)
    throw new Error('Image dimensions do not match the cloud settings.');
  return bytes;
}
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid cloud request.');
  return input as Record<string, unknown>;
}
function apply(node: CloudNode, settings: Settings, imageHash: string): void {
  node.resize(settings.width, settings.height);
  node.fills = [{ type: 'IMAGE', imageHash, scaleMode: 'FIT' }];
  node.setPluginData(RECIPE_KEY, writeRecipe(settings));
  node.setRelaunchData({ edit: 'Edit cloud' });
}
function reportError(error: unknown, type = 'error', requestId?: unknown): void {
  if (headless) figma.ui.show();
  sendOutcome(
    {
      type,
      message: error instanceof Error ? error.message : 'Could not create this cloud. Try again.',
    },
    requestId,
  );
}
let saveQueue = Promise.resolve();
function saveLast(settings: Settings): void {
  saveQueue = saveQueue
    .then(() => figma.clientStorage.setAsync(STORAGE_KEY, settings))
    .catch(() => {
      /* Node recipe is already saved. */
    });
}
let presets: Preset[] = [],
  seedLocked = false;
let loadedPreferences: Promise<void> | undefined;
let preferenceQueue = Promise.resolve();
function loadPreferences(): Promise<void> {
  loadedPreferences ??= Promise.all([
    figma.clientStorage
      .getAsync(PRESETS_KEY)
      .then((raw: unknown) => {
        if (!Array.isArray(raw)) return;
        const ids = new Set<string>();
        presets = raw.slice(0, 12).flatMap((value) => {
          if (
            !value ||
            typeof value !== 'object' ||
            typeof value.id !== 'string' ||
            !value.id ||
            ids.has(value.id) ||
            typeof value.name !== 'string' ||
            !value.name.trim() ||
            !value.settings ||
            typeof value.settings !== 'object'
          )
            return [];
          ids.add(value.id);
          return [
            {
              id: value.id,
              name: value.name.trim().slice(0, 48),
              settings: cloudRecipe(value.settings),
            },
          ];
        });
      })
      .catch(() => {}),
    figma.clientStorage
      .getAsync(PREFERENCES_KEY)
      .then((raw: unknown) => {
        seedLocked =
          !!raw && typeof raw === 'object' && (raw as { seedLocked?: unknown }).seedLocked === true;
      })
      .catch(() => {}),
  ]).then(() => {});
  return loadedPreferences;
}
function sendPresets(requestId?: unknown): void {
  sendUI({
    type: 'presets',
    presets,
    seedLocked,
    requestId: typeof requestId === 'string' ? requestId : undefined,
  });
}
let sequence = 0;
let scatterPlan: { id: string; signature: string; jobs: ScatterJob[] } | null = null;
let busy = false;
figma.ui.onmessage = async (raw: unknown) => {
  if (!raw || typeof raw !== 'object') return;
  const msg = raw as Record<string, unknown>;
  if (msg.type === 'operation-status') {
    const outcome = typeof msg.requestId === 'string' ? outcomes.get(msg.requestId) : undefined;
    if (outcome)
      sendUI(
        outcome.type === 'done' ? { ...outcome, ...selectionMessage(), recovered: true } : outcome,
      );
    else
      sendUI({
        type: 'operation-status',
        requestId: msg.requestId,
        state: busy ? 'applying' : 'unknown',
      });
    return;
  }
  if (!CLOUD_FIELD_ENABLED && (msg.type === 'prepare-scatter' || msg.type === 'insert-many')) {
    reportError(new Error('Cloud field is disabled.'), 'error', msg.requestId);
    return;
  }
  if (msg.type === 'headless-error' && headless) {
    reportError(
      new Error(
        typeof msg.message === 'string'
          ? msg.message
          : 'Could not render the random cloud. Try again.',
      ),
    );
    return;
  }
  if (msg.type === 'selection-request') {
    sendSelection();
    return;
  }
  if (msg.type === 'ready') {
    sendSelection();
    if (headless)
      sendUI({
        type: 'headless-insert',
        settings: cloudRecipe({ ...DEFAULTS, seed: Math.floor(Math.random() * 1_000_000) }),
      });
    const preferences = loadPreferences().then(sendPresets);
    let saved: unknown;
    try {
      saved = await figma.clientStorage.getAsync(STORAGE_KEY);
    } catch {
      /* Defaults remain usable. */
    }
    sendUI({
      type: 'init',
      settings: saved ? normalize(saved) : null,
      ...selectionMessage(),
    });
    await preferences;
    return;
  }
  if (
    msg.type === 'save-preset' ||
    msg.type === 'delete-preset' ||
    msg.type === 'save-preferences'
  ) {
    preferenceQueue = preferenceQueue
      .then(async () => {
        await loadPreferences();
        if (msg.type === 'save-preferences') {
          if (typeof msg.seedLocked !== 'boolean') throw new Error('Invalid seed-lock preference.');
          await figma.clientStorage.setAsync(PREFERENCES_KEY, { seedLocked: msg.seedLocked });
          seedLocked = msg.seedLocked;
        } else {
          let next: Preset[];
          if (msg.type === 'save-preset') {
            if (typeof msg.name !== 'string' || !msg.name.trim() || msg.name.trim().length > 48)
              throw new Error('Preset names must contain 1 to 48 characters.');
            if (presets.length >= 12)
              throw new Error('You can save up to 12 custom presets. Delete one first.');
            next = [
              ...presets,
              {
                id: `preset-${Date.now()}-${++sequence}`,
                name: msg.name.trim(),
                settings: cloudRecipe(msg.settings),
              },
            ];
          } else {
            if (typeof msg.id !== 'string' || !presets.some((preset) => preset.id === msg.id))
              throw new Error('That custom preset no longer exists.');
            next = presets.filter((preset) => preset.id !== msg.id);
          }
          await figma.clientStorage.setAsync(PRESETS_KEY, next);
          presets = next;
        }
        sendPresets(msg.requestId);
      })
      .catch((error) => reportError(error, 'preset-error', msg.requestId));
    await preferenceQueue;
    return;
  }
  if (msg.type === 'prepare-scatter') {
    try {
      const settings = cloudRecipe(msg.settings);
      const bounds = selectedBounds() || {
        x: figma.viewport.center.x - settings.width,
        y: figma.viewport.center.y - settings.height,
        width: settings.width * 2,
        height: settings.height * 2,
      };
      const jobs = scatterJobs(settings, Number(msg.count), bounds);
      validateBatchBudget(jobs);
      scatterPlan = { id: `scatter-${++sequence}`, signature: selectionSignature(), jobs };
      sendUI({
        type: 'scatter-plan',
        requestId: msg.requestId,
        planId: scatterPlan.id,
        jobs,
      });
    } catch (error) {
      reportError(error, 'error', msg.requestId);
    }
    return;
  }
  if (!['insert', 'update', 'update-many', 'insert-many'].includes(String(msg.type)) || busy)
    return;
  const previousOutcome =
    typeof msg.requestId === 'string' ? outcomes.get(msg.requestId) : undefined;
  if (previousOutcome) {
    sendUI(previousOutcome);
    return;
  }
  busy = true;
  const created: RectangleNode[] = [];
  const previousSelection = [...figma.currentPage.selection];
  const snapshots: {
    node: CloudNode;
    width: number;
    height: number;
    fills: CloudNode['fills'];
    recipe: string;
    relaunch: { [command: string]: string };
  }[] = [];
  try {
    const batch = msg.type === 'update-many' || msg.type === 'insert-many';
    const source = batch ? msg.items : [msg];
    if (!Array.isArray(source) || !source.length || (batch && source.length > 24))
      throw new Error('A batch must contain between 1 and 24 clouds.');
    const items = source.map((value) => {
      const item = record(value),
        settings = cloudRecipe(item.settings);
      return { item, settings, bytes: imageBytes(item.bytes, settings) };
    });
    if (batch) validateBatchBudget(items);
    const updating = msg.type === 'update' || msg.type === 'update-many';
    const targets: CloudNode[] = [];
    if (updating) {
      const selected = discover().targets;
      if (selected.length !== items.length)
        throw new Error('Select the original unlocked clouds, then try Update again.');
      const ids = new Set<string>();
      for (const { item } of items) {
        const target = selected.find((value) => value.node.id === item.targetId)?.node;
        if (!target || ids.has(target.id) || isLocked(target))
          throw new Error('Select the original unlocked clouds, then try Update again.');
        ids.add(target.id);
        const expected = item.targetSize as { width?: unknown; height?: unknown } | undefined;
        if (
          (msg.type === 'update-many' && !expected) ||
          (expected && (expected.width !== target.width || expected.height !== target.height))
        )
          throw new Error(
            'This cloud was resized in Figma. Reselect it to load its current size, then update.',
          );
        targets.push(target);
      }
    } else if (msg.type === 'insert-many') {
      if (
        !scatterPlan ||
        msg.planId !== scatterPlan.id ||
        scatterPlan.signature !== selectionSignature() ||
        items.length !== scatterPlan.jobs.length
      )
        throw new Error('The scatter selection changed. Prepare a new scatter and try again.');
      items.forEach(({ item, settings }, i) => {
        const job = scatterPlan!.jobs[i];
        if (
          item.x !== job.x ||
          item.y !== job.y ||
          JSON.stringify(settings) !== JSON.stringify(job.settings)
        )
          throw new Error('Scatter settings changed. Prepare a new scatter and try again.');
      });
    }
    // Decode every image before changing any scene node.
    const images = items.map((item) => figma.createImage(item.bytes));
    const bounds = selectedBounds();
    items.forEach(({ item, settings }, i) => {
      let target = targets[i];
      if (target)
        snapshots.push({
          node: target,
          width: target.width,
          height: target.height,
          fills: target.fills,
          recipe: target.getPluginData(RECIPE_KEY),
          relaunch: target.getRelaunchData(),
        });
      else {
        target = figma.createRectangle();
        created.push(target);
        target.x =
          msg.type === 'insert-many'
            ? Number(item.x)
            : bounds
              ? bounds.x + bounds.width + 48
              : figma.viewport.center.x - settings.width / 2;
        target.y =
          msg.type === 'insert-many'
            ? Number(item.y)
            : bounds
              ? bounds.y
              : figma.viewport.center.y - settings.height / 2;
        target.name = `Cloud / ${PRESETS.find((preset) => preset.id === settings.preset)?.name || 'Custom'} / ${settings.seed}`;
        targets.push(target);
      }
      apply(target, settings, images[i].hash);
    });
    figma.currentPage.selection = targets;
    if (created.length) figma.viewport.scrollAndZoomIntoView(targets);
    figma.commitUndo();
    if (msg.type === 'insert-many') scatterPlan = null;
    sendOutcome({ type: 'done', action: msg.type, ...selectionMessage() }, msg.requestId);
    try {
      figma.notify(
        updating
          ? `${items.length > 1 ? `${items.length} clouds` : 'Cloud'} updated`
          : `${items.length > 1 ? `${items.length} clouds` : 'Cloud'} inserted`,
      );
    } catch {
      /* Notification failure must not roll back a completed insertion. */
    }
    saveLast(items[0].settings);
    if (headless) figma.closePlugin();
  } catch (error) {
    let rollbackFailed = false;
    for (const node of created) {
      try {
        node.remove();
      } catch {
        rollbackFailed = true;
      }
    }
    for (const snapshot of snapshots.reverse()) {
      try {
        snapshot.node.resize(snapshot.width, snapshot.height);
        snapshot.node.fills = snapshot.fills;
        snapshot.node.setPluginData(RECIPE_KEY, snapshot.recipe);
        snapshot.node.setRelaunchData(snapshot.relaunch);
      } catch {
        rollbackFailed = true;
      }
    }
    try {
      figma.currentPage.selection = previousSelection;
    } catch {
      rollbackFailed = true;
    }
    reportError(
      rollbackFailed
        ? new Error(
            'The operation failed and Figma could not restore every layer. Use Undo to recover the previous state.',
          )
        : error,
      'error',
      msg.requestId,
    );
  } finally {
    busy = false;
  }
};
