import { EMPTY_CELL } from "./limits";
import type { CellChange } from "./commands";

/**
 * R1 · 图层工作区侧车（不进 schema 1.0 JSON）：
 * - 基底 = 生成结果（只读）；
 * - 精修层 = 与 cells 等长的 overlay，EMPTY_CELL 表示透明、透出基底；
 * - 可见矩阵是合成后的一份 Int16Array，导出只读这份合成结果。
 * 最多 1 个基底 + 1 个精修层，不做多层。
 */

/** 合成可见矩阵：overlay 非空处用 overlay，其余透出基底。 */
export function compositeCells(base: Int16Array, overlay: Int16Array): Int16Array {
  const out = new Int16Array(base.length);
  for (let i = 0; i < out.length; i += 1) {
    const over = overlay[i] ?? EMPTY_CELL;
    out[i] = over === EMPTY_CELL ? (base[i] ?? EMPTY_CELL) : over;
  }
  return out;
}

/** 反推 overlay：可见矩阵与基底相同的格视为透明。 */
export function deriveOverlay(composite: Int16Array, base: Int16Array): Int16Array {
  const out = new Int16Array(composite.length);
  for (let i = 0; i < out.length; i += 1) {
    const value = composite[i] ?? EMPTY_CELL;
    out[i] = value === (base[i] ?? EMPTY_CELL) ? EMPTY_CELL : value;
  }
  return out;
}

/**
 * 把命令写入 overlay。只读 `to`：execute / undo（传反演后的 changes）/
 * redo 走同一实现；写回的值等于基底时视为透明，保证 overlay 始终可再合成。
 */
export function applyChangesToOverlay(
  overlay: Int16Array,
  base: Int16Array,
  changes: readonly CellChange[],
): Int16Array {
  const next = new Int16Array(overlay);
  for (const change of changes) {
    if (change.index < 0 || change.index >= next.length) continue;
    const baseValue = base[change.index] ?? EMPTY_CELL;
    next[change.index] = change.to === baseValue ? EMPTY_CELL : change.to;
  }
  return next;
}

/** 精修层相对基底是否有可见差异（用于「从基底还原精修层」的可用态）。 */
export function hasOverlayContent(composite: Int16Array, base: Int16Array): boolean {
  const length = Math.min(composite.length, base.length);
  for (let i = 0; i < length; i += 1) {
    if ((composite[i] ?? EMPTY_CELL) !== (base[i] ?? EMPTY_CELL)) return true;
  }
  return false;
}
