import { describe, expect, it } from "vitest";
import { expandBrushCells } from "./brush";

describe("expandBrushCells（方形笔刷展开）", () => {
  it("1×1 只含中心格", () => {
    expect(expandBrushCells(12, 1, 5, 5)).toEqual([12]);
  });

  it("3×3 以中心格展开九宫格", () => {
    // 5×5 画布，中心 (2,2) → index 12。
    expect(expandBrushCells(12, 3, 5, 5)).toEqual([6, 7, 8, 11, 12, 13, 16, 17, 18]);
  });

  it("2×2 以按下格为左上角", () => {
    // 5×5 画布，按下 (2,2) → 覆盖 (2,2)(3,2)(2,3)(3,3)。
    expect(expandBrushCells(12, 2, 5, 5)).toEqual([12, 13, 17, 18]);
  });

  it("画布边缘自动截断，不越界", () => {
    // 4×4 画布，左上角 (0,0) 用 3×3 → 只有右下 4 格。
    expect(expandBrushCells(0, 3, 4, 4)).toEqual([0, 1, 4, 5]);
    // 右下角 (3,3) 用 3×3 → 只有左上 4 格。
    expect(expandBrushCells(15, 3, 4, 4)).toEqual([10, 11, 14, 15]);
  });

  it("非法输入抛错", () => {
    expect(() => expandBrushCells(0, 0, 4, 4)).toThrow(RangeError);
    expect(() => expandBrushCells(0, 2.5, 4, 4)).toThrow(RangeError);
    expect(() => expandBrushCells(99, 1, 4, 4)).toThrow(RangeError);
  });
});
