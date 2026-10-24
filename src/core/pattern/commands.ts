import { EMPTY_CELL } from "./limits";
import type { BeadPattern } from "./types";

export type EditKind =
  | "paint"
  | "erase"
  | "fill"
  | "replace"
  | "mirror"
  | "rotate"
  | "translate"
  | "paste"
  | "regen"
  | "restore-base";

export interface CellChange {
  index: number;
  from: number;
  to: number;
}

export interface EditCommand {
  kind: EditKind;
  changes: CellChange[];
}

/** 稀疏差分条数上限：200×200 全图替换仍远小于整幅 Int16 快照 × 80。 */
export const MAX_EDIT_HISTORY = 80;

export const MAX_HISTORY_BYTES = 8 * 1024 * 1024;

export function commandKindForTool(tool: "paint" | "erase"): EditKind {
  return tool;
}

export function applyChanges(cells: Int16Array, changes: readonly CellChange[]): Int16Array {
  const next = new Int16Array(cells);
  for (const change of changes) {
    if (change.index < 0 || change.index >= next.length) continue;
    next[change.index] = change.to;
  }
  return next;
}

export function invertChanges(changes: readonly CellChange[]): CellChange[] {
  return changes.map((change) => ({
    index: change.index,
    from: change.to,
    to: change.from,
  }));
}

export function upsertChange(
  pending: Map<number, CellChange>,
  index: number,
  from: number,
  to: number,
): void {
  if (from === to) {
    pending.delete(index);
    return;
  }
  const existing = pending.get(index);
  if (existing) {
    if (existing.from === to) {
      pending.delete(index);
      return;
    }
    existing.to = to;
    return;
  }
  pending.set(index, { index, from, to });
}

export function changesFromMap(pending: Map<number, CellChange>): CellChange[] {
  return [...pending.values()].sort((a, b) => a.index - b.index);
}

export function mergePaintCommands(a: EditCommand, b: EditCommand): EditCommand | null {
  if (a.kind !== b.kind) return null;
  if (a.kind !== "paint" && a.kind !== "erase") return null;
  const pending = new Map<number, CellChange>();
  for (const change of a.changes) pending.set(change.index, { ...change });
  for (const change of b.changes) {
    const existing = pending.get(change.index);
    if (!existing) {
      pending.set(change.index, { ...change });
      continue;
    }
    if (existing.from === change.to) pending.delete(change.index);
    else existing.to = change.to;
  }
  return { kind: a.kind, changes: changesFromMap(pending) };
}

export function estimateHistoryBytes(stack: readonly EditCommand[]): number {
  let bytes = 0;
  for (const command of stack) {
    bytes += 8 + command.changes.length * 12;
  }
  return bytes;
}

export function applyCommandToPattern(
  pattern: BeadPattern,
  command: EditCommand,
  now: string,
): BeadPattern {
  return {
    ...pattern,
    cells: applyChanges(pattern.cells, command.changes),
    updatedAt: now,
  };
}

export function collectStrokeChange(
  cells: Int16Array,
  index: number,
  to: number,
  pending: Map<number, CellChange>,
): CellChange | null {
  if (index < 0 || index >= cells.length) return null;
  const current = cells[index] ?? EMPTY_CELL;
  if (current === to) return null;
  const origin = pending.get(index)?.from ?? current;
  upsertChange(pending, index, origin, to);
  if (!pending.has(index)) return null;
  return { index, from: current, to };
}
