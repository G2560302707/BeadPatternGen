/**
 * S11 · 主体与构图持久化仓库。
 *
 * 约定：
 * - 组件不得直接打开 IDB，只能通过本仓库。
 * - subjects 仓同时存放两类记录（`kind: "subject"` 元数据 / `kind: "mask"` 蒙版 + Blob），
 *   元数据通过 `maskId` 引用蒙版记录，列表查询不会触碰大块二进制。
 * - 所有写入前先跑运行时守卫；读回时把损坏记录转成 `StorageError`，绝不把半截数据交给上层。
 */

import { isComposition, isSegmentationModelRef, isSubject, isSubjectMask } from "../core/subject";
import type { Composition, Subject, SubjectMask, SubjectWithMask } from "../core/subject";
import {
  COMPOSITION_INDEX_SUBJECT,
  STORE_COMPOSITIONS,
  STORE_SUBJECTS,
  SUBJECT_INDEX_SOURCE_IMAGE,
  SUBJECT_RECORD_MASK,
  SUBJECT_RECORD_SUBJECT,
  openDatabase,
  requestToPromise,
  runTransaction,
  transactionDone,
  type CompositionRecord,
  type SubjectMaskRecord,
  type SubjectMetadataRecord,
} from "./db";
import { StorageError } from "./errors";

/** 蒙版 Blob 的 MIME；真实编码由记录里的 `encoding` 字段描述。 */
export const MASK_BLOB_MIME = "application/octet-stream";

export interface SubjectRepository {
  /** 原子写入主体元数据与蒙版 Blob。 */
  saveSubject(subject: Subject, mask: SubjectMask): Promise<Subject>;
  loadSubject(id: string): Promise<SubjectWithMask>;
  /** 按原图 id 过滤；不传则返回全部主体。 */
  listSubjects(sourceImageId?: string): Promise<Subject[]>;
  /** 同时删除元数据与蒙版；不存在时静默返回。 */
  removeSubject(id: string): Promise<void>;
  loadMask(maskId: string): Promise<SubjectMask>;

  saveComposition(composition: Composition): Promise<Composition>;
  loadComposition(id: string): Promise<Composition>;
  listCompositions(subjectId?: string): Promise<Composition[]>;
  removeComposition(id: string): Promise<void>;
}

function defaultFactory(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new StorageError("E_IDB_UNAVAILABLE", "当前环境没有 IndexedDB。");
  }
  return indexedDB;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function subjectRecordFrom(subject: Subject): SubjectMetadataRecord {
  return {
    kind: SUBJECT_RECORD_SUBJECT,
    id: subject.id,
    sourceImageId: subject.sourceImageId,
    maskId: subject.maskId,
    bbox: { ...subject.bbox },
    confidence: subject.confidence,
    label: subject.label,
    createdAt: subject.createdAt,
  };
}

function maskRecordFrom(maskId: string, mask: SubjectMask): SubjectMaskRecord {
  const bytes = new Uint8Array(mask.data.byteLength);
  bytes.set(mask.data);
  return {
    kind: SUBJECT_RECORD_MASK,
    id: maskId,
    sourceImageId: mask.sourceImageId,
    width: mask.width,
    height: mask.height,
    encoding: mask.encoding,
    threshold: mask.threshold,
    model: { ...mask.model },
    blob: new Blob([bytes], { type: MASK_BLOB_MIME }),
    byteLength: bytes.byteLength,
    createdAt: mask.createdAt,
  };
}

function subjectFromRecord(record: SubjectMetadataRecord): Subject {
  return {
    id: record.id,
    sourceImageId: record.sourceImageId,
    maskId: record.maskId,
    bbox: { ...record.bbox },
    confidence: record.confidence,
    label: record.label,
    createdAt: record.createdAt,
  };
}

/** 解析并校验元数据记录；类型不符或字段缺失返回 null。 */
function parseSubjectRecord(value: unknown): SubjectMetadataRecord | null {
  if (!isRecord(value) || value.kind !== SUBJECT_RECORD_SUBJECT) return null;
  if (!isSubject(value)) return null;
  return subjectRecordFrom(value);
}

