import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { normalizeRequester, type RequesterPayload } from "./cookies";

export interface AutoDownloadStore {
  isEnabled(requester: RequesterPayload | string): Promise<boolean>;
  enable(requester: RequesterPayload | string): Promise<boolean>;
  disable(requester: RequesterPayload | string): Promise<boolean>;
  toggle(requester: RequesterPayload | string): Promise<boolean>;
  list(): Promise<string[]>;
}

function toRequesterId(input: RequesterPayload | string): string | null {
  if (typeof input === "string") {
    return normalizeRequester({ from: input });
  }
  return normalizeRequester(input);
}

/**
 * Creates an AutoDownloadStore that persists enabled Requester phone numbers to a JSON file.
 */
export function createAutoDownloadStore(filePath: string): AutoDownloadStore {
  const absolutePath = resolve(filePath);
  let loaded = false;
  const enabledSet = new Set<string>();
  let writeQueue = Promise.resolve();

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    try {
      const content = await readFile(absolutePath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item.trim()) {
            const normalized = normalizeRequester({ from: item.trim() });
            if (normalized) enabledSet.add(normalized);
          }
        }
      } else if (parsed && Array.isArray(parsed.enabled)) {
        for (const item of parsed.enabled) {
          if (typeof item === "string" && item.trim()) {
            const normalized = normalizeRequester({ from: item.trim() });
            if (normalized) enabledSet.add(normalized);
          }
        }
      } else if (parsed && typeof parsed === "object") {
        for (const [key, val] of Object.entries(parsed)) {
          if (val === true && key.trim()) {
            const normalized = normalizeRequester({ from: key.trim() });
            if (normalized) enabledSet.add(normalized);
          }
        }
      }
    } catch {
      // File missing or invalid JSON: start with empty set
    }
    loaded = true;
  }

  function persist(): Promise<void> {
    writeQueue = writeQueue
      .then(async () => {
        await mkdir(dirname(absolutePath), { recursive: true });
        const tmpPath = `${absolutePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
        const data = JSON.stringify(
          { enabled: Array.from(enabledSet).sort() },
          null,
          2,
        );
        await writeFile(tmpPath, data, "utf-8");
        await rename(tmpPath, absolutePath);
      })
      .catch(() => {
        // Best-effort write failure handling
      });
    return writeQueue;
  }

  return {
    async isEnabled(requester) {
      await ensureLoaded();
      const id = toRequesterId(requester);
      if (!id) return false;
      return enabledSet.has(id);
    },

    async enable(requester) {
      await ensureLoaded();
      const id = toRequesterId(requester);
      if (!id) return false;
      if (!enabledSet.has(id)) {
        enabledSet.add(id);
        await persist();
      }
      return true;
    },

    async disable(requester) {
      await ensureLoaded();
      const id = toRequesterId(requester);
      if (!id) return false;
      if (enabledSet.has(id)) {
        enabledSet.delete(id);
        await persist();
      }
      return true;
    },

    async toggle(requester) {
      await ensureLoaded();
      const id = toRequesterId(requester);
      if (!id) return false;
      const isCurrentlyEnabled = enabledSet.has(id);
      if (isCurrentlyEnabled) {
        enabledSet.delete(id);
      } else {
        enabledSet.add(id);
      }
      await persist();
      return !isCurrentlyEnabled;
    },

    async list() {
      await ensureLoaded();
      return Array.from(enabledSet).sort();
    },
  };
}
