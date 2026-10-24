import { PatternError } from "./errors";
import { EMPTY_CELL } from "./limits";
import type { BeadPattern, ColorUsageStat, PatternStats } from "./types";
import { validatePattern } from "./validate";

export function computeStats(pattern: BeadPattern): PatternStats {
  validatePattern(pattern);
  const counts = new Array<number>(pattern.palette.length).fill(0);
  let beadCount = 0;
  for (let i = 0; i < pattern.cells.length; i += 1) {
    const index = pattern.cells[i];
    if (index === undefined || index === EMPTY_CELL) {
      continue;
    }
    const current = counts[index];
    if (current === undefined) {
      throw new PatternError("E_INDEX_OUT_OF_RANGE", `stats hit invalid index ${index}`);
    }
    counts[index] = current + 1;
    beadCount += 1;
  }
  const sum = counts.reduce((acc, n) => acc + n, 0);
  if (sum !== beadCount) {
    throw new PatternError(
      "E_STATS_INVARIANT",
      `sum(counts) ${sum} !== nonEmptyCells ${beadCount}`,
    );
  }
  const byColor: ColorUsageStat[] = pattern.palette.map((color, i) => {
    const count = counts[i] ?? 0;
    return {
      code: color.code,
      name: color.name,
      hex: color.hex,
      count,
      percentage: beadCount === 0 ? 0 : (count / beadCount) * 100,
    };
  });
  const used = byColor.filter((row) => row.count > 0).length;
  return { beadCount, colorCount: used, byColor };
}
