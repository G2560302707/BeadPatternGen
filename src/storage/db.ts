/**
 * IndexedDB 封装。组件不得直接打开 IDB。
 *
 * 版本历史：
 * - v1：projects / patterns / thumbnails（一期）
 * - v2：新增 subjects（主体元数据 + 蒙版 Blob）与 compositions（构图配置）；
 *        仅创建新仓与新索引，不读写旧仓，升级过程旧数据保持不变。
 * - v3：新增 edit-drafts（编辑自动保存草稿）。不改 v1/v2 仓与记录形状。
 */

import type {
  BBox,
  CompositionParams,
  SegmentationModelRef,
  SubjectMaskEncoding,
} from "../core/subject/types";

export const DB_NAME = "bead-pattern-generator";
export const DB_VERSION = 3;
export const STORE_PROJECTS = "projects";
export const STORE_PATTERNS = "patterns";
export const STORE_THUMBS = "thumbnails";
export const STORE_SUBJECTS = "subjects";
export const STORE_COMPOSITIONS = "compositions";
export const STORE_EDIT_DRAFTS = "edit-drafts";
export const WORKSPACE_DRAFT_KEY = "workspace-draft";

/** subjects 仓内的记录种类判别字段。 */
export const SUBJECT_RECORD_SUBJECT = "subject";
export const SUBJECT_RECORD_MASK = "mask";

export const SUBJECT_INDEX_KIND = "by-kind";
export const SUBJECT_INDEX_SOURCE_IMAGE = "by-source-image";
export const COMPOSITION_INDEX_SUBJECT = "by-subject";
export const COMPOSITION_INDEX_UPDATED_AT = "by-updated-at";

export interface ProjectMeta {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  width: number;
  height: number;
  paletteId: string;
  paletteVersion: string;
  mode: string;
  schemaVersion: string;
}

export interface PatternRecord {
  id: string;
  version: number;
  cells: ArrayBuffer;
  /** 原图快照（可选）：保存时内存里有原图才带上，用于打开项目后恢复对照。 */
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
  };
  /** 构图产物快照（可选）：构图流程中图纸真正的采样来源。 */
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
  };
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
}

export interface ThumbnailRecord {
  id: string;
  bytes: ArrayBuffer;
}

/**
 * 主体元数据记录。蒙版像素不在这里，只保存指向 `SubjectMaskRecord` 的键。
 */
export interface SubjectMetadataRecord {
  kind: typeof SUBJECT_RECORD_SUBJECT;
  id: string;
  sourceImageId: string;
  maskId: string;
  bbox: BBox;
  confidence: number;
  label: string;
  createdAt: string;
}

/**
 * 蒙版记录：元数据 + 二进制 Blob。
 *
 * 与元数据同仓不同记录，通过 `kind` 区分（`SUBJECT_INDEX_KIND` 可过滤），
 * 从而把大块二进制与列表查询隔离开，同时保持"只新增 subjects / compositions 两个仓"的约定。
 */
export interface SubjectMaskRecord {
  kind: typeof SUBJECT_RECORD_MASK;
  id: string;
  sourceImageId: string;
  width: number;
  height: number;
  encoding: SubjectMaskEncoding;
  threshold: number;
  model: SegmentationModelRef;
  /** raw-alpha8 字节，长度 = width × height；IndexedDB 原生支持 Blob。 */
  blob: Blob;
  byteLength: number;
  createdAt: string;
}

export type SubjectStoreRecord = SubjectMetadataRecord | SubjectMaskRecord;

/** 构图配置记录（纯 JSON，可序列化）。 */
export interface CompositionRecord {
  id: string;
  schemaVersion: "1.0";
  subjectId: string;
  sourceImageId: string;
  params: CompositionParams;
  createdAt: string;
  updatedAt: string;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * 建仓（若已存在则跳过）。只在 versionchange 事务内调用。
 * 返回新建的仓；已存在时返回 null，避免重复建索引报 ConstraintError。
 */
function createStoreIfMissing(
  db: IDBDatabase,
  name: string,
  options?: IDBObjectStoreParameters,
): IDBObjectStore | null {
  if (db.objectStoreNames.contains(name)) return null;
  return db.createObjectStore(name, options);
}

/**
 * 版本迁移。纯增量：只创建缺失的仓与索引，绝不删除或重写旧仓数据。
 *
 * @param oldVersion 升级前的数据库版本（新库为 0）。
 */
export function migrateDatabase(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    createStoreIfMissing(db, STORE_PROJECTS, { keyPath: "id" });
    createStoreIfMissing(db, STORE_PATTERNS, { keyPath: "id" });
    createStoreIfMissing(db, STORE_THUMBS, { keyPath: "id" });
  }

  if (oldVersion < 2) {
    const subjects = createStoreIfMissing(db, STORE_SUBJECTS, { keyPath: "id" });
    if (subjects) {
      subjects.createIndex(SUBJECT_INDEX_KIND, "kind", { unique: false });
      subjects.createIndex(SUBJECT_INDEX_SOURCE_IMAGE, "sourceImageId", { unique: false });
    }
    const compositions = createStoreIfMissing(db, STORE_COMPOSITIONS, { keyPath: "id" });
    if (compositions) {
      compositions.createIndex(COMPOSITION_INDEX_SUBJECT, "subjectId", { unique: false });
      compositions.createIndex(COMPOSITION_INDEX_UPDATED_AT, "updatedAt", { unique: false });
    }
  }

  if (oldVersion < 3) {
    createStoreIfMissing(db, STORE_EDIT_DRAFTS, { keyPath: "id" });
  }
}

export function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = (event) => {
      migrateDatabase(open.result, event.oldVersion);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB open failed"));
  });
}

export async function runTransaction<T>(
  factory: IDBFactory,
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDatabase(factory);
  try {
    const tx = db.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
    const value = await work(tx);
    await done;
    return value;
  } finally {
    db.close();
  }
}

/** 等待事务提交（只读事务同样需要等待，确保连接可安全关闭）。 */
export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export { requestToPromise };
