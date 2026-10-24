import { PatternError } from "./errors";
import { EMPTY_CELL } from "./limits";
import type { BeadPattern, ColorUsageStat, PatternStats } from "./types";
import type { CellChange } from "./commands";

function bump(counts: number[], index: number, delta: number): void {
  if (index === EMPTY_CELL) return;
  const current = counts[index];
  if (current === undefined) {
    throw new PatternError("E_INDEX_OUT_OF_RANGE", `stats delta hit invalid index ${index}`);
  }
  counts[index] = current + delta;
}

/**
 * 按格子差分更新用量。不重扫整张 cells。
 * 诊断（连通域）仍走全图 `buildReport`，因为碎片/细线无法局部闭合。
 */
export function applyChangesToStats(
  stats: PatternStats,
  paletteLength: number,
  changes: readonly CellChange[],
): PatternStats {
  const counts = new Array<number>(paletteLength).fill(0);
  for (let i = 0; i < paletteLength; i += 1) {
    counts[i] = stats.byColor[i]?.count ?? 0;
  }

  let beadCount = stats.beadCount;
  for (const change of changes) {
    if (change.from !== EMPTY_CELL && change.to === EMPTY_CELL) beadCount -= 1;
    if (change.from === EMPTY_CELL && change.to !== EMPTY_CELL) beadCount += 1;
    bump(counts, change.from, -1);
    bump(counts, change.to, 1);
  }

  if (beadCount < 0) {
    throw new PatternError("E_STATS_INVARIANT", `beadCount went negative (${beadCount})`);
  }

  const byColor: ColorUsageStat[] = stats.byColor.map((row, i) => {
    const count = counts[i] ?? 0;
    return {
      ...row,
      count,
      percentage: beadCount === 0 ? 0 : (count / beadCount) * 100,
    };
  });
  const used = byColor.filter((row) => row.count > 0).length;
  return { beadCount, colorCount: used, byColor };
}

export function emptyLocked(pattern: BeadPattern): Uint8Array {
  return new Uint8Array(pattern.cells.length);
}

export function markLocked(locked: Uint8Array, changes: readonly CellChange[]): Uint8Array {
  const next = new Uint8Array(locked);
  for (const change of changes) {
    if (change.index >= 0 && change.index < next.length) next[change.index] = 1;
  }
  return next;
}
