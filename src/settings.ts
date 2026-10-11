import { DEFAULTS, normalize, type Settings } from './cloud';
/** Background preferences belong to the preview, never the exported layer recipe. */
export function cloudRecipe(input: unknown): Settings {
  return { ...normalize(input), background: 'transparent', sky: DEFAULTS.sky };
}
