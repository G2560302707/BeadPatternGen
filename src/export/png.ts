/**
 * PNG 导出：颜色只来自 pattern.palette，不二次量化，不走 Canvas 平滑。
 * 边长超过 MAX_CANVAS_EDGE 时按条带写入像素缓冲，不分配超大 Canvas。
 */

import { encode as encodePng } from "fast-png";
import { hexToRgb } from "../core/color";
import { EMPTY_CELL } from "../core/pattern";
import type { BeadPattern, PatternStats } from "../core/pattern";
import {
  EMPTY_FILL,
  GRID_RGB,
  HATCH_RGB,
  INK_DARK,
  MAJOR_RGB,
  PAPER_RGB,
  displayCoord,
  inkOnRgb,
  isMajorLine,
} from "../render/chart-style";
import { assertExportReady } from "./assert";
import { GLYPH_H, bitmapTextWidth, forEachBitmapPixel } from "./bitmap-font";
import { ExportError } from "./errors";

export const PNG_CELL_SIZES = [8, 16, 24, 32] as const;
export type PngCellSize = (typeof PNG_CELL_SIZES)[number];

/** 禁止一次性分配超过该边长的 Canvas。像素缓冲按条带写入。 */
export const MAX_CANVAS_EDGE = 8000;

const TILE_ROWS = 64;
const TITLE_H = 18;
const CHIP_H = 18;
const SWATCH = 12;

export interface PngExportOptions {
  cellSize: PngCellSize;
  showGrid: boolean;
  showCoords: boolean;
  showCodes: boolean;
  showLegend: boolean;
}

export interface PngLayout {
  width: number;
  height: number;
  gridOriginX: number;
  gridOriginY: number;
  cellSize: number;
  gutter: number;
}

const DEFAULT_OPTIONS: PngExportOptions = {
  cellSize: 16,
  showGrid: true,
  showCoords: true,
  showCodes: true,
  showLegend: true,
};

function coordGutter(cellSize: number, showCoords: boolean): number {
  if (!showCoords) return 0;
  return Math.max(22, cellSize + 6);
}

function legendChipWidth(code: string, count: number): number {
  const label = `${code} (${count})`;
  return SWATCH + 6 + bitmapTextWidth(label, 1) + 10;
}

function legendHeight(stats: PatternStats, canvasWidth: number, showLegend: boolean): number {
  if (!showLegend) return 0;
  const used = stats.byColor.filter((row) => row.count > 0);
  let x = 8;
  let rows = 1;
  for (const row of used) {
    const w = legendChipWidth(row.code, row.count);
    if (x + w > canvasWidth - 8) {
      rows += 1;
      x = 8;
    }
    x += w;
  }
  return 16 + (rows + 1) * CHIP_H;
}

export function pngLayout(
  pattern: BeadPattern,
  options: PngExportOptions,
  stats?: PatternStats,
): PngLayout {
  const gutter = coordGutter(options.cellSize, options.showCoords);
  const gridW = pattern.width * options.cellSize + 1;
  const gridH = pattern.height * options.cellSize + 1;
  const width = Math.max(gutter * 2 + gridW, 240);
  const legendH = options.showLegend
    ? legendHeight(
        stats ?? {
          beadCount: 0,
          colorCount: 0,
          byColor: pattern.palette.map((color) => ({
            code: color.code,
            name: color.name,
            hex: color.hex,
            count: 1,
            percentage: 0,
          })),
        },
        width,
        true,
      )
    : 0;
  return {
    width,
    height: TITLE_H + gutter + gridH + gutter + legendH,
    gridOriginX: gutter,
    gridOriginY: TITLE_H + gutter,
    cellSize: options.cellSize,
    gutter,
  };
}

function setPixel(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  data[offset] = r;
  data[offset + 1] = g;
  data[offset + 2] = b;
  data[offset + 3] = 255;
}

function fillRect(
  data: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
): void {
  const x1 = Math.min(width, x0 + w);
  const y1 = Math.min(height, y0 + h);
  const xs = Math.max(0, x0);
  const ys = Math.max(0, y0);
  for (let y = ys; y < y1; y += 1) {
    for (let x = xs; x < x1; x += 1) {
      setPixel(data, width, height, x, y, r, g, b);
    }
  }
}

