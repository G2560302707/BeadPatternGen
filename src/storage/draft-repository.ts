import { decodeProject, encodeProject, validatePattern } from "../core/pattern";
import type { BeadPattern } from "../core/pattern";
import type { PersistedImage } from "../features/image-import/session-bytes";
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
  /** 原图快照：保存时内存里有原图才会带上；恢复后对照条可用。 */
  source?: PersistedImage;
  /** 构图产物快照：构图流程中图纸真正的采样来源，恢复后对照比例保持一致。 */
  generationSource?: PersistedImage;
}

/** R1 · 图层侧车随草稿持久化；不进 schema 1.0 项目 JSON。 */
export interface DraftLayers {
  base: Int16Array;
  overlay: Int16Array | null;
  visible: boolean;
}

export interface DraftRepository {
  save(
    pattern: BeadPattern,
    locked: Uint8Array,
    layers?: DraftLayers,
    source?: PersistedImage | null,
    generationSource?: PersistedImage | null,
  ): Promise<void>;
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
    async save(pattern, locked, layers, source, generationSource) {
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
          imageSource: source
            ? { ...source, bytes: source.bytes.slice().buffer }
            : null,
          generationSource: generationSource
            ? { ...generationSource, bytes: generationSource.bytes.slice().buffer }
            : null,
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
          imageSource?: {
            bytes: ArrayBuffer;
            mimeType: string;
            fileName: string;
            format: string;
            formatLabel: string;
            sourceImageId: string;
            width: number;
            height: number;
            crop: { x: number; y: number; width: number; height: number };
          } | null;
          generationSource?: {
            bytes: ArrayBuffer;
            mimeType: string;
            fileName: string;
            format: string;
            formatLabel: string;
            sourceImageId: string;
            width: number;
            height: number;
            crop: { x: number; y: number; width: number; height: number };
          } | null;
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
          record.imageSource &&
          record.imageSource.bytes &&
          record.imageSource.bytes.byteLength > 0 &&
          Number.isInteger(record.imageSource.width) &&
          record.imageSource.width > 0 &&
          record.imageSource.height > 0 &&
          record.imageSource.crop
        ) {
          result.source = {
            ...record.imageSource,
            format: record.imageSource.format as PersistedImage["format"],
            bytes: new Uint8Array(record.imageSource.bytes),
          };
        }
        const savedGeneration = record.generationSource;
        if (
          savedGeneration &&
          savedGeneration.bytes &&
          savedGeneration.bytes.byteLength > 0 &&
          Number.isInteger(savedGeneration.width) &&
          savedGeneration.width > 0 &&
          savedGeneration.height > 0
        ) {
          result.generationSource = {
            ...savedGeneration,
            format: savedGeneration.format as PersistedImage["format"],
            bytes: new Uint8Array(savedGeneration.bytes),
          };
        }
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
