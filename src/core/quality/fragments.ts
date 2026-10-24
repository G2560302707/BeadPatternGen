import { EMPTY_CELL, assertViewShape } from "./types";
import type { FragmentInfo, PatternView } from "./types";

/**
 * 找出所有 size ≤ maxSize 的同色 4-连通分量（小碎片）。
 *
 * 实现说明（S08 特别提醒）：
 * - 使用**显式栈**而不是递归 DFS。256×256 的满色图连通分量深度可达 65,536，
 *   远超 JS 引擎通常的调用栈深度，递归会抛 RangeError: Maximum call stack size exceeded。
 * - 显式栈用 Int32Array(n) 预分配，每个格子入栈前即标记 visited，因此最多入栈 n 次，
 *   栈不会溢出，也不会有重复入栈。
 * - 每个格子只被访问一次，时间复杂度 O(width * height)。
 *
 * 口径：
 * - 空格（-1）不参与任何连通分量；
 * - size 为 1 的分量同时也是孤立豆，两处允许重复计数（诊断是只读的，不做去重合并）；
 * - cells 内部按索引升序返回；外层按 size 升序、同 size 按最小索引升序。
 */
export function findFragments(p: PatternView, maxSize: number): FragmentInfo[] {
  const n = assertViewShape(p);

  // 非整数阈值向下取整；小于 1 的阈值不可能包含任何分量。
  const limit = Number.isFinite(maxSize) ? Math.floor(maxSize) : 0;
  if (limit < 1) {
    return [];
  }

  const { width, height, cells } = p;
  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);
  const found: Array<{ info: FragmentInfo; minIndex: number }> = [];

  for (let start = 0; start < n; start += 1) {
    if (visited[start] === 1) {
      continue;
    }
    const startColor = cells[start];
    if (startColor === undefined || startColor === EMPTY_CELL) {
      continue;
    }

    let top = 0;
    stack[top] = start;
    top += 1;
    visited[start] = 1;

    let size = 0;
    let minIndex = start;
    const component: number[] = [];

    while (top > 0) {
      top -= 1;
      const index = stack[top];
      if (index === undefined) {
        continue;
      }

      size += 1;
      if (index < minIndex) {
        minIndex = index;
      }
      // 超出阈值后不再保留格子，避免大分量占用额外内存；size 仍然完整计数。
      if (size <= limit) {
        component.push(index);
      }

      const col = index % width;
      const row = (index - col) / width;

      // 固定邻居顺序：上、下、左、右。排序不依赖该顺序，但固定它便于调试与复现。
      if (row > 0) {
        const neighbor = index - width;
        if (visited[neighbor] === 0 && cells[neighbor] === startColor) {
          visited[neighbor] = 1;
          stack[top] = neighbor;
          top += 1;
        }
      }
      if (row + 1 < height) {
        const neighbor = index + width;
        if (visited[neighbor] === 0 && cells[neighbor] === startColor) {
          visited[neighbor] = 1;
          stack[top] = neighbor;
          top += 1;
        }
      }
      if (col > 0) {
        const neighbor = index - 1;
        if (visited[neighbor] === 0 && cells[neighbor] === startColor) {
          visited[neighbor] = 1;
          stack[top] = neighbor;
          top += 1;
        }
      }
      if (col + 1 < width) {
        const neighbor = index + 1;
        if (visited[neighbor] === 0 && cells[neighbor] === startColor) {
          visited[neighbor] = 1;
          stack[top] = neighbor;
          top += 1;
        }
      }
    }

    if (size <= limit) {
      component.sort((a, b) => a - b);
      found.push({ info: { size, cells: component }, minIndex });
    }
  }

  found.sort((a, b) => {
    if (a.info.size !== b.info.size) {
      return a.info.size - b.info.size;
    }
    return a.minIndex - b.minIndex;
  });

  return found.map((entry) => entry.info);
}
