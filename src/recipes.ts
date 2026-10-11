import { cloudRecipe } from './settings';
import type { Settings } from './cloud';

// Keep the original key so existing layers remain discoverable after migration.
export const RECIPE_KEY = 'clouds-recipe-v1';
export const RECIPE_VERSION = 2;
export type RecipeResult =
  { settings: Settings; reason?: never } | { settings: null; reason: string };
export function readRecipe(raw: string): RecipeResult {
  if (!raw) return { settings: null, reason: 'No cloud recipe' };
  try {
    const data = JSON.parse(raw) as { version?: unknown; settings?: unknown };
    if (!data || typeof data !== 'object') throw new Error();
    if (typeof data.version === 'number' && data.version > RECIPE_VERSION) {
      return {
        settings: null,
        reason:
          'This cloud uses a newer, unsupported recipe version. Update the plugin to edit it.',
      };
    }
    if (
      (data.version !== 1 && data.version !== RECIPE_VERSION) ||
      !data.settings ||
      typeof data.settings !== 'object' ||
      Array.isArray(data.settings)
    )
      throw new Error();
    const settings = data.settings as Record<string, unknown>;
    return { settings: cloudRecipe({ gradientEnabled: false, shadowMode: 'shade', ...settings }) };
  } catch {
    return { settings: null, reason: 'This layer has an invalid or unsupported cloud recipe.' };
  }
}
export function writeRecipe(settings: Settings): string {
  return JSON.stringify({ version: RECIPE_VERSION, settings: cloudRecipe(settings) });
}
