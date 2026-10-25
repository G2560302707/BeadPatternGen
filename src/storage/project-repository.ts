import {
  EMPTY_CELL,
  MAX_CELL_COUNT,
  decodeProject,
  encodeProject,
  validatePattern,
} from "../core/pattern";
import type { BeadPattern } from "../core/pattern";
import type { PersistedImage } from "../features/image-import/session-bytes";
import { exportPng } from "../export/png";
import {
  STORE_PATTERNS,
  STORE_PROJECTS,
  STORE_THUMBS,
  openDatabase,
  requestToPromise,
  runTransaction,
  type PatternRecord,
  type ProjectMeta,
} from "./db";
import { StorageError } from "./errors";

export const QUOTA_WARN_RATIO = 0.8;

export function quotaSnapshot(usage: number, quota: number): QuotaSnapshot {
  const ratio = quota > 0 ? usage / quota : 0;
  return { usage, quota, ratio, warn: ratio >= QUOTA_WARN_RATIO };
}
export const MAX_IMPORT_STRING = 4096;

export type SaveStatus = "unsaved" | "saving" | "saved";

export interface LoadedProject {
  meta: ProjectMeta;
  pattern: BeadPattern;
  /** 原图快照：保存时内存里有原图才会带上；打开项目后对照条可用。 */
  source?: PersistedImage;
  /** 构图产物快照：构图流程中图纸真正的采样来源。 */
  generationSource?: PersistedImage;
}

export interface QuotaSnapshot {
  usage: number;
  quota: number;
  ratio: number;
  warn: boolean;
}

export interface ProjectRepository {
  save(
    pattern: BeadPattern,
    source?: PersistedImage | null,
    generationSource?: PersistedImage | null,
  ): Promise<ProjectMeta>;
  load(id: string): Promise<LoadedProject>;
  list(): Promise<ProjectMeta[]>;
  remove(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  estimate(): Promise<QuotaSnapshot>;
  purgeThumbnails(): Promise<number>;
  /** 读取保存时生成的缩略图 PNG；没有则返回 undefined（首页作品卡用）。 */
  getThumbnail(id: string): Promise<ArrayBuffer | undefined>;
}

function defaultFactory(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new StorageError("E_IDB_UNAVAILABLE", "当前环境没有 IndexedDB。");
  }
  return indexedDB;
}

function toMeta(pattern: BeadPattern): ProjectMeta {
  return {
    id: pattern.id,
    title: pattern.title,
    updatedAt: pattern.updatedAt,
    createdAt: pattern.createdAt,
    width: pattern.width,
    height: pattern.height,
    paletteId: pattern.paletteId,
    paletteVersion: pattern.paletteVersion,
    mode: pattern.mode,
    schemaVersion: pattern.schemaVersion,
  };
}

function recordFromPattern(
  pattern: BeadPattern,
  source?: PersistedImage | null,
  generationSource?: PersistedImage | null,
): PatternRecord {
  validatePattern(pattern);
  const cells = new Int16Array(pattern.cells);
  const json = encodeProject(pattern);
  const record: PatternRecord = {
    id: pattern.id,
    version: 1,
    cells: cells.buffer.slice(0),
    palette: json.palette,
    settings: json.settings,
    source: json.source,
    mode: json.mode,
    paletteId: json.paletteId,
    paletteVersion: json.paletteVersion,
    title: json.title,
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
    schemaVersion: json.schemaVersion,
  };
  if (json.paletteHash !== undefined) {
    record.paletteHash = json.paletteHash;
  }
  if (source) {
    record.imageSource = {
      ...source,
      bytes: source.bytes.slice().buffer,
    };
  }
  if (generationSource) {
    record.generationSource = {
      ...generationSource,
      bytes: generationSource.bytes.slice().buffer,
    };
  }
  return record;
}

