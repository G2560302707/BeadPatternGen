import { indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_COMPOSITION_PARAMS, SUBJECT_LABEL_MAIN } from "../core/subject";
import type { Composition, SegmentationModelRef, Subject, SubjectMask } from "../core/subject";
import { DB_NAME, DB_VERSION, STORE_SUBJECTS } from "./db";
import { StorageError } from "./errors";
import { createSubjectRepository } from "./subject-repository";

const MODEL: SegmentationModelRef = { id: "u2netp", version: "1.0-q8", license: "Apache-2.0" };
const T0 = "2026-10-24T00:00:00.000Z";
const T1 = "2026-10-24T00:01:00.000Z";

function makeMask(sourceImageId = "img-1", width = 4, height = 4, createdAt = T0): SubjectMask {
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = i % 3 === 0 ? 255 : 0;
  }
  return {
    sourceImageId,
    width,
    height,
    encoding: "raw-alpha8",
    data,
    threshold: 128,
    model: MODEL,
    createdAt,
  };
}

function makeSubject(id: string, maskId: string, sourceImageId = "img-1", createdAt = T0): Subject {
  return {
    id,
    sourceImageId,
    maskId,
    bbox: { x: 1, y: 2, width: 3, height: 4 },
    confidence: 0.87,
    label: SUBJECT_LABEL_MAIN,
    createdAt,
  };
}

function makeComposition(overrides: Partial<Composition> = {}): Composition {
  return {
    schemaVersion: "1.0",
    id: "comp-1",
    subjectId: "s1",
    sourceImageId: "img-1",
    params: { ...DEFAULT_COMPOSITION_PARAMS },
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** 直接读原始记录（仅测试用；生产代码不得绕过仓库）。 */
function readRawRecord(key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE_SUBJECTS, "readonly");
      const get = tx.objectStore(STORE_SUBJECTS).get(key);
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
      get.onerror = () => {
        db.close();
        reject(get.error);
      };
    };
  });
}

afterEach(async () => {
  await deleteDatabase();
});

describe("subject repository", () => {
  it("stores the mask as a Blob and round-trips pixels unchanged", async () => {
    const repo = createSubjectRepository(indexedDB);
    const mask = makeMask();
    const subject = makeSubject("s1", "mask-1");

    await repo.saveSubject(subject, mask);

    const raw = await readRawRecord("mask-1");
    expect(raw).toMatchObject({ kind: "mask", id: "mask-1", byteLength: 16 });
    expect((raw as { blob: unknown }).blob).toBeInstanceOf(Blob);

    const loaded = await repo.loadSubject("s1");
    expect(loaded).toMatchObject({
      id: "s1",
      sourceImageId: "img-1",
      maskId: "mask-1",
      confidence: 0.87,
      label: SUBJECT_LABEL_MAIN,
    });
    expect(loaded.bbox).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(loaded.mask.width).toBe(4);
    expect(loaded.mask.height).toBe(4);
    expect(Array.from(loaded.mask.data)).toEqual(Array.from(mask.data));

    const standalone = await repo.loadMask("mask-1");
    expect(Array.from(standalone.data)).toEqual(Array.from(mask.data));
    expect(standalone.model).toEqual(MODEL);
  });

  it("filters subjects by source image and never returns mask records", async () => {
    const repo = createSubjectRepository(indexedDB);
    await repo.saveSubject(makeSubject("s1", "mask-1", "img-1", T0), makeMask("img-1"));
    await repo.saveSubject(makeSubject("s2", "mask-2", "img-1", T1), makeMask("img-1", 2, 2));
    await repo.saveSubject(makeSubject("s3", "mask-3", "img-2", T1), makeMask("img-2"));

    const forImage = await repo.listSubjects("img-1");
    expect(forImage.map((row) => row.id)).toEqual(["s1", "s2"]);
    expect(forImage.every((row) => !("mask" in row))).toBe(true);

    const all = await repo.listSubjects();
    expect(all.map((row) => row.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("removes metadata and mask together", async () => {
    const repo = createSubjectRepository(indexedDB);
    await repo.saveSubject(makeSubject("s1", "mask-1"), makeMask());

    await repo.removeSubject("s1");

    await expect(repo.loadSubject("s1")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await expect(repo.loadMask("mask-1")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    expect(await repo.listSubjects()).toEqual([]);
  });

  it("is a no-op when removing an unknown subject", async () => {
    const repo = createSubjectRepository(indexedDB);
    await expect(repo.removeSubject("missing")).resolves.toBeUndefined();
  });

  it("rejects invalid pairs before touching IndexedDB", async () => {
    const repo = createSubjectRepository(indexedDB);
    const subject = makeSubject("s1", "mask-1");

    await expect(repo.saveSubject(subject, { ...makeMask(), width: 5 })).rejects.toBeInstanceOf(
      StorageError,
    );

    await expect(repo.saveSubject(subject, makeMask("img-2"))).rejects.toBeInstanceOf(StorageError);
  });

  it("rejects id collisions between a subject and a mask key", async () => {
    const repo = createSubjectRepository(indexedDB);
    await repo.saveSubject(makeSubject("s1", "mask-1"), makeMask());

    await expect(
      repo.saveSubject(makeSubject("mask-1", "mask-2"), makeMask()),
    ).rejects.toMatchObject({ code: "E_ID_CONFLICT" });
  });

  it("reports corrupt mask blobs instead of returning truncated data", async () => {
    const repo = createSubjectRepository(indexedDB);
    await repo.saveSubject(makeSubject("s1", "mask-1"), makeMask());

    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(STORE_SUBJECTS, "readwrite");
        const store = tx.objectStore(STORE_SUBJECTS);
        const get = store.get("mask-1");
        get.onsuccess = () => {
          store.put({ ...(get.result as object), blob: new Blob([new Uint8Array(1)]) });
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });

    await expect(repo.loadSubject("s1")).rejects.toMatchObject({ code: "E_CORRUPT_RECORD" });
  });
});

describe("composition repository", () => {
  it("round-trips parameters and separates them by subject", async () => {
    const repo = createSubjectRepository(indexedDB);
    const first = makeComposition({ id: "comp-1", updatedAt: T1 });
    const second = makeComposition({
      id: "comp-2",
      subjectId: "s2",
      params: {
        ...DEFAULT_COMPOSITION_PARAMS,
        canvasWidth: 1080,
        canvasHeight: 1920,
        subjectScale: 0.6,
        backgroundType: "solid",
        backgroundValue: "#FFFFFF",
      },
    });
    await repo.saveComposition(first);
    await repo.saveComposition(second);

    const loaded = await repo.loadComposition("comp-1");
    expect(loaded.params).toEqual(DEFAULT_COMPOSITION_PARAMS);
    expect(loaded.subjectId).toBe("s1");

    expect((await repo.listCompositions("s2")).map((c) => c.id)).toEqual(["comp-2"]);
    expect((await repo.listCompositions()).map((c) => c.id)).toEqual(["comp-1", "comp-2"]);

    await repo.removeComposition("comp-1");
    await expect(repo.loadComposition("comp-1")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    expect((await repo.listCompositions()).map((c) => c.id)).toEqual(["comp-2"]);
  });

  it("rejects parameters that break the background pairing rules", async () => {
    const repo = createSubjectRepository(indexedDB);
    const invalid = makeComposition({
      params: { ...DEFAULT_COMPOSITION_PARAMS, backgroundType: "solid", backgroundValue: null },
    });

    await expect(repo.saveComposition(invalid)).rejects.toMatchObject({
      code: "E_COMPOSITION_INVALID",
    });
    await expect(repo.loadComposition("comp-1")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });
});
