"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // src/features.ts
  var CLOUD_FIELD_ENABLED = false;

  // src/cloud.ts
  var DEFAULTS = {
    shape: Array.from({ length: 5 }, () => ({ x: 0, y: 0 })),
    preset: "cumulus",
    seed: 992,
    softness: 13,
    spread: 12,
    frequency: 0.011,
    displacement: 145,
    octaves: 5,
    puffiness: 75,
    bottomFlattening: 0,
    color: "#FFFFFF",
    opacity: 100,
    width: 1e3,
    height: 700,
    quality: 2,
    background: "transparent",
    sky: "#8CB8DA",
    gradientEnabled: true,
    gradientColor: "#8FABC5",
    gradientStrength: 50,
    shadowMode: "transparency",
    selfShadows: false,
    shadowStrength: 40,
    lightAngle: 135
  };
  var PRESETS = [
    {
      id: "cumulus",
      name: "Cumulus",
      settings: {
        seed: 992,
        softness: 13,
        spread: 12,
        frequency: 0.011,
        displacement: 145,
        octaves: 5,
        puffiness: 75
      }
    },
    {
      id: "cotton",
      name: "Cotton",
      settings: {
        seed: 448,
        softness: 19,
        spread: 20,
        frequency: 0.013,
        displacement: 90,
        octaves: 6,
        puffiness: 95
      }
    },
    {
      id: "wispy",
      name: "Wispy",
      settings: {
        seed: 135,
        softness: 22,
        spread: 0,
        frequency: 8e-3,
        displacement: 245,
        octaves: 6,
        puffiness: 15
      }
    },
    {
      id: "haze",
      name: "Haze",
      settings: {
        seed: 633,
        softness: 42,
        spread: 25,
        frequency: 0.01,
        displacement: 155,
        octaves: 4,
        puffiness: 30
      }
    },
    {
      id: "storm",
      name: "Storm",
      settings: {
        seed: 947,
        softness: 15,
        spread: 30,
        frequency: 0.018,
        displacement: 220,
        octaves: 5,
        puffiness: 85,
        color: "#788595"
      }
    },
    {
      id: "stratus",
      name: "Stratus",
      settings: {
        seed: 265,
        softness: 11,
        spread: 10,
        frequency: 0.015,
        displacement: 55,
        octaves: 3,
        puffiness: 5
      }
    }
  ];
  function bounded(value, fallback, min, max, integer = false) {
    const v = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    const n = Math.min(max, Math.max(min, v));
    return integer ? Math.round(n) : n;
  }
  function color(value, fallback) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
  }
  function normalize(input) {
    const s = input && typeof input === "object" ? input : {};
    const d = DEFAULTS;
    return {
      shape: Array.from({ length: 5 }, (_, i) => {
        const point = Array.isArray(s.shape) ? s.shape[i] : void 0;
        return { x: bounded(point == null ? void 0 : point.x, 0, -0.5, 0.5), y: bounded(point == null ? void 0 : point.y, 0, -0.5, 0.5) };
      }),
      gradientEnabled: typeof s.gradientEnabled === "boolean" ? s.gradientEnabled : d.gradientEnabled,
      gradientColor: color(s.gradientColor, d.gradientColor),
      gradientStrength: bounded(s.gradientStrength, d.gradientStrength, 0, 100),
      shadowMode: s.shadowMode === "shade" || s.shadowMode === "transparency" ? s.shadowMode : d.shadowMode,
      selfShadows: s.selfShadows === true,
      shadowStrength: bounded(s.shadowStrength, d.shadowStrength, 0, 100),
      lightAngle: bounded(s.lightAngle, d.lightAngle, 0, 360),
      preset: typeof s.preset === "string" && PRESETS.some((p) => p.id === s.preset) ? s.preset : "custom",
      seed: bounded(s.seed, d.seed, 0, 999999, true),
      softness: bounded(s.softness, d.softness, 1, 50),
      spread: bounded(s.spread, d.spread, 0, 60),
      frequency: bounded(s.frequency, d.frequency, 3e-3, 0.04),
      displacement: bounded(s.displacement, d.displacement, 0, 260),
      octaves: bounded(s.octaves, d.octaves, 1, 8, true),
      puffiness: bounded(s.puffiness, d.puffiness, 0, 100),
      bottomFlattening: bounded(s.bottomFlattening, 0, 0, 100),
      color: color(s.color, d.color),
      sky: color(s.sky, d.sky),
      opacity: bounded(s.opacity, d.opacity, 0, 100),
      width: bounded(s.width, d.width, 64, 4096, true),
      height: bounded(s.height, d.height, 64, 4096, true),
      quality: bounded(s.quality, d.quality, 1, 3, true),
      background: s.background === "sky" ? "sky" : "transparent"
    };
  }
  function exportSize(settings) {
    const s = normalize(settings);
    const width = s.width * s.quality, height = s.height * s.quality;
    if (width > 4096 || height > 4096 || width * height > 16e6) {
      throw new Error("Use a smaller size or scale. Maximum: 4096 px per side and 16 megapixels.");
    }
    return { width, height };
  }

  // src/settings.ts
  function cloudRecipe(input) {
    return __spreadProps(__spreadValues({}, normalize(input)), { background: "transparent", sky: DEFAULTS.sky });
  }

  // src/recipes.ts
  var RECIPE_KEY = "clouds-recipe-v1";
  var RECIPE_VERSION = 2;
  function readRecipe(raw) {
    if (!raw) return { settings: null, reason: "No cloud recipe" };
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") throw new Error();
      if (typeof data.version === "number" && data.version > RECIPE_VERSION) {
        return {
          settings: null,
          reason: "This cloud uses a newer, unsupported recipe version. Update the plugin to edit it."
        };
      }
      if (data.version !== 1 && data.version !== RECIPE_VERSION || !data.settings || typeof data.settings !== "object" || Array.isArray(data.settings))
        throw new Error();
      const settings = data.settings;
      return { settings: cloudRecipe(__spreadValues({ gradientEnabled: false, shadowMode: "shade" }, settings)) };
    } catch (e) {
      return { settings: null, reason: "This layer has an invalid or unsupported cloud recipe." };
    }
  }
  function writeRecipe(settings) {
    return JSON.stringify({ version: RECIPE_VERSION, settings: cloudRecipe(settings) });
  }

  // src/scatter.ts
  var MAX_BATCH_COUNT = 24;
  var MAX_BATCH_PIXELS = 32e6;
  var MAX_BATCH_BYTES = 128e6;
  function scatterJobs(settings, count, bounds) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH_COUNT)
      throw new Error("Choose between 1 and 24 clouds.");
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width < 64 || bounds.height < 64)
      throw new Error("Scatter bounds must be at least 64 by 64 pixels.");
    let seed = settings.seed >>> 0;
    const next = () => {
      seed = Math.imul(seed, 1664525) + 1013904223 >>> 0;
      return seed / 4294967296;
    };
    const columns = Math.ceil(Math.sqrt(count * bounds.width / bounds.height));
    const rows = Math.ceil(count / columns);
    const cellWidth = bounds.width / columns;
    const cellHeight = bounds.height / rows;
    return Array.from({ length: count }, (_, i) => {
      const scale = Math.min(cellWidth / settings.width, cellHeight / settings.height, 1) * (0.65 + next() * 0.3);
      const item = normalize(__spreadProps(__spreadValues({}, settings), {
        seed: Math.floor(next() * 1e6),
        width: Math.max(64, Math.floor(settings.width * scale)),
        height: Math.max(64, Math.floor(settings.height * scale))
      }));
      const x = bounds.x + i % columns * cellWidth + Math.max(0, cellWidth - item.width) * next();
      const y = bounds.y + Math.floor(i / columns) * cellHeight + Math.max(0, cellHeight - item.height) * next();
      return {
        settings: item,
        x: Math.min(x, bounds.x + bounds.width - item.width),
        y: Math.min(y, bounds.y + bounds.height - item.height)
      };
    });
  }
  function validateBatchBudget(items) {
    var _a;
    if (!items.length || items.length > MAX_BATCH_COUNT)
      throw new Error("A batch must contain between 1 and 24 clouds.");
    let pixels = 0, bytes = 0;
    for (const item of items) {
      const size = exportSize(item.settings);
      pixels += size.width * size.height;
      bytes += ((_a = item.bytes) == null ? void 0 : _a.length) || 0;
    }
    if (pixels > MAX_BATCH_PIXELS)
      throw new Error(
        "This batch exceeds 32 million pixels. Reduce the count, size, or export quality."
      );
    if (bytes > MAX_BATCH_BYTES)
      throw new Error("This batch exceeds 128 MB of encoded images. Reduce the count or size.");
  }

  // code.ts
  var STORAGE_KEY = "clouds-last-settings-v1";
  var PRESETS_KEY = "clouds-custom-presets-v1";
  var PREFERENCES_KEY = "clouds-preferences-v1";
  var headless = figma.command === "random";
  var bridgeSession = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  var uiHTML = __html__.replace(
    "<!-- CLOUDS_SESSION -->",
    () => `<meta name="clouds-session" content="${bridgeSession}">`
  );
  figma.showUI(uiHTML, { width: 360, height: 740, themeColors: true, visible: !headless });
  function sendUI(message) {
    figma.ui.postMessage(__spreadProps(__spreadValues({}, message), { bridgeSession }));
  }
  var outcomes = /* @__PURE__ */ new Map();
  function sendOutcome(message, requestId) {
    const result = __spreadProps(__spreadValues({}, message), { requestId });
    if (typeof requestId === "string" && requestId.length <= 200) {
      outcomes.set(requestId, result);
      while (outcomes.size > 16) outcomes.delete(outcomes.keys().next().value);
    }
    sendUI(result);
  }
  function isLocked(node) {
    let current = node;
    while (current) {
      if ("locked" in current && current.locked) return true;
      current = current.parent;
    }
    return false;
  }
  function discover() {
    const targets = [];
    const seen = /* @__PURE__ */ new Set();
    let reason = "";
    let ignored = 0;
    function visit(node) {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      if (node.type === "RECTANGLE" || node.type === "ELLIPSE" || node.type === "FRAME") {
        const result = readRecipe(node.getPluginData(RECIPE_KEY));
        const hasImage = Array.isArray(node.fills) && node.fills.some((paint) => paint.type === "IMAGE" && !!paint.imageHash);
        if (result.settings && hasImage) {
          targets.push({
            node,
            selected: {
              id: node.id,
              name: node.name,
              width: node.width,
              height: node.height,
              settings: cloudRecipe(__spreadProps(__spreadValues({}, result.settings), { width: node.width, height: node.height })),
              locked: isLocked(node)
            }
          });
        } else if (node.getPluginData(RECIPE_KEY)) {
          reason || (reason = result.reason || "This cloud has no image fill. Restore its image before editing.");
        }
      }
      if ("children" in node) node.children.forEach(visit);
      else if (!targets.some((target) => target.node.id === node.id)) ignored++;
    }
    figma.currentPage.selection.forEach(visit);
    const selections = targets.map((target) => target.selected);
    const selectionReason = reason || (ignored ? "Unrelated layers were ignored; only image layers with cloud recipes can be edited." : !selections.length ? "Select a cloud layer, or a group or frame containing clouds." : selections.some((item) => item.locked) ? "Some selected clouds are locked. Unlock them before updating." : void 0);
    return {
      targets,
      selections,
      selection: selections.length === 1 ? selections[0] : null,
      selectionReason
    };
  }
  function selectionMessage() {
    const { selections, selection, selectionReason } = discover();
    return { selections, selection, selectionReason };
  }
  function sendSelection() {
    sendUI(__spreadValues({ type: "selection" }, selectionMessage()));
  }
  figma.on("selectionchange", sendSelection);
  function selectedBounds() {
    const bounds = figma.currentPage.selection.map(
      (node) => node.absoluteBoundingBox || ("width" in node ? { x: node.x, y: node.y, width: node.width, height: node.height } : null)
    ).filter(
      (rect) => !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0
    );
    if (!bounds.length) return null;
    const x = Math.min(...bounds.map((rect) => rect.x)), y = Math.min(...bounds.map((rect) => rect.y));
    return {
      x,
      y,
      width: Math.max(...bounds.map((rect) => rect.x + rect.width)) - x,
      height: Math.max(...bounds.map((rect) => rect.y + rect.height)) - y
    };
  }
  function selectionSignature() {
    return JSON.stringify({
      ids: figma.currentPage.selection.map((node) => node.id),
      bounds: selectedBounds(),
      clouds: discover().selections
    });
  }
  function imageBytes(input, settings) {
    if (!(input instanceof Uint8Array) && !Array.isArray(input))
      throw new Error("Invalid cloud image. Try inserting again.");
    if (input.length < 24 || input.length > 64e6)
      throw new Error("Cloud image is empty or too large.");
    if (Array.isArray(input) && input.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
      throw new Error("Invalid cloud image bytes.");
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((n, i) => bytes[i] === n) || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR")
      throw new Error("Cloud image is not a valid PNG.");
    const size = exportSize(settings);
    const uint32 = (i) => bytes[i] * 16777216 + bytes[i + 1] * 65536 + bytes[i + 2] * 256 + bytes[i + 3];
    if (uint32(16) !== size.width || uint32(20) !== size.height)
      throw new Error("Image dimensions do not match the cloud settings.");
    return bytes;
  }
  function record(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid cloud request.");
    return input;
  }
  function apply(node, settings, imageHash) {
    node.resize(settings.width, settings.height);
    node.fills = [{ type: "IMAGE", imageHash, scaleMode: "FIT" }];
    node.setPluginData(RECIPE_KEY, writeRecipe(settings));
    node.setRelaunchData({ edit: "Edit cloud" });
  }
  function reportError(error, type = "error", requestId) {
    if (headless) figma.ui.show();
    sendOutcome(
      {
        type,
        message: error instanceof Error ? error.message : "Could not create this cloud. Try again."
      },
      requestId
    );
  }
  var saveQueue = Promise.resolve();
  function saveLast(settings) {
    saveQueue = saveQueue.then(() => figma.clientStorage.setAsync(STORAGE_KEY, settings)).catch(() => {
    });
  }
  var presets = [];
  var seedLocked = false;
  var loadedPreferences;
  var preferenceQueue = Promise.resolve();
  function loadPreferences() {
    loadedPreferences != null ? loadedPreferences : loadedPreferences = Promise.all([
      figma.clientStorage.getAsync(PRESETS_KEY).then((raw) => {
        if (!Array.isArray(raw)) return;
        const ids = /* @__PURE__ */ new Set();
        presets = raw.slice(0, 12).flatMap((value) => {
          if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id || ids.has(value.id) || typeof value.name !== "string" || !value.name.trim() || !value.settings || typeof value.settings !== "object")
            return [];
          ids.add(value.id);
          return [
            {
              id: value.id,
              name: value.name.trim().slice(0, 48),
              settings: cloudRecipe(value.settings)
            }
          ];
        });
      }).catch(() => {
      }),
      figma.clientStorage.getAsync(PREFERENCES_KEY).then((raw) => {
        seedLocked = !!raw && typeof raw === "object" && raw.seedLocked === true;
      }).catch(() => {
      })
    ]).then(() => {
    });
    return loadedPreferences;
  }
  function sendPresets(requestId) {
    sendUI({
      type: "presets",
      presets,
      seedLocked,
      requestId: typeof requestId === "string" ? requestId : void 0
    });
  }
  var sequence = 0;
  var scatterPlan = null;
  var busy = false;
  figma.ui.onmessage = async (raw) => {
    var _a;
    if (!raw || typeof raw !== "object") return;
    const msg = raw;
    if (msg.type === "operation-status") {
      const outcome = typeof msg.requestId === "string" ? outcomes.get(msg.requestId) : void 0;
      if (outcome)
        sendUI(
          outcome.type === "done" ? __spreadProps(__spreadValues(__spreadValues({}, outcome), selectionMessage()), { recovered: true }) : outcome
        );
      else
        sendUI({
          type: "operation-status",
          requestId: msg.requestId,
          state: busy ? "applying" : "unknown"
        });
      return;
    }
    if (!CLOUD_FIELD_ENABLED && (msg.type === "prepare-scatter" || msg.type === "insert-many")) {
      reportError(new Error("Cloud field is disabled."), "error", msg.requestId);
      return;
    }
    if (msg.type === "headless-error" && headless) {
      reportError(
        new Error(
          typeof msg.message === "string" ? msg.message : "Could not render the random cloud. Try again."
        )
      );
      return;
    }
    if (msg.type === "selection-request") {
      sendSelection();
      return;
    }
    if (msg.type === "ready") {
      sendSelection();
      if (headless)
        sendUI({
          type: "headless-insert",
          settings: cloudRecipe(__spreadProps(__spreadValues({}, DEFAULTS), { seed: Math.floor(Math.random() * 1e6) }))
        });
      const preferences = loadPreferences().then(sendPresets);
      let saved;
      try {
        saved = await figma.clientStorage.getAsync(STORAGE_KEY);
      } catch (e) {
      }
      sendUI(__spreadValues({
        type: "init",
        settings: saved ? normalize(saved) : null
      }, selectionMessage()));
      await preferences;
      return;
    }
    if (msg.type === "save-preset" || msg.type === "delete-preset" || msg.type === "save-preferences") {
      preferenceQueue = preferenceQueue.then(async () => {
        await loadPreferences();
        if (msg.type === "save-preferences") {
          if (typeof msg.seedLocked !== "boolean") throw new Error("Invalid seed-lock preference.");
          await figma.clientStorage.setAsync(PREFERENCES_KEY, { seedLocked: msg.seedLocked });
          seedLocked = msg.seedLocked;
        } else {
          let next;
          if (msg.type === "save-preset") {
            if (typeof msg.name !== "string" || !msg.name.trim() || msg.name.trim().length > 48)
              throw new Error("Preset names must contain 1 to 48 characters.");
            if (presets.length >= 12)
              throw new Error("You can save up to 12 custom presets. Delete one first.");
            next = [
              ...presets,
              {
                id: `preset-${Date.now()}-${++sequence}`,
                name: msg.name.trim(),
                settings: cloudRecipe(msg.settings)
              }
            ];
          } else {
            if (typeof msg.id !== "string" || !presets.some((preset) => preset.id === msg.id))
              throw new Error("That custom preset no longer exists.");
            next = presets.filter((preset) => preset.id !== msg.id);
          }
          await figma.clientStorage.setAsync(PRESETS_KEY, next);
          presets = next;
        }
        sendPresets(msg.requestId);
      }).catch((error) => reportError(error, "preset-error", msg.requestId));
      await preferenceQueue;
      return;
    }
    if (msg.type === "prepare-scatter") {
      try {
        const settings = cloudRecipe(msg.settings);
        const bounds = selectedBounds() || {
          x: figma.viewport.center.x - settings.width,
          y: figma.viewport.center.y - settings.height,
          width: settings.width * 2,
          height: settings.height * 2
        };
        const jobs = scatterJobs(settings, Number(msg.count), bounds);
        validateBatchBudget(jobs);
        scatterPlan = { id: `scatter-${++sequence}`, signature: selectionSignature(), jobs };
        sendUI({
          type: "scatter-plan",
          requestId: msg.requestId,
          planId: scatterPlan.id,
          jobs
        });
      } catch (error) {
        reportError(error, "error", msg.requestId);
      }
      return;
    }
    if (!["insert", "update", "update-many", "insert-many"].includes(String(msg.type)) || busy)
      return;
    const previousOutcome = typeof msg.requestId === "string" ? outcomes.get(msg.requestId) : void 0;
    if (previousOutcome) {
      sendUI(previousOutcome);
      return;
    }
    busy = true;
    const created = [];
    const previousSelection = [...figma.currentPage.selection];
    const snapshots = [];
    try {
      const batch = msg.type === "update-many" || msg.type === "insert-many";
      const source = batch ? msg.items : [msg];
      if (!Array.isArray(source) || !source.length || batch && source.length > 24)
        throw new Error("A batch must contain between 1 and 24 clouds.");
      const items = source.map((value) => {
        const item = record(value), settings = cloudRecipe(item.settings);
        return { item, settings, bytes: imageBytes(item.bytes, settings) };
      });
      if (batch) validateBatchBudget(items);
      const updating = msg.type === "update" || msg.type === "update-many";
      const targets = [];
      if (updating) {
        const selected = discover().targets;
        if (selected.length !== items.length)
          throw new Error("Select the original unlocked clouds, then try Update again.");
        const ids = /* @__PURE__ */ new Set();
        for (const { item } of items) {
          const target = (_a = selected.find((value) => value.node.id === item.targetId)) == null ? void 0 : _a.node;
          if (!target || ids.has(target.id) || isLocked(target))
            throw new Error("Select the original unlocked clouds, then try Update again.");
          ids.add(target.id);
          const expected = item.targetSize;
          if (msg.type === "update-many" && !expected || expected && (expected.width !== target.width || expected.height !== target.height))
            throw new Error(
              "This cloud was resized in Figma. Reselect it to load its current size, then update."
            );
          targets.push(target);
        }
      } else if (msg.type === "insert-many") {
        if (!scatterPlan || msg.planId !== scatterPlan.id || scatterPlan.signature !== selectionSignature() || items.length !== scatterPlan.jobs.length)
          throw new Error("The scatter selection changed. Prepare a new scatter and try again.");
        items.forEach(({ item, settings }, i) => {
          const job = scatterPlan.jobs[i];
          if (item.x !== job.x || item.y !== job.y || JSON.stringify(settings) !== JSON.stringify(job.settings))
            throw new Error("Scatter settings changed. Prepare a new scatter and try again.");
        });
      }
      const images = items.map((item) => figma.createImage(item.bytes));
      const bounds = selectedBounds();
      items.forEach(({ item, settings }, i) => {
        var _a2;
        let target = targets[i];
        if (target)
          snapshots.push({
            node: target,
            width: target.width,
            height: target.height,
            fills: target.fills,
            recipe: target.getPluginData(RECIPE_KEY),
            relaunch: target.getRelaunchData()
          });
        else {
          target = figma.createRectangle();
          created.push(target);
          target.x = msg.type === "insert-many" ? Number(item.x) : bounds ? bounds.x + bounds.width + 48 : figma.viewport.center.x - settings.width / 2;
          target.y = msg.type === "insert-many" ? Number(item.y) : bounds ? bounds.y : figma.viewport.center.y - settings.height / 2;
          target.name = `Cloud / ${((_a2 = PRESETS.find((preset) => preset.id === settings.preset)) == null ? void 0 : _a2.name) || "Custom"} / ${settings.seed}`;
          targets.push(target);
        }
        apply(target, settings, images[i].hash);
      });
      figma.currentPage.selection = targets;
      if (created.length) figma.viewport.scrollAndZoomIntoView(targets);
      figma.commitUndo();
      if (msg.type === "insert-many") scatterPlan = null;
      sendOutcome(__spreadValues({ type: "done", action: msg.type }, selectionMessage()), msg.requestId);
      try {
        figma.notify(
          updating ? `${items.length > 1 ? `${items.length} clouds` : "Cloud"} updated` : `${items.length > 1 ? `${items.length} clouds` : "Cloud"} inserted`
        );
      } catch (e) {
      }
      saveLast(items[0].settings);
      if (headless) figma.closePlugin();
    } catch (error) {
      let rollbackFailed = false;
      for (const node of created) {
        try {
          node.remove();
        } catch (e) {
          rollbackFailed = true;
        }
      }
      for (const snapshot of snapshots.reverse()) {
        try {
          snapshot.node.resize(snapshot.width, snapshot.height);
          snapshot.node.fills = snapshot.fills;
          snapshot.node.setPluginData(RECIPE_KEY, snapshot.recipe);
          snapshot.node.setRelaunchData(snapshot.relaunch);
        } catch (e) {
          rollbackFailed = true;
        }
      }
      try {
        figma.currentPage.selection = previousSelection;
      } catch (e) {
        rollbackFailed = true;
      }
      reportError(
        rollbackFailed ? new Error(
          "The operation failed and Figma could not restore every layer. Use Undo to recover the previous state."
        ) : error,
        "error",
        msg.requestId
      );
    } finally {
      busy = false;
    }
  };
})();
