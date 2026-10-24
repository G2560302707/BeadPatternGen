import { describe, expect, it } from "vitest";
import { EMPTY_CELL } from "./limits";
import { cellAtScreen, paintValue, writeCell } from "./edit";

describe("pattern cell edit", () => {
  it("maps screen coordinates through the view transform", () => {
    expect(cellAtScreen(20, 20, 0, 0, 10, 8, 8)).toEqual({ x: 2, y: 2, index: 18 });
    expect(cellAtScreen(0, 0, 0, 0, 10, 8, 8)).toEqual({ x: 0, y: 0, index: 0 });
    expect(cellAtScreen(-1, 0, 0, 0, 10, 8, 8)).toBeNull();
  });

  it("paint writes a palette index and erase writes EMPTY_CELL", () => {
    const cells = new Int16Array([0, 1, EMPTY_CELL]);
    expect(writeCell(cells, 2, 1)).toBe(true);
    expect(cells[2]).toBe(1);
    expect(writeCell(cells, 2, 1)).toBe(false);
    expect(paintValue("erase", 3)).toBe(EMPTY_CELL);
    expect(paintValue("paint", 4)).toBe(4);
    expect(paintValue("pan", 0)).toBeNull();
  });
});
