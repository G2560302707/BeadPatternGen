import { describe, expect, it } from "vitest";
import { EMPTY_CELL } from "./limits";
import {
  appendLassoPoint,
  copySelection,
  fillSelection,
  lassoIndices,
  LASSO_POINT_SPACING,
  mirrorSelection,
  pastePatch,
  rectIndices,
  replaceColorInSelection,
  rotateSelection,
  rotateSelectionCW,
  translateSelection,
} from "./selection";
import { applyChanges } from "./commands";

describe("region selection", () => {
  it("fills a rectangle", () => {
    const cells = new Int16Array([0, 0, 0, 0]);
    const indices = rectIndices(0, 0, 1, 0, 2, 2);
    const next = applyChanges(cells, fillSelection(cells, indices, 1));
    expect(Array.from(next)).toEqual([1, 1, 0, 0]);
  });

  it("replaces one color inside the selection", () => {
    const cells = new Int16Array([0, 1, 0, 1]);
    const changes = replaceColorInSelection(cells, [0, 1, 2, 3], 1, 0);
    expect(applyChanges(cells, changes)).toEqual(Int16Array.from([0, 0, 0, 0]));
  });

  it("mirrors a square selection horizontally", () => {
    const cells = new Int16Array([0, 1, 2, 3]);
    const changes = mirrorSelection(cells, [0, 1, 2, 3], 2, "h");
    expect(Array.from(applyChanges(cells, changes))).toEqual([1, 0, 3, 2]);
  });

  it("rotates a 2×2 selection clockwise", () => {
    const cells = new Int16Array([0, 1, 2, 3]);
    const changes = rotateSelectionCW(cells, [0, 1, 2, 3], 2);
    expect(Array.from(applyChanges(cells, changes))).toEqual([2, 0, 3, 1]);
  });

  it("copies and pastes skipping empty cells", () => {
    const cells = new Int16Array([1, EMPTY_CELL, EMPTY_CELL, EMPTY_CELL]);
    const patch = copySelection(cells, [0, 1], 2);
    expect(patch).not.toBeNull();
    const pasted = pastePatch(cells, 2, 2, patch!, 0, 1);
    expect(Array.from(applyChanges(cells, pasted))).toEqual([1, EMPTY_CELL, 1, EMPTY_CELL]);
  });

  it("rasterizes a triangle lasso", () => {
    const indices = lassoIndices(
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 0, y: 3 },
      ],
      4,
      4,
    );
    expect(indices.length).toBeGreaterThan(2);
    expect(indices).toContain(0);
  });
});

describe("appendLassoPoint（套索插值记点）", () => {
  it("第一个点直接记入", () => {
    const points: Array<{ x: number; y: number }> = [];
    expect(appendLassoPoint(points, 2.5, 3.5)).toBe(true);
    expect(points).toEqual([{ x: 2.5, y: 3.5 }]);
  });

  it("微小抖动（< 0.05 格）不记点", () => {
    const points = [{ x: 2, y: 2 }];
    expect(appendLassoPoint(points, 2.03, 2.02)).toBe(false);
    expect(points).toHaveLength(1);
  });

  it("近距离点（< 0.5 格）直接追加，不插值", () => {
    const points = [{ x: 2, y: 2 }];
    expect(appendLassoPoint(points, 2.3, 2.1)).toBe(true);
    expect(points).toHaveLength(2);
  });

  it("快速划动（一次跳 10 格）按 ≤0.5 格步长插值补点", () => {
    const points = [{ x: 0, y: 0 }];
    appendLassoPoint(points, 10, 0);
    expect(points.length).toBeGreaterThanOrEqual(20);
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]!;
      const b = points[i]!;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(LASSO_POINT_SPACING + 1e-9);
    }
    expect(points[points.length - 1]).toEqual({ x: 10, y: 0 });
  });

  it("插值后的密集折线让「来回划动」的选区贴近真实路径覆盖", () => {
    // 只记起止点时多边形会自交、选区缺块；密集折线覆盖完整矩形。
    const points: Array<{ x: number; y: number }> = [];
    appendLassoPoint(points, 1, 1);
    appendLassoPoint(points, 8, 1);
    appendLassoPoint(points, 8, 3);
    appendLassoPoint(points, 1, 3);
    appendLassoPoint(points, 1, 1);
    const indices = lassoIndices(points, 10, 5);
    expect(indices.length).toBeGreaterThanOrEqual(14);
  });
});

