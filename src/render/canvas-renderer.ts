/**
 * S11 · 只读 Canvas 2D 渲染器。
 * 只读取 BeadPattern，不计算、不修改颜色矩阵。
 */

import { EMPTY_CELL } from "../core/pattern";
import type { BeadPattern } from "../core/pattern";
import { displayCoord, inkCssOnHex, isMajorLine } from "./chart-style";
import {
  canShowCodes,
  shouldDrawGrid,
  visibleCellRange,
  type ViewTransform,
  type ViewportSize,
} from "./view-transform";

export interface DisplayOptions {
  showGrid: boolean;
  showCoords: boolean;
  showCodes: boolean;
  highlightColorIndex: number | null;
  highlightCells: ReadonlySet<number> | null;
}

export interface PaintStats {
  cellsPainted: number;
  elapsedMs: number;
}

const RULER = 22;
const GRID_MIN_FOR_COORDS = 8;

function hatchEmpty(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.fillStyle = "#f6f1ea";
  ctx.fillRect(x, y, size, size);
  if (size < 6) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.strokeStyle = "rgba(180, 180, 180, 0.85)";
  ctx.lineWidth = 1;
  const step = Math.max(4, size / 4);
  for (let d = -size; d < size * 2; d += step) {
    ctx.beginPath();
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d + size, y + size);
    ctx.stroke();
  }
  ctx.restore();
}

export function paintPattern(
  ctx: CanvasRenderingContext2D,
  pattern: BeadPattern,
  view: ViewTransform,
  viewport: ViewportSize,
  options: DisplayOptions,
): PaintStats {
  const started = performance.now();
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = "#f4f8fc";
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  const range = visibleCellRange(pattern.width, pattern.height, view, viewport);
  const scale = view.scale;
  const dimming =
    options.highlightColorIndex !== null ||
    (options.highlightCells !== null && options.highlightCells.size > 0);
  let cellsPainted = 0;

  const gridLeft = view.offsetX;
  const gridTop = view.offsetY;
  const gridRight = view.offsetX + pattern.width * scale;
  const gridBottom = view.offsetY + pattern.height * scale;

  for (let y = range.y0; y < range.y1; y += 1) {
    for (let x = range.x0; x < range.x1; x += 1) {
      const index = y * pattern.width + x;
      const paletteIndex = pattern.cells[index] ?? EMPTY_CELL;
      const screenX = view.offsetX + x * scale;
      const screenY = view.offsetY + y * scale;

      if (paletteIndex === EMPTY_CELL) {
        hatchEmpty(ctx, screenX, screenY, scale);
        continue;
      }
      const color = pattern.palette[paletteIndex];
      if (color === undefined) continue;

      let dim = false;
      if (dimming) {
        if (options.highlightColorIndex !== null && paletteIndex !== options.highlightColorIndex)
          dim = true;
        if (
          options.highlightCells &&
          options.highlightCells.size > 0 &&
          !options.highlightCells.has(index)
        ) {
          dim = true;
        }
      }

      ctx.globalAlpha = dim ? 0.18 : 1;
      ctx.fillStyle = color.hex;
      ctx.fillRect(screenX, screenY, scale, scale);
      cellsPainted += 1;

      if (options.showCodes && canShowCodes(scale) && scale >= 18 && !dim) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = inkCssOnHex(color.hex);
        ctx.font = `${Math.max(8, scale * 0.28)}px ui-monospace, Consolas, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(color.code, screenX + scale / 2, screenY + scale / 2);
      }

      if (options.highlightCells?.has(index)) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#b61927";
        ctx.lineWidth = Math.max(1, scale * 0.08);
        ctx.strokeRect(screenX + 0.5, screenY + 0.5, scale - 1, scale - 1);
      }
    }
  }

  ctx.globalAlpha = 1;

  if (shouldDrawGrid(scale, options.showGrid)) {
    ctx.strokeStyle = "rgba(180, 168, 150, 0.7)";
    ctx.lineWidth = 1;
    for (let x = range.x0; x <= range.x1; x += 1) {
      const screenX = Math.floor(view.offsetX + x * scale) + 0.5;
      ctx.beginPath();
      ctx.moveTo(screenX, view.offsetY + range.y0 * scale);
      ctx.lineTo(screenX, view.offsetY + range.y1 * scale);
      ctx.stroke();
    }
    for (let y = range.y0; y <= range.y1; y += 1) {
      const screenY = Math.floor(view.offsetY + y * scale) + 0.5;
      ctx.beginPath();
      ctx.moveTo(view.offsetX + range.x0 * scale, screenY);
      ctx.lineTo(view.offsetX + range.x1 * scale, screenY);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(214, 122, 48, 0.95)";
    ctx.lineWidth = Math.max(1.5, scale * 0.06);
    for (let x = range.x0; x <= range.x1; x += 1) {
      if (!isMajorLine(x) && x !== pattern.width) continue;
      if (x !== 0 && x !== pattern.width && !isMajorLine(x)) continue;
      const screenX = Math.floor(view.offsetX + x * scale) + 0.5;
      ctx.beginPath();
      ctx.moveTo(screenX, gridTop);
      ctx.lineTo(screenX, gridBottom);
      ctx.stroke();
    }
    for (let y = range.y0; y <= range.y1; y += 1) {
      if (y !== 0 && y !== pattern.height && !isMajorLine(y)) continue;
      const screenY = Math.floor(view.offsetY + y * scale) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gridLeft, screenY);
      ctx.lineTo(gridRight, screenY);
      ctx.stroke();
    }
  }

  if (options.showCoords && scale >= GRID_MIN_FOR_COORDS) {
    ctx.fillStyle = "rgba(44, 33, 24, 0.82)";
    ctx.font = `${Math.max(9, Math.min(12, scale * 0.35))}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const topY = gridTop - RULER / 2;
    const bottomY = gridBottom + RULER / 2;
    for (let x = range.x0; x < range.x1; x += 1) {
      const label = String(displayCoord(x));
      const cx = view.offsetX + x * scale + scale / 2;
      ctx.fillText(label, cx, topY);
      ctx.fillText(label, cx, bottomY);
    }
    ctx.textAlign = "right";
    for (let y = range.y0; y < range.y1; y += 1) {
      const label = String(displayCoord(y));
      const cy = view.offsetY + y * scale + scale / 2;
      ctx.fillText(label, gridLeft - 4, cy);
      ctx.textAlign = "left";
      ctx.fillText(label, gridRight + 4, cy);
      ctx.textAlign = "right";
    }
  }

  return { cellsPainted, elapsedMs: performance.now() - started };
}
