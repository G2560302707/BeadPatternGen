import { indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import {
  DB_NAME,
  DB_VERSION,
  STORE_COMPOSITIONS,
  STORE_EDIT_DRAFTS,
  STORE_PATTERNS,
  STORE_PROJECTS,
  STORE_SUBJECTS,
  STORE_THUMBS,
  openDatabase,
  requestToPromise,
  type ProjectMeta,
} from "./db";

const LEGACY_META: ProjectMeta = {
  id: "legacy-project",
  title: "一期旧项目",
  updatedAt: "2026-10-23T00:00:00.000Z",
  createdAt: "2026-10-23T00:00:00.000Z",
  width: 2,
  height: 2,
  paletteId: "artkal-s",
  paletteVersion: "v1",
  mode: "photo",
  schemaVersion: "1.0",
};

function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** 手工构造一期（v1）数据库：三个旧仓 + 一条项目元数据。 */
function createV1Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
      db.createObjectStore(STORE_PATTERNS, { keyPath: "id" });
      db.createObjectStore(STORE_THUMBS, { keyPath: "id" });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction([STORE_PROJECTS], "readwrite");
      tx.objectStore(STORE_PROJECTS).put(LEGACY_META);
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
}

/** 以当前版本打开（不触发升级），用于断言升级前的仓结构。 */
function listStoreNamesWithoutUpgrade(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const names = Array.from(db.objectStoreNames).sort();
      db.close();
      resolve(names);
    };
  });
}

async function readLegacyMeta(): Promise<ProjectMeta | undefined> {
  const db = await openDatabase(indexedDB);
  try {
    const tx = db.transaction(STORE_PROJECTS, "readonly");
    const row = await requestToPromise(tx.objectStore(STORE_PROJECTS).get(LEGACY_META.id));
    return row as ProjectMeta | undefined;
  } finally {
    db.close();
  }
}

afterEach(async () => {
  await deleteDatabase();
});

describe("IndexedDB migration", () => {
  it("creates all six stores on a fresh database", async () => {
    const db = await openDatabase(indexedDB);
    expect(db.version).toBe(DB_VERSION);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(
      [
        STORE_COMPOSITIONS,
        STORE_EDIT_DRAFTS,
        STORE_PATTERNS,
        STORE_PROJECTS,
        STORE_SUBJECTS,
        STORE_THUMBS,
      ].sort(),
    );
    db.close();
  });

  it("upgrades a v1 database without losing project data", async () => {
    await createV1Database();
    expect(await listStoreNamesWithoutUpgrade()).toEqual(
      [STORE_PROJECTS, STORE_PATTERNS, STORE_THUMBS].sort(),
    );

    const upgraded = await openDatabase(indexedDB);
    expect(upgraded.version).toBe(DB_VERSION);
    expect(Array.from(upgraded.objectStoreNames).sort()).toEqual(
      [
        STORE_COMPOSITIONS,
        STORE_EDIT_DRAFTS,
        STORE_PATTERNS,
        STORE_PROJECTS,
        STORE_SUBJECTS,
        STORE_THUMBS,
      ].sort(),
    );
    expect(
      upgraded
        .transaction(STORE_SUBJECTS, "readonly")
        .objectStore(STORE_SUBJECTS)
        .indexNames.contains("by-source-image"),
    ).toBe(true);
    expect(
      upgraded
        .transaction(STORE_COMPOSITIONS, "readonly")
        .objectStore(STORE_COMPOSITIONS)
        .indexNames.contains("by-subject"),
    ).toBe(true);
    upgraded.close();

    expect(await readLegacyMeta()).toEqual(LEGACY_META);
  });

  it("keeps old and new data across repeated opens", async () => {
    await createV1Database();
    const first = await openDatabase(indexedDB);
    first.close();

    expect(await readLegacyMeta()).toEqual(LEGACY_META);

    const second = await openDatabase(indexedDB);
    expect(second.version).toBe(DB_VERSION);
    second.close();

    expect(await readLegacyMeta()).toEqual(LEGACY_META);
  });
});
