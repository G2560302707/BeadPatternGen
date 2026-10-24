import { describe, expect, it } from "vitest";
import {
  applyChanges,
  applyCommandToPattern,
  estimateHistoryBytes,
  invertChanges,
  mergePaintCommands,
  upsertChange,
  type CellChange,
  type EditCommand,
} from "./commands";
import { EMPTY_CELL } from "./limits";
import { applyChangesToStats } from "./stats-delta";
import { computeStats } from "./stats";
import type { BeadPattern } from "./types";

function tinyPattern(cells: number[]): BeadPattern {
  return {
    schemaVersion: "1.0",
    id: "p",
    title: "t",
    width: 2,
    height: 2,
    cells: Int16Array.from(cells),
    palette: [
      { code: "A", name: "A", hex: "#FF0000", manufacturer: "x" },
      { code: "B", name: "B", hex: "#00FF00", manufacturer: "x" },
    ],
    mode: "logo",
    paletteId: "p",
    paletteVersion: "1",
    settings: {
      maxColors: 2,
      dithering: "none",
      colorMetric: "ciede2000",
      transparentPolicy: "empty",
    },
    source: { originalWidth: 2, originalHeight: 2, aspectRatio: 1 },
    createdAt: "t",
    updatedAt: "t",
  };
}

describe("edit commands", () => {
  it("undo N times restores the original matrix", () => {
    const start = Int16Array.from([0, 1, 0, EMPTY_CELL]);
    const commands: EditCommand[] = [
      { kind: "paint", changes: [{ index: 3, from: EMPTY_CELL, to: 1 }] },
      { kind: "erase", changes: [{ index: 0, from: 0, to: EMPTY_CELL }] },
      { kind: "fill", changes: [{ index: 1, from: 1, to: 0 }] },
    ];
    let cells: Int16Array = new Int16Array(start);
    for (const command of commands) cells = applyChanges(cells, command.changes);
    expect(Array.from(cells)).toEqual([EMPTY_CELL, 0, 0, 1]);
    for (let i = commands.length - 1; i >= 0; i -= 1) {
      const command = commands[i];
      if (!command) continue;
      cells = applyChanges(cells, invertChanges(command.changes));
    }
    expect(Array.from(cells)).toEqual(Array.from(start));
  });

  it("merges consecutive paint strokes on the same cell", () => {
    const a: EditCommand = { kind: "paint", changes: [{ index: 0, from: 0, to: 1 }] };
    const b: EditCommand = { kind: "paint", changes: [{ index: 0, from: 1, to: 1 }] };
    const merged = mergePaintCommands(a, b);
    expect(merged?.changes).toEqual([{ index: 0, from: 0, to: 1 }]);
  });

  it("keeps sparse history under the byte budget for 200×200", () => {
    const stack: EditCommand[] = [];
    for (let i = 0; i < 80; i += 1) {
      const changes: CellChange[] = [];
      for (let c = 0; c < 40; c += 1) {
        changes.push({ index: i * 40 + c, from: 0, to: 1 });
      }
      stack.push({ kind: "paint", changes });
    }
    expect(estimateHistoryBytes(stack)).toBeLessThan(8 * 1024 * 1024);
  });

  it("updates stats without a full cell scan matching computeStats", () => {
    const pattern = tinyPattern([0, 0, 1, EMPTY_CELL]);
    const stats = computeStats(pattern);
    const next = applyCommandToPattern(
      pattern,
      { kind: "paint", changes: [{ index: 3, from: EMPTY_CELL, to: 1 }] },
      "now",
    );
    const incremental = applyChangesToStats(stats, pattern.palette.length, [
      { index: 3, from: EMPTY_CELL, to: 1 },
    ]);
    expect(incremental).toEqual(computeStats(next));
  });

  it("upsert collapses a cell that returns to its origin", () => {
    const pending = new Map<number, CellChange>();
    upsertChange(pending, 2, 0, 1);
    upsertChange(pending, 2, 0, 0);
    expect(pending.size).toBe(0);
  });
});
