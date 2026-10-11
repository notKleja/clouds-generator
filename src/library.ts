import { type Settings } from './cloud';
import { cloudRecipe } from './settings';

/** Apply a shared edit while preserving untouched properties of each cloud. */
export function batchRecipes(
  reference: Settings,
  draft: Settings,
  targets: Settings[],
): Settings[] {
  const before = cloudRecipe(reference),
    after = cloudRecipe(draft);
  const patch: Partial<Settings> = {};
  for (const key of Object.keys(after) as (keyof Settings)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      Object.assign(patch, { [key]: after[key] });
  }
  return targets.map((target) => cloudRecipe({ ...target, ...patch }));
}
export function presetRecipe(
  current: Settings,
  values: Partial<Settings>,
  seedLocked: boolean,
): Settings {
  return cloudRecipe({ ...current, ...values, ...(seedLocked ? { seed: current.seed } : {}) });
}
export function variantRecipes(recipe: Settings): Settings[] {
  return Array.from({ length: 6 }, (_, i) =>
    cloudRecipe({ ...recipe, seed: (recipe.seed + (i + 1) * 104729) % 1000000 }),
  );
}
