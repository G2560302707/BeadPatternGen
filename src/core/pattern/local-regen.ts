import type { ColorMetricName, RGB } from "../color";
import { buildPaletteIndex } from "../palette";
import type { BeadColor } from "./types";
import { EMPTY_CELL } from "./limits";
import type { CellChange } from "./commands";

export interface LocalRegenInput {
  cells: Int16Array;
  locked: Uint8Array;
  indices: readonly number[];
  width: number;
  height: number;
  rgb: Uint8ClampedArray;
  alpha: Uint8Array;
  palette: readonly BeadColor[];
  metric: ColorMetricName;
  transparentPolicy: "empty" | "background";
}

function readRgb(rgb: Uint8ClampedArray, index: number): RGB {
  const offset = index * 3;
  return {
    r: rgb[offset] ?? 0,
    g: rgb[offset + 1] ?? 0,
    b: rgb[offset + 2] ?? 0,
  };
}

/**
 * 只对选区未锁定格做最近邻重匹配。不调用全图抖动 / refine。
 * 边界格（四邻有未选中格）在「新匹配」与「原色」之间取更接近采样的一方，作过渡。
 */
export function regenSelection(input: LocalRegenInput): CellChange[] {
  const { cells, locked, indices, width, height, rgb, alpha, palette, metric, transparentPolicy } =
    input;
  if (palette.length === 0 || indices.length === 0) return [];
  const index = buildPaletteIndex(palette, metric);
  const selected = new Set(indices);
  const neighbors: Array<readonly [number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  const changes: CellChange[] = [];

  for (const cellIndex of indices) {
    if (locked[cellIndex]) continue;
    const from = cells[cellIndex] ?? EMPTY_CELL;
    const emptySample = (alpha[cellIndex] ?? 0) === 0 && transparentPolicy === "empty";
    if (emptySample) {
      if (from !== EMPTY_CELL) changes.push({ index: cellIndex, from, to: EMPTY_CELL });
      continue;
    }
    const sample = readRgb(rgb, cellIndex);
    let next = index.nearest(sample).index;
    const x = cellIndex % width;
    const y = Math.floor(cellIndex / width);
    let onBoundary = false;
    for (const [dx, dy] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!selected.has(ny * width + nx)) {
        onBoundary = true;
        break;
      }
    }
    if (onBoundary && from !== EMPTY_CELL && from !== next) {
      const keep = index.nearest(sample, [from, next]);
      next = keep.index;
    }
    if (next === from) continue;
    changes.push({ index: cellIndex, from, to: next });
  }
  return changes;
}
