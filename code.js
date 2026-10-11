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

  // src/cloud.ts
  var DEFAULTS = {
    preset: "cumulus",
    seed: 992,
    softness: 13,
    spread: 12,
    frequency: 0.011,
    displacement: 145,
    octaves: 5,
    puffiness: 75,
    color: "#FFFFFF",
    opacity: 100,
    width: 1e3,
    height: 700,
    quality: 2,
    background: "transparent",
    sky: "#8CB8DA"
  };
  var PRESETS = [
    { id: "cumulus", name: "Cumulus", settings: { seed: 992, softness: 13, spread: 12, frequency: 0.011, displacement: 145, octaves: 5, puffiness: 75 } },
    { id: "cotton", name: "Cotton", settings: { seed: 448, softness: 19, spread: 20, frequency: 0.013, displacement: 90, octaves: 6, puffiness: 95 } },
    { id: "wispy", name: "Wispy", settings: { seed: 135, softness: 22, spread: 0, frequency: 8e-3, displacement: 245, octaves: 6, puffiness: 15 } },
    { id: "haze", name: "Haze", settings: { seed: 633, softness: 42, spread: 25, frequency: 0.01, displacement: 155, octaves: 4, puffiness: 30 } },
    { id: "storm", name: "Storm", settings: { seed: 947, softness: 15, spread: 30, frequency: 0.018, displacement: 220, octaves: 5, puffiness: 85, color: "#788595" } },
    { id: "stratus", name: "Stratus", settings: { seed: 265, softness: 11, spread: 10, frequency: 0.015, displacement: 55, octaves: 3, puffiness: 5 } }
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
      preset: typeof s.preset === "string" && PRESETS.some((p) => p.id === s.preset) ? s.preset : "custom",
      seed: bounded(s.seed, d.seed, 0, 999999, true),
      softness: bounded(s.softness, d.softness, 1, 50),
      spread: bounded(s.spread, d.spread, 0, 60),
      frequency: bounded(s.frequency, d.frequency, 3e-3, 0.04),
      displacement: bounded(s.displacement, d.displacement, 0, 260),
      octaves: bounded(s.octaves, d.octaves, 1, 8, true),
      puffiness: bounded(s.puffiness, d.puffiness, 0, 100),
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

  // code.ts
  var RECIPE_KEY = "clouds-recipe-v1";
  var STORAGE_KEY = "clouds-last-settings-v1";
  figma.showUI(__html__, { width: 360, height: 740, themeColors: true });
  function isLocked(node) {
    let current = node;
    while (current) {
      if ("locked" in current && current.locked) return true;
      current = current.parent;
    }
    return false;
  }
  function recipe(node) {
    if (node.type !== "RECTANGLE") return null;
    try {
      const raw = node.getPluginData(RECIPE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data.version === 1 && data.settings ? normalize(data.settings) : null;
    } catch (e) {
      return null;
    }
  }
  function selection() {
    const nodes = figma.currentPage.selection;
    const node = nodes.length === 1 ? nodes[0] : null;
    const settings = node && recipe(node);
    return settings && node ? { id: node.id, name: node.name, width: node.width, height: node.height, settings: normalize(__spreadProps(__spreadValues({}, settings), { width: node.width, height: node.height })), locked: isLocked(node) } : null;
  }
  function sendSelection() {
    figma.ui.postMessage({ type: "selection", selection: selection() });
  }
  figma.on("selectionchange", sendSelection);
  function imageBytes(input, settings) {
    if (!(input instanceof Uint8Array) && !Array.isArray(input)) throw new Error("Invalid cloud image. Try inserting again.");
    if (input.length < 24 || input.length > 64e6) throw new Error("Cloud image is empty or too large.");
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((n, i) => bytes[i] === n) || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") {
      throw new Error("Cloud image is not a valid PNG.");
    }
    const size = exportSize(settings);
    const uint32 = (i) => bytes[i] * 16777216 + bytes[i + 1] * 65536 + bytes[i + 2] * 256 + bytes[i + 3];
    if (uint32(16) !== size.width || uint32(20) !== size.height) throw new Error("Image dimensions do not match the cloud settings.");
    return bytes;
  }
  var busy = false;
  var saveQueue = Promise.resolve();
  figma.ui.onmessage = async (raw) => {
    var _a;
    if (!raw || typeof raw !== "object") return;
    const msg = raw;
    if (msg.type === "ready") {
      let saved;
      try {
        saved = await figma.clientStorage.getAsync(STORAGE_KEY);
      } catch (e) {
      }
      figma.ui.postMessage({ type: "init", settings: saved ? normalize(saved) : null, selection: selection() });
      return;
    }
    if (msg.type !== "insert" && msg.type !== "update") return;
    if (busy) return;
    busy = true;
    let created = null;
    try {
      const settings = cloudRecipe(msg.settings);
      const bytes = imageBytes(msg.bytes, settings);
      let target = null;
      if (msg.type === "update") {
        const nodes = figma.currentPage.selection;
        if (nodes.length !== 1 || nodes[0].id !== msg.targetId || nodes[0].type !== "RECTANGLE" || !recipe(nodes[0]) || isLocked(nodes[0])) {
          throw new Error("Select the original unlocked cloud, then try Update again.");
        }
        target = nodes[0];
        const expected = msg.targetSize;
        if (expected && (expected.width !== target.width || expected.height !== target.height)) {
          throw new Error("This cloud was resized in Figma. Reselect it to load its current size, then update.");
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
      target.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FIT" }];
      target.setPluginData(RECIPE_KEY, JSON.stringify({ version: 1, settings }));
      if (created) target.name = `Cloud / ${((_a = PRESETS.find((p) => p.id === settings.preset)) == null ? void 0 : _a.name) || "Custom"} / ${settings.seed}`;
      figma.currentPage.selection = [target];
      if (created) figma.viewport.scrollAndZoomIntoView([target]);
      figma.commitUndo();
      created = null;
      figma.ui.postMessage({ type: "done", action: msg.type, selection: selection() });
      figma.notify(msg.type === "update" ? "Cloud updated" : "Cloud inserted");
      saveQueue = saveQueue.then(() => figma.clientStorage.setAsync(STORAGE_KEY, settings)).catch(() => {
      });
    } catch (error) {
      if (created) created.remove();
      figma.ui.postMessage({ type: "error", message: error instanceof Error ? error.message : "Could not create this cloud. Try again." });
    } finally {
      busy = false;
    }
  };
})();
