import { EMPTY_CELL, assertViewShape } from "./types";
import type { PatternView } from "./types";

/**
 * 找出所有孤立豆。
 *
 * 定义（S08 写死）：
 * - 只考虑非空格（cells[i] !== EMPTY_CELL）；
 * - 4-邻域：上 / 下 / 左 / 右，不含对角；
 * - 邻域内不存在同色（同一色号，即同一个调色板索引）的格子即为孤立豆；
 * - 越界视为「不同色」，因此贴边的单豆也会被判为孤立。
 *
 * 返回升序索引。时间复杂度 O(width * height)，额外空间 O(1)（不含输出数组）。
 */
export function findIsolated(p: PatternView): number[] {
  const n = assertViewShape(p);
  const { width, height, cells } = p;
  const isolated: number[] = [];

  for (let index = 0; index < n; index += 1) {
    const color = cells[index];
    if (color === undefined || color === EMPTY_CELL) {
      continue;
    }

    const col = index % width;
    const row = (index - col) / width;

    const sameUp = row > 0 && cells[index - width] === color;
    const sameDown = row + 1 < height && cells[index + width] === color;
    const sameLeft = col > 0 && cells[index - 1] === color;
    const sameRight = col + 1 < width && cells[index + 1] === color;

    if (!sameUp && !sameDown && !sameLeft && !sameRight) {
      isolated.push(index);
    }
  }

  return isolated;
}