/** 从独立 cells 缓冲和 JSON 字段重建 BeadPattern。 */
export function assemblePattern(record: PatternRecord, width: number, height: number): BeadPattern {
  const cells = Array.from(new Int16Array(record.cells));
  if (cells.length !== width * height) {
    throw new StorageError(
      "E_CORRUPT_RECORD",
      `格子长度 ${cells.length} 与尺寸 ${width}×${height} 不符。`,
    );
  }
  return decodeProject({
    schemaVersion: record.schemaVersion,
    id: record.id,
    title: record.title,
    width,
    height,
    cells,
    palette: record.palette,
    mode: record.mode,
    paletteId: record.paletteId,
    paletteVersion: record.paletteVersion,
    paletteHash: record.paletteHash,
    settings: record.settings,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export function createProjectRepository(factory: IDBFactory = defaultFactory()): ProjectRepository {
  return {
    async save(pattern, source, generationSource) {
      validatePattern(pattern);
      const meta = toMeta(pattern);
      const record = recordFromPattern(pattern, source, generationSource);
      let thumb: ArrayBuffer | null = null;
      try {
        const png = exportPng(pattern, {
          cellSize: 8,
          showGrid: false,
          showCoords: false,
          showCodes: false,
          showLegend: false,
        });
        const copy = new Uint8Array(png.byteLength);
        copy.set(png);
        thumb = copy.buffer;
      } catch {
        thumb = null;
      }

      await runTransaction(
        factory,
        [STORE_PROJECTS, STORE_PATTERNS, STORE_THUMBS],
        "readwrite",
        async (tx) => {
          tx.objectStore(STORE_PROJECTS).put(meta);
          tx.objectStore(STORE_PATTERNS).put(record);
          if (thumb) {
            tx.objectStore(STORE_THUMBS).put({ id: pattern.id, bytes: thumb });
          }
        },
      );
      return meta;
    },

    async load(id) {
      const db = await openDatabase(factory);
      try {
        const tx = db.transaction([STORE_PROJECTS, STORE_PATTERNS], "readonly");
        const meta = await requestToPromise(tx.objectStore(STORE_PROJECTS).get(id));
        const record = await requestToPromise(tx.objectStore(STORE_PATTERNS).get(id));
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        if (!meta || !record) {
          throw new StorageError("E_NOT_FOUND", `找不到项目 ${id}。`);
        }
        const pattern = assemblePattern(
          record as PatternRecord,
          (meta as ProjectMeta).width,
          (meta as ProjectMeta).height,
        );
        const loaded: LoadedProject = { meta: meta as ProjectMeta, pattern };
        const saved = (record as PatternRecord).imageSource;
        if (
          saved &&
          saved.bytes &&
          saved.bytes.byteLength > 0 &&
          Number.isInteger(saved.width) &&
          saved.width > 0 &&
          saved.height > 0 &&
          saved.crop
        ) {
          loaded.source = {
            ...saved,
            format: saved.format as PersistedImage["format"],
            bytes: new Uint8Array(saved.bytes),
          };
        }
        const savedGeneration = (record as PatternRecord).generationSource;
        if (
          savedGeneration &&
          savedGeneration.bytes &&
          savedGeneration.bytes.byteLength > 0 &&
          Number.isInteger(savedGeneration.width) &&
          savedGeneration.width > 0 &&
          savedGeneration.height > 0
        ) {
          loaded.generationSource = {
            ...savedGeneration,
            format: savedGeneration.format as PersistedImage["format"],
            bytes: new Uint8Array(savedGeneration.bytes),
          };
        }
        return loaded;
      } finally {
        db.close();
      }
    },

    async list() {
      const db = await openDatabase(factory);
      try {
        const tx = db.transaction(STORE_PROJECTS, "readonly");
        const rows = await requestToPromise(tx.objectStore(STORE_PROJECTS).getAll());
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        return (rows as ProjectMeta[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      } finally {
        db.close();
      }
    },

    async remove(id) {
      await runTransaction(
        factory,
        [STORE_PROJECTS, STORE_PATTERNS, STORE_THUMBS],
        "readwrite",
        (tx) => {
          tx.objectStore(STORE_PROJECTS).delete(id);
          tx.objectStore(STORE_PATTERNS).delete(id);
          tx.objectStore(STORE_THUMBS).delete(id);
        },
      );
    },

    async exists(id) {
      const db = await openDatabase(factory);
      try {
        const tx = db.transaction(STORE_PROJECTS, "readonly");
        const row = await requestToPromise(tx.objectStore(STORE_PROJECTS).get(id));
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        return row !== undefined;
      } finally {
        db.close();
      }
    },

    async estimate() {
      if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
        return { usage: 0, quota: Number.POSITIVE_INFINITY, ratio: 0, warn: false };
      }
      const snap = await navigator.storage.estimate();
      return quotaSnapshot(snap.usage ?? 0, snap.quota ?? 0);
    },

    async purgeThumbnails() {
      let removed = 0;
      await runTransaction(factory, [STORE_THUMBS], "readwrite", async (tx) => {
        const all = await requestToPromise(tx.objectStore(STORE_THUMBS).getAllKeys());
        removed = all.length;
        tx.objectStore(STORE_THUMBS).clear();
      });
      return removed;
    },

    async getThumbnail(id) {
      const db = await openDatabase(factory);
      try {
        const tx = db.transaction(STORE_THUMBS, "readonly");
        const row = await requestToPromise(tx.objectStore(STORE_THUMBS).get(id));
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        return row?.bytes;
      } finally {
        db.close();
      }
    },
  };
}

export function assertImportLimits(raw: unknown): void {
  if (typeof raw === "string" && raw.length > 8_000_000) {
    throw new StorageError("E_IMPORT_TOO_LARGE", `JSON 超过 8MB（${raw.length} 字符），拒绝导入。`);
  }
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new StorageError("E_IMPORT_SCHEMA", "项目 JSON 根节点必须是对象。");
  }
  const record = value as Record<string, unknown>;
  for (const key of ["title", "paletteId", "paletteVersion", "id"] as const) {
    const field = record[key];
    if (typeof field === "string" && field.length > MAX_IMPORT_STRING) {
      throw new StorageError("E_IMPORT_STRING", `${key} 超过 ${MAX_IMPORT_STRING} 字符。`);
    }
  }
  if (typeof record.width === "number" && typeof record.height === "number") {
    if (record.width * record.height > MAX_CELL_COUNT) {
      throw new StorageError("E_IMPORT_SIZE", `网格 ${record.width}×${record.height} 超过上限。`);
    }
  }
  if (Array.isArray(record.cells) && record.cells.length > MAX_CELL_COUNT) {
    throw new StorageError("E_IMPORT_SIZE", `cells 长度 ${record.cells.length} 超过上限。`);
  }
}

export function importPatternJson(raw: string): BeadPattern {
  assertImportLimits(raw);
  const pattern = decodeProject(raw);
  for (const cell of pattern.cells) {
    if (cell !== EMPTY_CELL && (cell < 0 || cell >= pattern.palette.length)) {
      throw new StorageError("E_IMPORT_INDEX", `格子索引 ${cell} 不在色卡范围内。`);
    }
  }
  return pattern;
}

export const defaultRepository = {
  current: null as ProjectRepository | null,
  get(): ProjectRepository {
    if (!this.current) this.current = createProjectRepository();
    return this.current;
  },
};
