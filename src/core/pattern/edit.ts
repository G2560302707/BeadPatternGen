import { MAX_EDIT_HISTORY as COMMAND_MAX_EDIT_HISTORY } from "./commands";
import { EMPTY_CELL } from "./limits";

export type PatternEditTool =
  | "pan"
  | "paint"
  | "erase"
  | "eyedrop"
  | "select-rect"
  | "select-lasso";

export const MAX_EDIT_HISTORY = COMMAND_MAX_EDIT_HISTORY;

export function paintValue(tool: PatternEditTool, colorIndex: number): number | null {
  if (tool === "erase") return EMPTY_CELL;
  if (tool === "paint") return colorIndex;
  return null;
}

/** 视口坐标 → 格子；越界返回 null。 */
export function cellAtScreen(
  screenX: number,
  screenY: number,
  offsetX: number,
  offsetY: number,
  scale: number,
  width: number,
  height: number,
): { x: number; y: number; index: number } | null {
  const x = Math.floor((screenX - offsetX) / scale);
  const y = Math.floor((screenY - offsetY) / scale);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  return { x, y, index: y * width + x };
}

export function writeCell(cells: Int16Array, index: number, value: number): boolean {
  if (index < 0 || index >= cells.length) return false;
  if (cells[index] === value) return false;
  cells[index] = value;
  return true;
}
