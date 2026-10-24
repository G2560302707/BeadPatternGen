import { EMPTY_CELL, computeStats } from "../core/pattern";
import type { BeadPattern, PatternStats } from "../core/pattern";
import { ExportError } from "./errors";

export function assertExportReady(pattern: BeadPattern): PatternStats {
  const stats = computeStats(pattern);
  let nonEmpty = 0;
  for (let index = 0; index < pattern.cells.length; index += 1) {
    const cell = pattern.cells[index];
    if (cell !== undefined && cell !== EMPTY_CELL) nonEmpty += 1;
  }
  const counted = stats.byColor.reduce((sum, row) => sum + row.count, 0);
  if (counted !== nonEmpty || counted !== stats.beadCount) {
    throw new ExportError(
      "E_STATS_INVARIANT",
      `sum(counts) ${counted} !== nonEmptyCells ${nonEmpty}；拒绝导出。`,
    );
  }
  return stats;
}
