/**
 * 制作版 PDF 容量：不改 computePages 公式，只选传进去的 maxCols/maxRows 与格点。
 */

export const DEFAULT_CELL_PT = 8;
export const MIN_CELL_PT = 5;
export const PAGE_WARN_COUNT = 4;

/** 与 paginate.countPagesOnAxis 同一整数式，避免改 S12 内核。 */
export function pageCountOnAxis(total: number, capacity: number, overlap: number): number {
  if (total <= capacity) return 1;
  const stride = capacity - overlap;
  if (stride < 1) {
    throw new RangeError("overlap must be smaller than capacity");
  }
  return 1 + Math.ceil((total - capacity) / stride);
}

/**
 * 在纸张最大容量下保持最少页数，并把窗口均分，避免「整页 + 细条」。
 * 70 列 / 容量 65 / overlap 2 → 36，而不是 65。
 */
export function balancedCapacity(total: number, maxCap: number, overlap: number): number {
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new RangeError(`total must be a positive integer; received ${String(total)}`);
  }
  if (!Number.isSafeInteger(maxCap) || maxCap < 1) {
    throw new RangeError(`maxCap must be a positive integer; received ${String(maxCap)}`);
  }
  if (!Number.isSafeInteger(overlap) || overlap < 0) {
    throw new RangeError(`overlap must be a non-negative integer; received ${String(overlap)}`);
  }
  if (overlap >= maxCap) {
    throw new RangeError(`overlap (${overlap}) must be smaller than maxCap (${maxCap})`);
  }
  const n = pageCountOnAxis(total, maxCap, overlap);
  if (n <= 1) return Math.min(maxCap, Math.max(overlap + 1, total));
  const window = Math.ceil((total + (n - 1) * overlap) / n);
  return Math.min(maxCap, Math.max(overlap + 1, window));
}
