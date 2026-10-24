import { describe, expect, it } from "vitest";
import { EMPTY_CELL } from "./limits";
import {
  applyChangesToOverlay,
  compositeCells,
  deriveOverlay,
  hasOverlayContent,
} from "./layers";

describe("refine layer compositing (R1)", () => {
  const base = Int16Array.from([1, 2, EMPTY_CELL, 3]);

  it("composites overlay over base with EMPTY transparent to base", () => {
    const overlay = Int16Array.from([EMPTY_CELL, 4, 5, EMPTY_CELL]);
    const merged = compositeCells(base, overlay);
    // 合成顺序：overlay 非空处用 overlay，其余透出基底。
    expect(Array.from(merged)).toEqual([1, 4, 5, 3]);
  });

  it("keeps base visible where the overlay is empty", () => {
    const overlay = new Int16Array(base.length).fill(EMPTY_CELL);
    expect(Array.from(compositeCells(base, overlay))).toEqual(Array.from(base));
  });

  it("derives the overlay from composite and base", () => {
    const overlay = Int16Array.from([EMPTY_CELL, 4, 5, EMPTY_CELL]);
    const merged = compositeCells(base, overlay);
    expect(Array.from(deriveOverlay(merged, base))).toEqual(Array.from(overlay));
  });

  it("treats edits equal to the base color as transparent", () => {
    const overlay = new Int16Array(base.length).fill(EMPTY_CELL);
    const next = applyChangesToOverlay(overlay, base, [{ index: 3, from: 3, to: 3 }]);
    expect(Array.from(next)).toEqual(Array.from(overlay));
    const painted = applyChangesToOverlay(overlay, base, [{ index: 0, from: 1, to: 9 }]);
    expect(painted[0]).toBe(9);
  });

  it("applies inverted changes on undo back to a transparent overlay", () => {
    const overlay = new Int16Array(base.length).fill(EMPTY_CELL);
    const painted = applyChangesToOverlay(overlay, base, [{ index: 0, from: 1, to: 9 }]);
    const undone = applyChangesToOverlay(painted, base, [{ index: 0, from: 9, to: 1 }]);
    expect(undone[0]).toBe(EMPTY_CELL);
  });

  it("reports overlay content relative to the base", () => {
    const merged = Int16Array.from([1, 2, EMPTY_CELL, 9]);
    expect(hasOverlayContent(merged, base)).toBe(true);
    expect(hasOverlayContent(base, base)).toBe(false);
  });

  it("round-trips composite → derive → composite", () => {
    const overlay = Int16Array.from([7, EMPTY_CELL, EMPTY_CELL, 8]);
    const merged = compositeCells(base, overlay);
    const restored = compositeCells(base, deriveOverlay(merged, base));
    expect(Array.from(restored)).toEqual(Array.from(merged));
  });
});
