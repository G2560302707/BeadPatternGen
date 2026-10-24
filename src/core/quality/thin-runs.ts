import { EMPTY_CELL, assertViewShape } from "./types";
import type { PatternView, ThinRunInfo } from "./types";

/**
 * 找出「细线风险」：同一行 / 列上连续同色游程长度 < minRun 的段。
 *
 * 口径（S08 写死）：
 * - 「同类」= 同一个色号，即 cells 中的同一个调色板索引值；
 * - 空格（-1）不是色号，会切断游程，也不会自己形成游程；
 * - 输出位置取游程起点（水平段取最左格，垂直段取最上格）；
 * - 同一格可能同时属于一条水平段和一条垂直段，允许输出两条；
 * - 排序：row 升序 → col 升序 → orientation（"h" 在 "v" 前）。
 *   第三个键保证同一 (row, col) 上的横竖两条也有全序，不依赖 Array.sort 的稳定性。
 *
 * 时间复杂度 O(width * height)，额外空间 O(输出条数)。
 */
export function findThinRuns(p: PatternView, minRun: number): ThinRunInfo[] {
  assertViewShape(p);
  const { width, height, cells } = p;
  const runs: ThinRunInfo[] = [];

  // 水平游程：逐行扫描。
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * width;
    let col = 0;
    while (col < width) {
      const color = cells[rowOffset + col];
      if (color === undefined || color === EMPTY_CELL) {
        col += 1;
        continue;
      }

      let end = col + 1;
      while (end < width) {
        const next = cells[rowOffset + end];
        if (next === undefined || next === EMPTY_CELL || next !== color) {
          break;
        }
        end += 1;
      }

      const length = end - col;
      if (length < minRun) {
        runs.push({ row, col, length, orientation: "h" });
      }
      col = end;
    }
  }

  // 垂直游程：逐列扫描。
  for (let col = 0; col < width; col += 1) {
    let row = 0;
    while (row < height) {
      const color = cells[row * width + col];
      if (color === undefined || color === EMPTY_CELL) {
        row += 1;
        continue;
      }

      let end = row + 1;
      while (end < height) {
        const next = cells[end * width + col];
        if (next === undefined || next === EMPTY_CELL || next !== color) {
          break;
        }
        end += 1;
      }

      const length = end - row;
      if (length < minRun) {
        runs.push({ row, col, length, orientation: "v" });
      }
      row = end;
    }
  }

  runs.sort((a, b) => {
    if (a.row !== b.row) {
      return a.row - b.row;
    }
    if (a.col !== b.col) {
      return a.col - b.col;
    }
    if (a.orientation === b.orientation) {
      return 0;
    }
    return a.orientation === "h" ? -1 : 1;
  });

  return runs;
}
