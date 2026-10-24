import { hexToRgb } from "../core/color";

/** 图纸计数坐标从 1 起，与参考印刷图一致。 */
export const COORD_ORIGIN = 1;

/** 分区粗线间隔（格）。 */
export const MAJOR_EVERY = 10;

export const PAPER_RGB = { r: 243, g: 234, b: 216 };
export const EMPTY_FILL = { r: 246, g: 241, b: 234 };
export const HATCH_RGB = { r: 196, g: 196, b: 196 };
export const GRID_RGB = { r: 180, g: 168, b: 150 };
export const MAJOR_RGB = { r: 214, g: 122, b: 48 };
export const INK_DARK = { r: 44, g: 33, b: 24 };
export const INK_LIGHT = { r: 247, g: 242, b: 234 };

export function isMajorLine(gridIndex: number): boolean {
  return gridIndex % MAJOR_EVERY === 0;
}

export function displayCoord(gridIndex: number): number {
  return gridIndex + COORD_ORIGIN;
}

/** 相对亮度；亮底深字，暗底浅字。 */
export function inkOnRgb(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return y > 0.55 ? INK_DARK : INK_LIGHT;
}

export function inkOnHex(hex: string): { r: number; g: number; b: number } {
  const rgb = hexToRgb(hex);
  return inkOnRgb(rgb.r, rgb.g, rgb.b);
}

export function inkCssOnHex(hex: string): string {
  const ink = inkOnHex(hex);
  return `rgb(${ink.r}, ${ink.g}, ${ink.b})`;
}
