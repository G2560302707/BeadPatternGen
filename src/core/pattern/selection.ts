import { EMPTY_CELL } from "./limits";
import type { CellChange } from "./commands";

export interface ClipboardPatch {
  originX: number;
  originY: number;
  width: number;
  height: number;
  cells: Int16Array;
}

export function rectIndices(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number,
): number[] {
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(width - 1, Math.max(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(height - 1, Math.max(y0, y1));
  const out: number[] = [];
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      out.push(y * width + x);
    }
  }
  return out;
}

function pointInPolygon(x: number, y: number, ring: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const intersect =
      a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y + Number.EPSILON) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function lassoIndices(
  points: readonly { x: number; y: number }[],
  width: number,
  height: number,
): number[] {
  if (points.length < 3) return [];
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(width - 1, Math.ceil(maxX));
  maxY = Math.min(height - 1, Math.ceil(maxY));
  const out: number[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, points)) out.push(y * width + x);
    }
  }
  return out;
}

export function selectionBBox(
  indices: readonly number[],
  width: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (indices.length === 0) return null;
  let x0 = width;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = 0;
  let y1 = 0;
  for (const index of indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

export function fillSelection(
  cells: Int16Array,
  indices: readonly number[],
  value: number,
): CellChange[] {
  const changes: CellChange[] = [];
  for (const index of indices) {
    const from = cells[index];
    if (from === undefined || from === value) continue;
    changes.push({ index, from, to: value });
  }
  return changes;
}

export function replaceColorInSelection(
  cells: Int16Array,
  indices: readonly number[],
  fromColor: number,
  toColor: number,
): CellChange[] {
  if (fromColor === toColor) return [];
  const changes: CellChange[] = [];
  for (const index of indices) {
    if (cells[index] !== fromColor) continue;
    changes.push({ index, from: fromColor, to: toColor });
  }
  return changes;
}

export function mirrorSelection(
  cells: Int16Array,
  indices: readonly number[],
  width: number,
  axis: "h" | "v",
): CellChange[] {
  const box = selectionBBox(indices, width);
  if (!box) return [];
  const selected = new Set(indices);
  const pending = new Map<number, { from: number; to: number }>();
  const write = (index: number, to: number) => {
    const from = cells[index] ?? EMPTY_CELL;
    const current = pending.get(index);
    if (current) current.to = to;
    else pending.set(index, { from, to });
  };

  for (const index of indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    const mx = axis === "h" ? box.x0 + box.x1 - x : x;
    const my = axis === "v" ? box.y0 + box.y1 - y : y;
    const pair = my * width + mx;
    if (!selected.has(pair)) continue;
    if (index >= pair) continue;
    const a = cells[index] ?? EMPTY_CELL;
    const b = cells[pair] ?? EMPTY_CELL;
    write(index, b);
    write(pair, a);
  }

  return [...pending.entries()]
    .filter(([, value]) => value.from !== value.to)
    .map(([index, value]) => ({ index, from: value.from, to: value.to }))
    .sort((a, b) => a.index - b.index);
}

export interface SelectionTransformResult {
  changes: CellChange[];
  /** 落到画布外被丢弃的选区像素数。 */
  clipped: number;
  /** 变换后内容所在的格（画布内、升序），可直接作为新选区。 */
  selection: number[];
}

/**
 * 选区旋转 / 平移的通用落盘：目标格覆盖写入，未接收到新值的源格清成
 * EMPTY_CELL。changes 按索引升序，且每个索引至多出现一次。
 */
function transformChanges(
  cells: Int16Array,
  indices: readonly number[],
  moved: Map<number, number>,
): CellChange[] {
  const changes: CellChange[] = [];
  for (const [dest, to] of moved) {
    const from = cells[dest] ?? EMPTY_CELL;
    if (from !== to) changes.push({ index: dest, from, to });
  }
  for (const index of indices) {
    if (moved.has(index)) continue;
    const from = cells[index] ?? EMPTY_CELL;
    if (from !== EMPTY_CELL) changes.push({ index, from, to: EMPTY_CELL });
  }
  return changes.sort((a, b) => a.index - b.index);
}

/**
 * 选区绕包围盒左上角旋转 quarterTurns × 90°（顺时针）。
 * 非正方形包围盒会换成新宽高（2×3 转 90° 变 3×2）；越出画布的像素
 * 丢弃并计入 clipped。square 全选时与 rotateSelectionCW 结果一致。
 */
export function rotateSelection(
  cells: Int16Array,
  indices: readonly number[],
  width: number,
  height: number,
  quarterTurns: number,
): SelectionTransformResult {
  const box = selectionBBox(indices, width);
  if (!box || indices.length === 0) return { changes: [], clipped: 0, selection: [] };
  const turns = ((Math.trunc(quarterTurns) % 4) + 4) % 4;
  if (turns === 0) return { changes: [], clipped: 0, selection: [...indices].sort((a, b) => a - b) };
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const moved = new Map<number, number>();
  const nextSelection = new Set<number>();
  let clipped = 0;
  for (const index of indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    const lx = x - box.x0;
    const ly = y - box.y0;
    let nlx: number;
    let nly: number;
    if (turns === 1) {
      nlx = bh - 1 - ly;
      nly = lx;
    } else if (turns === 2) {
      nlx = bw - 1 - lx;
      nly = bh - 1 - ly;
    } else {
      nlx = ly;
      nly = bw - 1 - lx;
    }
    const nx = box.x0 + nlx;
    const ny = box.y0 + nly;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
      clipped += 1;
      continue;
    }
    moved.set(ny * width + nx, cells[index] ?? EMPTY_CELL);
    nextSelection.add(ny * width + nx);
  }
  return {
    changes: transformChanges(cells, indices, moved),
    clipped,
    selection: [...nextSelection].sort((a, b) => a - b),
  };
}

/**
 * 选区整体平移 (dx, dy)。移出画布的像素丢弃并计入 clipped；目标格覆盖；
 * 源格清成 EMPTY_CELL，除非仍被其他选区像素移入。
 */
export function translateSelection(
  cells: Int16Array,
  indices: readonly number[],
  width: number,
  height: number,
  dx: number,
  dy: number,
): SelectionTransformResult {
  if (indices.length === 0) return { changes: [], clipped: 0, selection: [] };
  const ox = Math.trunc(dx);
  const oy = Math.trunc(dy);
  if (ox === 0 && oy === 0) return { changes: [], clipped: 0, selection: [...indices].sort((a, b) => a - b) };
  const moved = new Map<number, number>();
  const nextSelection = new Set<number>();
  let clipped = 0;
  for (const index of indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    const nx = x + ox;
    const ny = y + oy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
      clipped += 1;
      continue;
    }
    moved.set(ny * width + nx, cells[index] ?? EMPTY_CELL);
    nextSelection.add(ny * width + nx);
  }
  return {
    changes: transformChanges(cells, indices, moved),
    clipped,
    selection: [...nextSelection].sort((a, b) => a - b),
  };
}