describe("selection rotate / translate (R2)", () => {
  it("rotates a non-square 2×3 selection 90° and swaps width/height", () => {
    // 5 列画布，选区是 (0,0)-(1,2) 的 2×3 块。
    const cells = new Int16Array(25).fill(EMPTY_CELL);
    cells[0] = 1; // (0,0)
    cells[1] = 2; // (1,0)
    cells[5] = 3; // (0,1)
    cells[6] = 4; // (1,1)
    cells[10] = 5; // (0,2)
    cells[11] = 6; // (1,2)
    const indices = [0, 1, 5, 6, 10, 11];
    const result = rotateSelection(cells, indices, 5, 5, 1);
    expect(result.clipped).toBe(0);
    // 新包围盒 3×2：(0,0)-(2,1)。
    expect(result.selection).toEqual([0, 1, 2, 5, 6, 7]);
    const next = applyChanges(cells, result.changes);
    // 转 90° 后首行是原首列自下而上：5, 3, 1。
    expect(Array.from(next.slice(0, 3))).toEqual([5, 3, 1]);
    expect(Array.from(next.slice(5, 8))).toEqual([6, 4, 2]);
    // 超出新包围盒的两个源格清空。
    expect(next[10]).toBe(EMPTY_CELL);
    expect(next[11]).toBe(EMPTY_CELL);
  });

  it("matches rotateSelectionCW on a full square selection", () => {
    const cells = Int16Array.from([0, 1, 2, 3]);
    const indices = [0, 1, 2, 3];
    const next = rotateSelection(cells, indices, 2, 2, 1);
    expect(applyChanges(cells, next.changes)).toEqual(
      applyChanges(cells, rotateSelectionCW(cells, indices, 2)),
    );
    expect(next.clipped).toBe(0);
  });

  it("rotates 180° and 270° on a 3×2 block in a 5×3 canvas", () => {
    const cells = new Int16Array(15).fill(EMPTY_CELL);
    cells[0] = 1;
    cells[1] = 2;
    cells[2] = 3;
    cells[5] = 4;
    cells[6] = 5;
    cells[7] = 6;
    const indices = [0, 1, 2, 5, 6, 7];
    const half = applyChanges(cells, rotateSelection(cells, indices, 5, 3, 2).changes);
    expect(Array.from(half.slice(0, 3))).toEqual([6, 5, 4]);
    expect(Array.from(half.slice(5, 8))).toEqual([3, 2, 1]);
    // 270°（= 90° 逆时针）：新块三行是 [3,6] / [2,5] / [1,4]，源格 2、7 清空。
    const back = applyChanges(cells, rotateSelection(cells, indices, 5, 3, 3).changes);
    expect(Array.from(back.slice(0, 3))).toEqual([3, 6, EMPTY_CELL]);
    expect(Array.from(back.slice(5, 8))).toEqual([2, 5, EMPTY_CELL]);
    expect(back[10]).toBe(1);
    expect(back[11]).toBe(4);
  });

  it("ignores zero turns and normalizes out-of-range turns", () => {
    const cells = Int16Array.from([1, 2, 3, 4]);
    expect(rotateSelection(cells, [0, 1, 2, 3], 2, 2, 0).changes).toEqual([]);
    const once = rotateSelection(cells, [0, 1, 2, 3], 2, 2, 5);
    const thrice = rotateSelection(cells, [0, 1, 2, 3], 2, 2, 1);
    expect(applyChanges(cells, once.changes)).toEqual(applyChanges(cells, thrice.changes));
  });

  it("drops pixels leaving the canvas and reports clipped", () => {
    // 2 列画布，2×3 块贴左边缘：转 90° 需要宽 3，最右一列越界。
    const cells = Int16Array.from([1, 2, 3, 4, 5, 6]);
    const indices = [0, 1, 2, 3, 4, 5];
    const result = rotateSelection(cells, indices, 2, 3, 1);
    expect(result.clipped).toBe(2);
    const next = applyChanges(cells, result.changes);
    // 裁剪后留在画布内的 2×2：[5,3 / 6,4]，越界的两个源格清空。
    expect(Array.from(next)).toEqual([5, 3, 6, 4, EMPTY_CELL, EMPTY_CELL]);
  });

  it("restores the matrix after translate and reverse translate on a floating selection", () => {
    const width = 5;
    const height = 4;
    const original = new Int16Array(width * height).fill(EMPTY_CELL);
    original[6] = 1; // (1,1)
    original[7] = 2; // (2,1)
    original[11] = 3; // (1,2)
    original[12] = 4; // (2,2)
    const indices = [6, 7, 11, 12];
    const first = translateSelection(original, indices, width, height, 2, 1);
    expect(first.clipped).toBe(0);
    expect(first.selection).toEqual([13, 14, 18, 19]);
    const moved = applyChanges(original, first.changes);
    expect(moved[6]).toBe(EMPTY_CELL);
    expect(moved[13]).toBe(1);
    expect(moved[19]).toBe(4);
    const second = translateSelection(moved, first.selection, width, height, -2, -1);
    expect(second.clipped).toBe(0);
    expect(applyChanges(moved, second.changes)).toEqual(original);
  });

  it("overwrites the destination cell and empties the uncovered source", () => {
    const cells = Int16Array.from([9, 8, EMPTY_CELL, EMPTY_CELL]);
    const result = translateSelection(cells, [0], 2, 2, 1, 0);
    const next = applyChanges(cells, result.changes);
    // 目标格 (1,0) 被覆盖成 9；源格 (0,0) 清空；未选中的 (0,1) 不受影响。
    expect(Array.from(next)).toEqual([EMPTY_CELL, 9, EMPTY_CELL, EMPTY_CELL]);
    expect(result.selection).toEqual([1]);
  });

  it("keeps a source cell occupied when another selected pixel moves into it", () => {
    const cells = Int16Array.from([1, 2, EMPTY_CELL]);
    const result = translateSelection(cells, [0, 1], 3, 1, 1, 0);
    expect(result.clipped).toBe(0);
    // (1,0) 被 (0,0) 移入，不清空；原值 2 平移到 (2,0)。
    expect(applyChanges(cells, result.changes)).toEqual(Int16Array.from([EMPTY_CELL, 1, 2]));
    expect(result.selection).toEqual([1, 2]);
  });

  it("drops an out-of-canvas pixel without clearing a cell that receives another pixel", () => {
    const cells = Int16Array.from([1, 2]);
    const result = translateSelection(cells, [0, 1], 2, 1, 1, 0);
    expect(result.clipped).toBe(1);
    // (1,0) 越界丢弃，但该格被 (0,0) 移入，不清空；(1,0) 原值 2 丢失。
    expect(applyChanges(cells, result.changes)).toEqual(Int16Array.from([EMPTY_CELL, 1]));
  });

  it("translates by zero without changes", () => {
    const cells = Int16Array.from([1, EMPTY_CELL]);
    const result = translateSelection(cells, [0, 1], 2, 1, 0, 0);
    expect(result.changes).toEqual([]);
    expect(result.selection).toEqual([0, 1]);
  });
});