function hatchCell(
  data: Uint8Array,
  width: number,
  height: number,
  px: number,
  py: number,
  cellSize: number,
): void {
  fillRect(
    data,
    width,
    height,
    px,
    py,
    cellSize,
    cellSize,
    EMPTY_FILL.r,
    EMPTY_FILL.g,
    EMPTY_FILL.b,
  );
  for (let d = -cellSize; d < cellSize * 2; d += 4) {
    for (let t = 0; t < cellSize; t += 1) {
      setPixel(data, width, height, px + d + t, py + t, HATCH_RGB.r, HATCH_RGB.g, HATCH_RGB.b);
    }
  }
}

function plotText(
  data: Uint8Array,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  scale = 1,
): void {
  forEachBitmapPixel(text, x, y, scale, (px, py) => {
    setPixel(data, width, height, px, py, r, g, b);
  });
}

function drawVLine(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y0: number,
  y1: number,
  rgb: { r: number; g: number; b: number },
  thick: number,
): void {
  for (let t = 0; t < thick; t += 1) {
    for (let y = y0; y <= y1; y += 1) {
      setPixel(data, width, height, x + t, y, rgb.r, rgb.g, rgb.b);
    }
  }
}

function drawHLine(
  data: Uint8Array,
  width: number,
  height: number,
  y: number,
  x0: number,
  x1: number,
  rgb: { r: number; g: number; b: number },
  thick: number,
): void {
  for (let t = 0; t < thick; t += 1) {
    for (let x = x0; x <= x1; x += 1) {
      setPixel(data, width, height, x, y + t, rgb.r, rgb.g, rgb.b);
    }
  }
}