/** 解析并校验蒙版记录；Blob 尺寸必须与声明的宽高一致。 */
function parseMaskRecord(value: unknown): SubjectMaskRecord | null {
  if (!isRecord(value) || value.kind !== SUBJECT_RECORD_MASK) return null;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.sourceImageId)) return null;
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) return null;
  if (!isPositiveInteger(value.byteLength) || value.byteLength !== value.width * value.height) {
    return null;
  }
  if (value.encoding !== "raw-alpha8") return null;
  if (typeof value.threshold !== "number" || value.threshold < 0 || value.threshold > 255) {
    return null;
  }
  if (!isSegmentationModelRef(value.model)) return null;
  if (!(value.blob instanceof Blob)) return null;
  if (value.blob.size !== value.byteLength) return null;
  if (!isNonEmptyString(value.createdAt)) return null;
  return {
    kind: SUBJECT_RECORD_MASK,
    id: value.id,
    sourceImageId: value.sourceImageId,
    width: value.width,
    height: value.height,
    encoding: value.encoding,
    threshold: value.threshold,
    model: { ...value.model },
    blob: value.blob,
    byteLength: value.byteLength,
    createdAt: value.createdAt,
  };
}

async function maskFromRecord(record: SubjectMaskRecord): Promise<SubjectMask> {
  const buffer = await record.blob.arrayBuffer();
  if (buffer.byteLength !== record.byteLength) {
    throw new StorageError(
      "E_CORRUPT_RECORD",
      `蒙版 ${record.id} 的 Blob 长度 ${buffer.byteLength} 与记录 ${record.byteLength} 不符。`,
    );
  }
  return {
    sourceImageId: record.sourceImageId,
    width: record.width,
    height: record.height,
    encoding: record.encoding,
    data: new Uint8ClampedArray(buffer),
    threshold: record.threshold,
    model: { ...record.model },
    createdAt: record.createdAt,
  };
}

function compositionRecordFrom(composition: Composition): CompositionRecord {
  return {
    id: composition.id,
    schemaVersion: composition.schemaVersion,
    subjectId: composition.subjectId,
    sourceImageId: composition.sourceImageId,
    params: { ...composition.params },
    createdAt: composition.createdAt,
    updatedAt: composition.updatedAt,
  };
}

