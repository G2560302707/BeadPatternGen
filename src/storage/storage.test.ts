import { indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { createDraftPattern } from "../core/pattern";
import type { BeadColor, BeadPattern } from "../core/pattern";
import { DB_NAME, STORE_PATTERNS } from "./db";
import { StorageError } from "./errors";
import {
  MAX_IMPORT_STRING,
  createProjectRepository,
  importPatternJson,
  quotaSnapshot,
} from "./project-repository";
import { exportProjectJson } from "../export/json";

const PALETTE: BeadColor[] = [
  { code: "S01", name: "White", hex: "#EAEEF3", manufacturer: "Artkal" },
  { code: "S05", name: "Tall Poppy", hex: "#CB3531", manufacturer: "Artkal" },
];

function fixture(): BeadPattern {
  const pattern = createDraftPattern({
    id: "p1",
    title: "stored",
    width: 2,
    height: 2,
    palette: PALETTE,
    mode: "photo",
    paletteId: "artkal-s-midi-5mm",
    paletteVersion: "test",
    settings: {
      maxColors: 2,
      dithering: "none",
      colorMetric: "ciede2000",
      transparentPolicy: "empty",
    },
    source: { originalWidth: 2, originalHeight: 2, aspectRatio: 1 },
    now: "2026-10-24T00:00:00.000Z",
  });
  pattern.cells.set([0, 1, 1, 0]);
  return pattern;
}

afterEach(() => {
  indexedDB.deleteDatabase(DB_NAME);
});

describe("project repository", () => {
  it("saves Int16Array cells and loads them unchanged", async () => {
    const repo = createProjectRepository(indexedDB);
    const pattern = fixture();
    await repo.save(pattern);
    expect(await repo.exists("p1")).toBe(true);
    const loaded = await repo.load("p1");
    expect(Array.from(loaded.pattern.cells)).toEqual([0, 1, 1, 0]);
    expect(loaded.pattern.paletteVersion).toBe("test");
    expect(loaded.pattern.settings.maxColors).toBe(2);
    const listed = await repo.list();
    expect(listed[0]?.id).toBe("p1");
    await repo.remove("p1");
    expect(await repo.exists("p1")).toBe(false);
  });

  it("rejects a corrupt pattern record", async () => {
    const repo = createProjectRepository(indexedDB);
    await repo.save(fixture());
    const dbOpen = indexedDB.open(DB_NAME);
    await new Promise<void>((resolve, reject) => {
      dbOpen.onsuccess = () => {
        const db = dbOpen.result;
        const tx = db.transaction(STORE_PATTERNS, "readwrite");
        tx.objectStore(STORE_PATTERNS).put({
          id: "p1",
          version: 1,
          cells: new Int16Array([0, 1]).buffer,
          palette: PALETTE,
          settings: {},
          source: {},
          mode: "photo",
          paletteId: "x",
          paletteVersion: "y",
          title: "bad",
          createdAt: "t",
          updatedAt: "t",
          schemaVersion: "1.0",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      dbOpen.onerror = () => reject(dbOpen.error);
    });
    await expect(repo.load("p1")).rejects.toBeInstanceOf(StorageError);
  });

  it("rejects missing fields on JSON import without using the workspace", () => {
    expect(() => importPatternJson("{}")).toThrow();
  });

  it("rejects overlong strings", () => {
    const json = exportProjectJson(fixture()).replace(
      '"stored"',
      `"${"x".repeat(MAX_IMPORT_STRING + 1)}"`,
    );
    expect(() => importPatternJson(json)).toThrow(/超过/);
  });

  it("rejects oversized cell arrays", () => {
    expect(() =>
      importPatternJson(
        JSON.stringify({
          schemaVersion: "1.0",
          width: 300,
          height: 300,
          cells: [],
        }),
      ),
    ).toThrow(/超过上限/);
  });

  it("rejects palette indexes outside the card", () => {
    const json = exportProjectJson(fixture());
    const parsed = JSON.parse(json) as { cells: number[] };
    parsed.cells = [0, 99, 1, 0];
    expect(() => importPatternJson(JSON.stringify(parsed))).toThrow();
  });
});

describe("quota snapshot", () => {
  it("warns when usage reaches 80% of quota", () => {
    expect(quotaSnapshot(90, 100).warn).toBe(true);
    expect(quotaSnapshot(10, 100).warn).toBe(false);
  });
});
