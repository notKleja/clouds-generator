import { createSVG, normalize, type Settings } from './cloud';
import { cloudRecipe } from './settings';
import { paintPreview } from './render';
import { presetRecipe, variantRecipes } from './library';

export interface SavedPreset {
  id: string;
  name: string;
  settings: Settings;
}
export class CloudLibrary {
  seedLocked = false;
  private seedTouched = false;
  private presets: SavedPreset[] = [];
  private generation = 0;
  private generating = false;
  private saving: string | null = null;
  private requestSequence = 0;
  constructor(
    private current: () => Settings,
    private apply: (recipe: Settings) => void,
    private post: (message: unknown) => void,
    private busy: () => boolean,
    private status: (message: string, error?: boolean) => void,
  ) {
    this.el('seed-lock').addEventListener('change', () => {
      this.seedTouched = true;
      this.seedLocked = (this.el('seed-lock') as HTMLInputElement).checked;
      this.post({ type: 'save-preferences', seedLocked: this.seedLocked });
    });
    this.el('save-preset').onclick = () => {
      if (this.busy() || this.saving) return;
      const input = this.el('preset-name') as HTMLInputElement,
        name = input.value.trim();
      if (!name) {
        input.focus();
        this.status('Name this preset before saving.', true);
        return;
      }
      if (this.presets.length >= 12) {
        this.status('Delete a saved preset before adding another (12 maximum).', true);
        return;
      }
      this.saving = `save-preset-${++this.requestSequence}`;
      this.syncDisabled();
      this.post({ type: 'save-preset', requestId: this.saving, name, settings: this.current() });
      this.status('Saving preset…');
    };
    this.el('preset-name').addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') this.el('save-preset').click();
    });
    this.el('generate-variations').onclick = () => {
      void this.variations();
    };
  }
  private el(id: string) {
    return document.getElementById(id)!;
  }
  receive(message: { presets?: SavedPreset[]; seedLocked?: boolean; requestId?: string }) {
    if (!this.seedTouched && typeof message.seedLocked === 'boolean')
      this.seedLocked = message.seedLocked;
    this.el('seed-lock').toggleAttribute('checked', this.seedLocked);
    if (!Array.isArray(message.presets)) return;
    this.presets = message.presets
      .slice(0, 12)
      .filter((p) => typeof p.id === 'string' && typeof p.name === 'string')
      .map((p) => ({ id: p.id, name: p.name.slice(0, 48), settings: cloudRecipe(p.settings) }));
    if (this.saving && message.requestId === this.saving) {
      this.saving = null;
      (this.el('preset-name') as HTMLInputElement).value = '';
      this.status('Preset saved.');
    }
    this.syncDisabled();
    this.el('saved-count').textContent = String(this.presets.length);
    this.el('saved-empty').hidden = this.presets.length > 0;
    const grid = this.el('saved-presets');
    grid.replaceChildren();
    for (const preset of this.presets) {
      const card = document.createElement('div');
      card.className = 'saved-card';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset saved-preset';
      button.disabled = this.busy();
      button.setAttribute('aria-label', `Apply saved preset ${preset.name}`);
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.width = 100;
      img.height = 43;
      img.src = `data:image/svg+xml,${encodeURIComponent(createSVG(preset.settings, 200, 140))}`;
      const label = document.createElement('span');
      label.textContent = preset.name;
      button.append(img, label);
      button.onclick = () => {
        if (!this.busy())
          this.apply(presetRecipe(this.current(), preset.settings, this.seedLocked));
      };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'saved-delete';
      remove.disabled = this.busy();
      remove.title = `Delete ${preset.name}`;
      remove.setAttribute('aria-label', `Delete saved preset ${preset.name}`);
      remove.innerHTML =
        '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6 4.5V2.5h4v2M4.5 4.5l.5 9h6l.5-9M6.5 7v4M9.5 7v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      remove.onclick = () => {
        if (!this.busy()) this.post({ type: 'delete-preset', id: preset.id });
      };
      card.append(button, remove);
      grid.append(card);
    }
  }
  syncDisabled() {
    this.el('generate-variations').toggleAttribute('disabled', this.busy() || this.generating);
    this.el('save-preset').toggleAttribute('disabled', this.busy() || !!this.saving);
  }
  failed(message: string, requestId?: string) {
    if (requestId === this.saving) this.saving = null;
    this.syncDisabled();
    this.status(message, true);
  }
  cancelVariations() {
    this.generation++;
    this.generating = false;
    this.el('variation-status').textContent = '';
    this.syncDisabled();
  }
  private async variations() {
    if (this.busy() || this.generating) return;
    const id = ++this.generation,
      recipes = variantRecipes(normalize(this.current()));
    this.generating = true;
    this.syncDisabled();
    const grid = this.el('variations');
    grid.replaceChildren();
    try {
      for (let i = 0; i < recipes.length; i++) {
        if (id !== this.generation || this.busy()) return;
        this.el('variation-status').textContent = `Generating ${i + 1} of 6…`;
        const recipe = recipes[i],
          button = document.createElement('button');
        button.className = 'variation';
        button.type = 'button';
        button.setAttribute('aria-label', `Use variation ${i + 1}, seed ${recipe.seed}`);
        button.disabled = true;
        const canvas = document.createElement('canvas'),
          caption = document.createElement('span');
        caption.textContent = String(recipe.seed);
        button.append(canvas, caption);
        grid.append(button);
        await paintPreview(canvas, recipe, () => id === this.generation && !this.busy());
        if (id !== this.generation || this.busy()) return;
        button.disabled = false;
        button.onclick = () => {
          if (!this.busy()) this.apply(cloudRecipe({ ...this.current(), seed: recipe.seed }));
        };
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      this.el('variation-status').textContent = 'Choose a variation to use its seed.';
    } catch (error) {
      if (id === this.generation) this.status((error as Error).message, true);
    } finally {
      if (id === this.generation) {
        this.generating = false;
        this.syncDisabled();
      }
    }
  }
}