function compositionFromRecord(record: CompositionRecord): Composition {
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    subjectId: record.subjectId,
    sourceImageId: record.sourceImageId,
    params: { ...record.params },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function parseCompositionRecord(value: unknown): CompositionRecord | null {
  if (!isRecord(value) || !isComposition(value)) return null;
  return compositionRecordFrom(value);
}

function assertSubjectPair(subject: Subject, mask: SubjectMask): void {
  if (!isSubject(subject)) {
    throw new StorageError("E_SUBJECT_INVALID", "主体元数据不合法（字段缺失或值域越界）。");
  }
  if (!isSubjectMask(mask)) {
    throw new StorageError("E_SUBJECT_INVALID", "蒙版不合法（宽高与 data 长度不符或值域越界）。");
  }
  if (mask.sourceImageId !== subject.sourceImageId) {
    throw new StorageError(
      "E_SUBJECT_INVALID",
      `蒙版来源图 ${mask.sourceImageId} 与主体来源图 ${subject.sourceImageId} 不一致。`,
    );
  }
}

export function createSubjectRepository(factory: IDBFactory = defaultFactory()): SubjectRepository {
  return {
    async saveSubject(subject, mask) {
      assertSubjectPair(subject, mask);
      const meta = subjectRecordFrom(subject);
      const maskRecord = maskRecordFrom(subject.maskId, mask);

      await runTransaction(factory, [STORE_SUBJECTS], "readwrite", async (tx) => {
        const store = tx.objectStore(STORE_SUBJECTS);
        const existingMask = await requestToPromise(store.get(subject.maskId));
        if (existingMask !== undefined) {
          const existing = parseMaskRecord(existingMask);
          if (!existing) {
            throw new StorageError(
              "E_ID_CONFLICT",
              `键 ${subject.maskId} 已被非蒙版记录占用，拒绝写入。`,
            );
          }
        }
        const existingSubject = await requestToPromise(store.get(subject.id));
        if (existingSubject !== undefined) {
          const existing = parseSubjectRecord(existingSubject);
          if (!existing) {
            throw new StorageError(
              "E_ID_CONFLICT",
              `键 ${subject.id} 已被非主体记录占用，拒绝写入。`,
            );
          }
        }
        store.put(maskRecord);
        store.put(meta);
      });
      return subject;
    },

    async loadSubject(id) {
      const db = await openDatabase(factory);
      try {
        const tx = db.transaction(STORE_SUBJECTS, "readonly");
        const store = tx.objectStore(STORE_SUBJECTS);
        const rawMeta = await requestToPromise(store.get(id));
        const meta = parseSubjectRecord(rawMeta);
        const rawMask = meta ? await requestToPromise(store.get(meta.maskId)) : undefined;
        await transactionDone(tx);

        if (rawMeta === undefined) {
          throw new StorageError("E_NOT_FOUND", `找不到主体 ${id}。`);
        }
        if (!meta) {
          throw new StorageError("E_CORRUPT_RECORD", `主体 ${id} 的元数据记录损坏。`);
        }
        const maskRecord = parseMaskRecord(rawMask);
        if (!maskRecord) {
          throw new StorageError("E_CORRUPT_RECORD", `主体 ${id} 的蒙版记录缺失或损坏。`);
        }
        const mask = await maskFromRecord(maskRecord);
        return { ...subjectFromRecord(meta), mask };
      } finally {
        db.close();
      }
    },

    async listSubjects(sourceImageId) {
      const db = await openDatabase(factory);
      try {
        const tx = db.transaction(STORE_SUBJECTS, "readonly");
        const store = tx.objectStore(STORE_SUBJECTS);
        const rows: unknown[] = sourceImageId
          ? await requestToPromise(store.index(SUBJECT_INDEX_SOURCE_IMAGE).getAll(sourceImageId))
          : await requestToPromise(store.getAll());
        await transactionDone(tx);

        return rows
          .map(parseSubjectRecord)
          .filter((record): record is SubjectMetadataRecord => record !== null)
          .map(subjectFromRecord)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      } finally {
        db.close();
      }
    },

    async removeSubject(id) {
      await runTransaction(factory, [STORE_SUBJECTS], "readwrite", async (tx) => {
        const store = tx.objectStore(STORE_SUBJECTS);
        const meta = parseSubjectRecord(await requestToPromise(store.get(id)));
        if (!meta) return;
        store.delete(meta.id);
        store.delete(meta.maskId);
      });
    },

    async loadMask(maskId) {
      const db = await openDatabase(factory);
      try {
        const tx = db.transaction(STORE_SUBJECTS, "readonly");
        const raw = await requestToPromise(tx.objectStore(STORE_SUBJECTS).get(maskId));
        await transactionDone(tx);
        const record = parseMaskRecord(raw);
        if (raw === undefined) {
          throw new StorageError("E_NOT_FOUND", `找不到蒙版 ${maskId}。`);
        }
        if (!record) {
          throw new StorageError("E_CORRUPT_RECORD", `蒙版 ${maskId} 的记录损坏。`);
        }
        return maskFromRecord(record);
      } finally {
        db.close();
      }
    },

    async saveComposition(composition) {
      const record = parseCompositionRecord(composition);
      if (!record) {
        throw new StorageError("E_COMPOSITION_INVALID", "构图配置不合法（参数缺失或值域越界）。");
      }
      await runTransaction(factory, [STORE_COMPOSITIONS], "readwrite", (tx) => {
        tx.objectStore(STORE_COMPOSITIONS).put(record);
      });
      return composition;
    },

    async loadComposition(id) {
      const db = await openDatabase(factory);
      try {
        const tx = db.transaction(STORE_COMPOSITIONS, "readonly");
        const raw = await requestToPromise(tx.objectStore(STORE_COMPOSITIONS).get(id));
        await transactionDone(tx);
        const record = parseCompositionRecord(raw);
        if (raw === undefined) {
          throw new StorageError("E_NOT_FOUND", `找不到构图 ${id}。`);
        }
        if (!record) {
          throw new StorageError("E_CORRUPT_RECORD", `构图 ${id} 的记录损坏。`);
        }
        return compositionFromRecord(record);
      } finally {
        db.close();
      }
    },

    async listCompositions(subjectId) {
      const db = await openDatabase(factory);
      try {
        const tx = db.transaction(STORE_COMPOSITIONS, "readonly");
        const store = tx.objectStore(STORE_COMPOSITIONS);
        const rows: unknown[] = subjectId
          ? await requestToPromise(store.index(COMPOSITION_INDEX_SUBJECT).getAll(subjectId))
          : await requestToPromise(store.getAll());
        await transactionDone(tx);
        return rows
          .map(parseCompositionRecord)
          .filter((record): record is CompositionRecord => record !== null)
          .map(compositionFromRecord)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      } finally {
        db.close();
      }
    },

    async removeComposition(id) {
      await runTransaction(factory, [STORE_COMPOSITIONS], "readwrite", (tx) => {
        tx.objectStore(STORE_COMPOSITIONS).delete(id);
      });
    },
  };
}

export const defaultSubjectRepository = {
  current: null as SubjectRepository | null,
  get(): SubjectRepository {
    if (!this.current) this.current = createSubjectRepository();
    return this.current;
  },
};
