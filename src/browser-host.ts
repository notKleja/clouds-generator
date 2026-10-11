import { exportSize, type Settings } from './cloud';
import { cloudRecipe } from './settings';

interface WebPreset {
  id: string;
  name: string;
  settings: Settings;
}
interface WebState {
  version: 1;
  draft: Settings | null;
  presets: WebPreset[];
  seedLocked: boolean;
}
type Message = Record<string, unknown>;
type BrowserStorage = Pick<Storage, 'getItem' | 'setItem'>;
const STORAGE_KEY = 'clouds-generator:web:v1';

/** Browser-only persistence and file delivery. Rendering stays in the shared engine. */
export class BrowserHost {
  private state: WebState = { version: 1, draft: null, presets: [], seedLocked: false };
  private storageUnavailable = false;
  private storageNoticeSent = false;
  private outcomes = new Map<string, Message>();
  constructor(
    private storage: BrowserStorage | null,
    private emit: (message: Message) => void,
    private download: (bytes: Uint8Array, filename: string) => void | Promise<void>,
  ) {
    this.refresh();
  }
  private refresh() {
    if (this.storageUnavailable) return;
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!this.storage) this.storageUnavailable = true;
      if (!raw) return;
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1) return;
      const value = data as Record<string, unknown>,
        ids = new Set<string>();
      this.state = {
        version: 1,
        draft: value.draft && typeof value.draft === 'object' ? cloudRecipe(value.draft) : null,
        seedLocked: value.seedLocked === true,
        presets: Array.isArray(value.presets)
          ? value.presets.slice(0, 12).flatMap((item) => {
              if (
                !item ||
                typeof item !== 'object' ||
                typeof item.id !== 'string' ||
                ids.has(item.id) ||
                typeof item.name !== 'string' ||
                !item.name.trim() ||
                !item.settings ||
                typeof item.settings !== 'object'
              )
                return [];
              ids.add(item.id);
              return [
                {
                  id: item.id,
                  name: item.name.trim().slice(0, 48),
                  settings: cloudRecipe(item.settings),
                },
              ];
            })
          : [],
      };
    } catch {
      this.storageUnavailable = true;
    }
  }
  private save() {
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.storageUnavailable = false;
    } catch {
      this.storageUnavailable = true;
    }
  }
  private notice() {
    if (!this.storageUnavailable || this.storageNoticeSent) return;
    this.storageNoticeSent = true;
    this.emit({
      type: 'web-notice',
      message:
        'Browser storage is unavailable. You can still download; saved presets will last for this tab only.',
    });
  }
  private library(requestId?: unknown) {
    this.emit({
      type: 'presets',
      presets: this.state.presets,
      seedLocked: this.state.seedLocked,
      requestId,
    });
    this.notice();
  }
  private outcome(message: Message, requestId: unknown) {
    const result = { ...message, requestId };
    if (typeof requestId === 'string') {
      this.outcomes.set(requestId, result);
      while (this.outcomes.size > 16) this.outcomes.delete(this.outcomes.keys().next().value!);
    }
    this.emit(result);
  }
  async receive(input: unknown): Promise<void> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const msg = input as Message;
    try {
      if (
        ['ready', 'save-draft', 'save-preferences', 'save-preset', 'delete-preset'].includes(
          String(msg.type),
        )
      )
        this.refresh();
      switch (msg.type) {
        case 'ready':
          this.emit({ type: 'init', settings: this.state.draft, selection: null, selections: [] });
          this.library();
          return;
        case 'selection-request':
          this.emit({ type: 'selection', selection: null, selections: [] });
          return;
        case 'save-draft':
          this.state.draft = cloudRecipe(msg.settings);
          this.save();
          this.notice();
          return;
        case 'save-preferences':
          if (typeof msg.seedLocked !== 'boolean') throw new Error('Invalid seed-lock preference.');
          this.state.seedLocked = msg.seedLocked;
          this.save();
          this.library(msg.requestId);
          return;
        case 'save-preset': {
          if (typeof msg.name !== 'string' || !msg.name.trim() || msg.name.trim().length > 48)
            throw new Error('Enter a preset name of 1–48 characters.');
          if (this.state.presets.length >= 12)
            throw new Error('Delete a saved preset before adding another (12 maximum).');
          this.state.presets.push({
            id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name: msg.name.trim(),
            settings: cloudRecipe(msg.settings),
          });
          this.save();
          this.library(msg.requestId);
          return;
        }
        case 'delete-preset':
          if (!this.state.presets.some((p) => p.id === msg.id))
            throw new Error('That preset no longer exists.');
          this.state.presets = this.state.presets.filter((p) => p.id !== msg.id);
          this.save();
          this.library(msg.requestId);
          return;
        case 'operation-status':
          this.emit(
            typeof msg.requestId === 'string' && this.outcomes.has(msg.requestId)
              ? this.outcomes.get(msg.requestId)!
              : { type: 'operation-status', requestId: msg.requestId, state: 'unknown' },
          );
          return;
        case 'insert': {
          if (typeof msg.requestId === 'string' && this.outcomes.has(msg.requestId)) {
            this.emit(this.outcomes.get(msg.requestId)!);
            return;
          }
          const recipe = cloudRecipe(msg.settings),
            size = exportSize(recipe);
          if (!(msg.bytes instanceof Uint8Array) && !Array.isArray(msg.bytes))
            throw new Error('The download did not contain a PNG. Try again.');
          const bytes = new Uint8Array(msg.bytes);
          if (
            bytes.length < 24 ||
            bytes.length > 64000000 ||
            ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) ||
            String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR'
          )
            throw new Error('The download did not contain a valid PNG.');
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          if (view.getUint32(16) !== size.width || view.getUint32(20) !== size.height)
            throw new Error('PNG dimensions do not match the requested size.');
          await this.download(bytes, `cloud-${recipe.seed}-${size.width}x${size.height}.png`);
          this.refresh();
          this.state.draft = recipe;
          this.save();
          this.notice();
          this.outcome(
            { type: 'done', action: 'insert', selection: null, selections: [] },
            msg.requestId,
          );
          return;
        }
        default:
          return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not complete this action.';
      if (['save-preset', 'delete-preset', 'save-preferences'].includes(String(msg.type)))
        this.emit({ type: 'preset-error', requestId: msg.requestId, message });
      else this.outcome({ type: 'error', message }, msg.requestId);
    }
  }
}