export function rotateSelectionCW(
  cells: Int16Array,
  indices: readonly number[],
  width: number,
): CellChange[] {
  const box = selectionBBox(indices, width);
  if (!box) return [];
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  if (bw !== bh) return [];
  const selected = new Set(indices);
  const next = new Map<number, number>();
  for (const index of indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    const lx = x - box.x0;
    const ly = y - box.y0;
    const nx = box.x0 + (bh - 1 - ly);
    const ny = box.y0 + lx;
    const dest = ny * width + nx;
    if (!selected.has(dest)) continue;
    next.set(dest, cells[index] ?? EMPTY_CELL);
  }
  const changes: CellChange[] = [];
  for (const index of indices) {
    const to = next.get(index);
    if (to === undefined) continue;
    const from = cells[index] ?? EMPTY_CELL;
    if (from === to) continue;
    changes.push({ index, from, to });
  }
  return changes.sort((a, b) => a.index - b.index);
}

export function copySelection(
  cells: Int16Array,
  indices: readonly number[],
  width: number,
): ClipboardPatch | null {
  const box = selectionBBox(indices, width);
  if (!box) return null;
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const patch = new Int16Array(w * h).fill(EMPTY_CELL);
  const selected = new Set(indices);
  for (const index of indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (!selected.has(index)) continue;
    patch[(y - box.y0) * w + (x - box.x0)] = cells[index] ?? EMPTY_CELL;
  }
  return { originX: box.x0, originY: box.y0, width: w, height: h, cells: patch };
}

export function pastePatch(
  cells: Int16Array,
  width: number,
  height: number,
  patch: ClipboardPatch,
  destX: number,
  destY: number,
): CellChange[] {
  const changes: CellChange[] = [];
  for (let y = 0; y < patch.height; y += 1) {
    for (let x = 0; x < patch.width; x += 1) {
      const value = patch.cells[y * patch.width + x];
      if (value === undefined || value === EMPTY_CELL) continue;
      const tx = destX + x;
      const ty = destY + y;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      const index = ty * width + tx;
      const from = cells[index] ?? EMPTY_CELL;
      if (from === value) continue;
      changes.push({ index, from, to: value });
    }
  }
  return changes;
}