export function renderPngRgba(
  pattern: BeadPattern,
  options: PngExportOptions = DEFAULT_OPTIONS,
): { layout: PngLayout; data: Uint8Array } {
  if (!PNG_CELL_SIZES.includes(options.cellSize)) {
    throw new ExportError(
      "E_INVALID_OPTION",
      `cellSize must be 8/16/24/32; got ${String(options.cellSize)}`,
    );
  }
  const showCodes = options.showCodes && options.cellSize >= 16;
  const stats = assertExportReady(pattern);
  const layout = pngLayout(pattern, { ...options, showCodes }, stats);
  const { width, height, gridOriginX, gridOriginY, cellSize, gutter } = layout;
  const data = new Uint8Array(width * height * 4);
  fillRect(data, width, height, 0, 0, width, height, PAPER_RGB.r, PAPER_RGB.g, PAPER_RGB.b);

  const title = asciiTitle(
    `${pattern.title}  ${pattern.width}x${pattern.height}  ${pattern.paletteId}`,
  );
  plotText(data, width, height, title, 8, 4, INK_DARK.r, INK_DARK.g, INK_DARK.b, 1);

  const paletteRgb = pattern.palette.map((color) => hexToRgb(color.hex));

  for (let tileY = 0; tileY < pattern.height; tileY += TILE_ROWS) {
    const tileH = Math.min(TILE_ROWS, pattern.height - tileY);
    for (let y = 0; y < tileH; y += 1) {
      const gy = tileY + y;
      for (let gx = 0; gx < pattern.width; gx += 1) {
        const cell = pattern.cells[gy * pattern.width + gx] ?? EMPTY_CELL;
        const px = gridOriginX + gx * cellSize;
        const py = gridOriginY + gy * cellSize;
        if (cell === EMPTY_CELL) {
          hatchCell(data, width, height, px, py, cellSize);
          continue;
        }
        const rgb = paletteRgb[cell];
        if (rgb === undefined) {
          throw new ExportError("E_EXPORT", `cell (${gx},${gy}) palette index ${cell} is missing`);
        }
        fillRect(data, width, height, px, py, cellSize, cellSize, rgb.r, rgb.g, rgb.b);
        if (showCodes) {
          const ink = inkOnRgb(rgb.r, rgb.g, rgb.b);
          const code = pattern.palette[cell]?.code ?? "";
          const scale = cellSize >= 24 ? 2 : 1;
          const tw = bitmapTextWidth(code, scale);
          const tx = px + Math.max(1, Math.floor((cellSize - tw) / 2));
          const ty = py + Math.max(1, Math.floor((cellSize - GLYPH_H * scale) / 2));
          plotText(data, width, height, code, tx, ty, ink.r, ink.g, ink.b, scale);
        }
      }
    }
  }

  const gridRight = gridOriginX + pattern.width * cellSize;
  const gridBottom = gridOriginY + pattern.height * cellSize;

  if (options.showGrid && cellSize >= 4) {
    for (let gx = 0; gx <= pattern.width; gx += 1) {
      const x = gridOriginX + gx * cellSize;
      const major = isMajorLine(gx) || gx === pattern.width;
      drawVLine(
        data,
        width,
        height,
        x,
        gridOriginY,
        gridBottom,
        major ? MAJOR_RGB : GRID_RGB,
        major ? 2 : 1,
      );
    }
    for (let gy = 0; gy <= pattern.height; gy += 1) {
      const y = gridOriginY + gy * cellSize;
      const major = isMajorLine(gy) || gy === pattern.height;
      drawHLine(
        data,
        width,
        height,
        y,
        gridOriginX,
        gridRight,
        major ? MAJOR_RGB : GRID_RGB,
        major ? 2 : 1,
      );
    }
  }

  if (options.showCoords && gutter > 4) {
    const scale = cellSize >= 24 ? 2 : 1;
    for (let gx = 0; gx < pattern.width; gx += 1) {
      const label = String(displayCoord(gx));
      const tw = bitmapTextWidth(label, scale);
      const cx = gridOriginX + gx * cellSize + Math.floor((cellSize - tw) / 2);
      plotText(
        data,
        width,
        height,
        label,
        cx,
        TITLE_H + 2,
        INK_DARK.r,
        INK_DARK.g,
        INK_DARK.b,
        scale,
      );
      plotText(
        data,
        width,
        height,
        label,
        cx,
        gridBottom + 4,
        INK_DARK.r,
        INK_DARK.g,
        INK_DARK.b,
        scale,
      );
    }
    for (let gy = 0; gy < pattern.height; gy += 1) {
      const label = String(displayCoord(gy));
      const tw = bitmapTextWidth(label, scale);
      const cy = gridOriginY + gy * cellSize + Math.floor((cellSize - GLYPH_H * scale) / 2);
      plotText(
        data,
        width,
        height,
        label,
        Math.max(1, gutter - tw - 3),
        cy,
        INK_DARK.r,
        INK_DARK.g,
        INK_DARK.b,
        scale,
      );
      plotText(
        data,
        width,
        height,
        label,
        gridRight + 3,
        cy,
        INK_DARK.r,
        INK_DARK.g,
        INK_DARK.b,
        scale,
      );
    }
  }

  if (options.showLegend) {
    const used = stats.byColor.filter((row) => row.count > 0);
    let x = 8;
    let y = gridBottom + gutter + 6;
    const total = `TOTAL ${stats.beadCount}`;
    plotText(data, width, height, total, x, y, INK_DARK.r, INK_DARK.g, INK_DARK.b, 1);
    y += CHIP_H;
    x = 8;
    for (const row of used) {
      const chipW = legendChipWidth(row.code, row.count);
      if (x + chipW > width - 8) {
        x = 8;
        y += CHIP_H;
      }
      const rgb = hexToRgb(row.hex);
      fillRect(data, width, height, x, y, SWATCH, SWATCH, rgb.r, rgb.g, rgb.b);
      plotText(
        data,
        width,
        height,
        `${row.code} (${row.count})`,
        x + SWATCH + 4,
        y + 2,
        INK_DARK.r,
        INK_DARK.g,
        INK_DARK.b,
        1,
      );
      x += chipW;
    }
  }

  return { layout, data };
}

function asciiTitle(text: string): string {
  return [...text]
    .map((ch) => (/[A-Za-z0-9 ._\-x/()]/.test(ch) ? ch : ""))
    .join("")
    .trim();
}

export function exportPng(
  pattern: BeadPattern,
  options: PngExportOptions = DEFAULT_OPTIONS,
): Uint8Array {
  const { layout, data } = renderPngRgba(pattern, options);
  return encodePng({
    width: layout.width,
    height: layout.height,
    data,
    channels: 4,
    depth: 8,
  });
}

export function cellCenterSample(
  layout: PngLayout,
  gridX: number,
  gridY: number,
): { x: number; y: number } {
  return {
    x: layout.gridOriginX + gridX * layout.cellSize + Math.floor(layout.cellSize / 2),
    y: layout.gridOriginY + gridY * layout.cellSize + Math.floor(layout.cellSize / 2),
  };
}

/** 避开格心色号，抽靠近格角的像素。 */
export function cellCornerSample(
  layout: PngLayout,
  gridX: number,
  gridY: number,
): { x: number; y: number } {
  return {
    x: layout.gridOriginX + gridX * layout.cellSize + 2,
    y: layout.gridOriginY + gridY * layout.cellSize + 2,
  };
}
