import { decodeProject, encodeProject, validatePattern } from "../core/pattern";
import type { BeadPattern } from "../core/pattern";
import {
  STORE_EDIT_DRAFTS,
  WORKSPACE_DRAFT_KEY,
  openDatabase,
  requestToPromise,
  runTransaction,
} from "./db";
import { StorageError } from "./errors";
import { assemblePattern } from "./project-repository";

export interface LoadedDraft {
  pattern: BeadPattern;
  locked: Uint8Array;
  /** R1 图层侧车：仅当草稿保存过基底时返回；旧草稿没有该字段。 */
  layers?: { base: Int16Array; overlay: Int16Array | null; visible: boolean };
}

/** R1 · 图层侧车随草稿持久化；不进 schema 1.0 项目 JSON。 */
export interface DraftLayers {
  base: Int16Array;
  overlay: Int16Array | null;
  visible: boolean;
}

export interface DraftRepository {
  save(pattern: BeadPattern, locked: Uint8Array, layers?: DraftLayers): Promise<void>;
  load(): Promise<LoadedDraft | null>;
  clear(): Promise<void>;
}

function defaultFactory(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new StorageError("E_IDB_UNAVAILABLE", "当前环境没有 IndexedDB。");
  }
  return indexedDB;
}

export function createDraftRepository(factory: IDBFactory = defaultFactory()): DraftRepository {
  return {
    async save(pattern, locked, layers) {
      validatePattern(pattern);
      const json = encodeProject(pattern);
      const cells = new Int16Array(pattern.cells);
      const lock = new Uint8Array(locked);
      const base = layers ? new Int16Array(layers.base) : null;
      const overlay = layers?.overlay ? new Int16Array(layers.overlay) : null;
      await runTransaction(factory, [STORE_EDIT_DRAFTS], "readwrite", (tx) => {
        tx.objectStore(STORE_EDIT_DRAFTS).put({
          id: WORKSPACE_DRAFT_KEY,
          patternId: pattern.id,
          width: pattern.width,
          height: pattern.height,
          cells: cells.buffer.slice(0),
          locked: lock.buffer.slice(0),
          base: base ? base.buffer.slice(0) : null,
          overlay: overlay ? overlay.buffer.slice(0) : null,
          refineVisible: layers ? layers.visible : true,
          palette: json.palette,
          settings: json.settings,
          source: json.source,
          mode: json.mode,
          paletteId: json.paletteId,
          paletteVersion: json.paletteVersion,
          paletteHash: json.paletteHash,
          title: json.title,
          createdAt: json.createdAt,
          updatedAt: json.updatedAt,
          schemaVersion: json.schemaVersion,
        });
      });
    },

    async load() {
      const db = await openDatabase(factory);
      try {
        const tx = db.transaction([STORE_EDIT_DRAFTS], "readonly");
        const row = await requestToPromise(tx.objectStore(STORE_EDIT_DRAFTS).get(WORKSPACE_DRAFT_KEY));
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        if (!row || typeof row !== "object") return null;
        const record = row as {
          width: number;
          height: number;
          cells: ArrayBuffer;
          locked: ArrayBuffer;
          base?: ArrayBuffer | null;
          overlay?: ArrayBuffer | null;
          refineVisible?: boolean;
          palette: unknown;
          settings: unknown;
          source: unknown;
          mode: string;
          paletteId: string;
          paletteVersion: string;
          paletteHash?: string;
          title: string;
          createdAt: string;
          updatedAt: string;
          schemaVersion: string;
          patternId: string;
        };
        const assembled = {
          id: record.patternId,
          version: 1 as const,
          cells: record.cells,
          palette: record.palette,
          settings: record.settings,
          source: record.source,
          mode: record.mode,
          paletteId: record.paletteId,
          paletteVersion: record.paletteVersion,
          title: record.title,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          schemaVersion: record.schemaVersion,
        };
        const pattern = assemblePattern(
          record.paletteHash
            ? { ...assembled, paletteHash: record.paletteHash }
            : assembled,
          record.width,
          record.height,
        );
        decodeProject(encodeProject(pattern));
        const locked = new Uint8Array(record.locked);
        const result: LoadedDraft = { pattern, locked };
        if (
          record.base &&
          record.base.byteLength === pattern.cells.length * 2
        ) {
          result.layers = {
            base: new Int16Array(record.base.slice(0)),
            overlay:
              record.overlay && record.overlay.byteLength === pattern.cells.length * 2
                ? new Int16Array(record.overlay.slice(0))
                : null,
            visible: record.refineVisible !== false,
          };
        }
        return result;
      } finally {
        db.close();
      }
    },

    async clear() {
      await runTransaction(factory, [STORE_EDIT_DRAFTS], "readwrite", (tx) => {
        tx.objectStore(STORE_EDIT_DRAFTS).delete(WORKSPACE_DRAFT_KEY);
      });
    },
  };
}

let current: DraftRepository | null = null;

export const defaultDraftRepository = {
  get(): DraftRepository {
    if (!current) current = createDraftRepository();
    return current;
  },
};
