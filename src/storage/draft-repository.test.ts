import { indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_CELL } from "../core/pattern";
import type { BeadPattern } from "../core/pattern";
import { DB_NAME } from "./db";
import { createDraftRepository } from "./draft-repository";

function pattern(): BeadPattern {
  return {
    schemaVersion: "1.0",
    id: "draft-p",
    title: "draft",
    width: 2,
    height: 1,
    cells: Int16Array.from([0, EMPTY_CELL]),
    palette: [{ code: "A", name: "A", hex: "#111111", manufacturer: "x" }],
    mode: "logo",
    paletteId: "p",
    paletteVersion: "1",
    settings: {
      maxColors: 1,
      dithering: "none",
      colorMetric: "ciede2000",
      transparentPolicy: "empty",
    },
    source: { originalWidth: 2, originalHeight: 1, aspectRatio: 2 },
    createdAt: "t0",
    updatedAt: "t1",
  };
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("edit draft repository", () => {
  it("round-trips a crash-recovery draft", async () => {
    const repo = createDraftRepository(indexedDB);
    const locked = new Uint8Array([1, 0]);
    await repo.save(pattern(), locked);
    const loaded = await repo.load();
    expect(loaded?.pattern.cells).toEqual(Int16Array.from([0, EMPTY_CELL]));
    expect(loaded?.locked).toEqual(locked);
    await repo.clear();
    expect(await repo.load()).toBeNull();
  });

  it("round-trips the layer sidecar (R1)", async () => {
    const repo = createDraftRepository(indexedDB);
    const locked = new Uint8Array([0, 0]);
    const base = Int16Array.from([0, EMPTY_CELL]);
    const overlay = Int16Array.from([EMPTY_CELL, 0]);
    await repo.save(pattern(), locked, { base, overlay, visible: false });
    const loaded = await repo.load();
    expect(loaded?.layers?.base).toEqual(base);
    expect(loaded?.layers?.overlay).toEqual(overlay);
    expect(loaded?.layers?.visible).toBe(false);
    await repo.clear();
  });

  it("loads legacy drafts without layers", async () => {
    const repo = createDraftRepository(indexedDB);
    await repo.save(pattern(), new Uint8Array([1, 0]));
    const loaded = await repo.load();
    expect(loaded?.layers).toBeUndefined();
    await repo.clear();
  });
});
