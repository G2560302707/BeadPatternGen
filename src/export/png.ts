/**
 * 图纸 PNG 导出：与分享图纸卡片同一套「宣传卡片」版式（card-style 令牌），
 * 但走纯像素渲染——不经 Canvas、可在 Node 里跑，颜色只来自 pattern.palette，
 * 不二次量化、无抗锯齿，格心/格角像素可被脚本精确采样。
 *
 * 结构自上而下：暖粉渐变背景 → 页眉信息栏（SIZE/PALETTE/COLORS/BEADS + 红描边标签，
 * 位图字体仅 ASCII）→ 白色圆角图纸卡片（红 L 角标 + 四边行列号 + 每 5 格分区线）→
 * 圆角色卡图例（按用量排序）→ 脚注。格尺寸 8–64px：格子越大像素越多，放大查看越清晰；
 * 需要「放大永不模糊」时改用 exportSvg（矢量）。
 */

import { encode as encodePng } from "fast-png";
import { hexToRgb } from "../core/color";
import { EMPTY_CELL } from "../core/pattern";
import type { BeadPattern, PatternStats } from "../core/pattern";
import { assertExportReady } from "./assert";
import {
  ACCENT,
  CARD_BG_GRADIENT,
  CARD_FACE,
  CARD_FOOTER_EN,
  CARD_MAJOR_EVERY,
  CARD_SHADOW,
  CARD_TAG_EN,
  EMPTY_CELL_FILL,
  GRID_LINE_SOLID,
  GRID_MAJOR_SOLID,
  INK,
  INK_FADED,
  INK_SOFT,
  asciiCardHeaderItems,
  hexRgb,
  inkRgbOnCard,
} from "./card-style";
import { GLYPH_H, bitmapTextWidth, forEachBitmapPixel } from "./bitmap-font";
import { ExportError } from "./errors";

export const PNG_CELL_SIZES = [8, 16, 24, 32, 48, 64] as const;
export type PngCellSize = (typeof PNG_CELL_SIZES)[number];

/** 禁止一次性分配超过该边长的像素缓冲；超限时自动缩小格点装进画布。 */
export const MAX_CANVAS_EDGE = 8000;

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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface CardMetrics {
  pad: number;
  headerH: number;
  gap: number;
  cardPad: number;
  cardR: number;
  ruler: number;
  swatchW: number;
  swatchH: number;
  gapX: number;
  itemH: number;
  footerH: number;
}

function metrics(cell: number, showCoords: boolean): CardMetrics {
  const s = clamp(cell / 16, 0.5, 2);
  // 标尺带随格尺寸继续放大（上限 4 倍）：48/64px 超清导出时行列号仍与格子相称。
  const rs = clamp(cell / 16, 0.5, 4);
  return {
    pad: Math.max(8, Math.round(20 * s)),
    headerH: Math.max(26, Math.round(52 * s)),
    gap: Math.max(8, Math.round(16 * s)),
    cardPad: Math.max(6, Math.round(14 * s)),
    cardR: Math.max(4, Math.round(12 * s)),
    ruler: showCoords ? Math.max(12, Math.round(20 * rs)) : 0,
    swatchW: Math.max(36, Math.round(72 * s)),
    swatchH: Math.max(20, Math.round(40 * s)),
    gapX: Math.max(6, Math.round(10 * s)),
    itemH: 0,
    footerH: Math.max(10, Math.round(16 * s)),
  };
}

export function computeLayout(
  pattern: BeadPattern,
  options: PngExportOptions,
  stats: PatternStats,
): { layout: PngLayout; m: CardMetrics; cardX: number; cardY: number; cardW: number; cardH: number; perRow: number; legendRows: number } {
  let cell: number = options.cellSize;
  let result = computeLayoutAt(pattern, options, stats, cell);
  // 超大画布自动缩小格点（与 PDF 单页缩放同理），保底 1px 格。
  for (let guard = 0; guard < 8; guard += 1) {
    const over =
      Math.max(result.layout.width, result.layout.height) > MAX_CANVAS_EDGE;
    if (!over || cell <= 1) break;
    const factor = Math.min(
      MAX_CANVAS_EDGE / result.layout.width,
      MAX_CANVAS_EDGE / result.layout.height,
    );
    cell = Math.max(1, Math.floor(cell * factor));
    result = computeLayoutAt(pattern, options, stats, cell);
  }
  return result;
}

export type CardLayout = {
  layout: PngLayout;
  m: CardMetrics;
  cardX: number;
  cardY: number;
  cardW: number;
  cardH: number;
  perRow: number;
  legendRows: number;
};

export type { CardMetrics };

function computeLayoutAt(
  pattern: BeadPattern,
  options: PngExportOptions,
  stats: PatternStats,
  cell: number,
): CardLayout {
  const m = metrics(cell, options.showCoords);
  const gridW = pattern.width * cell;
  const gridH = pattern.height * cell;
  // 卡片四边都留标尺带：行列号画在上/下/左/右四周（与 PDF 一致）。
  const cardW = gridW + m.ruler * 2 + m.cardPad * 2;
  const cardH = gridH + m.ruler * 2 + m.cardPad * 2;
  const minContentW = Math.max(260, Math.round(500 * clamp(cell / 16, 0.5, 2)));
  const width = Math.max(cardW, minContentW) + m.pad * 2;
  const cardX = Math.round(m.pad + (width - m.pad * 2 - cardW) / 2);
  const cardY = m.pad + m.headerH + m.gap;
  const gridOriginX = Math.round(cardX + m.cardPad + m.ruler);
  const gridOriginY = Math.round(cardY + m.cardPad + m.ruler);

  const used = stats.byColor.filter((row) => row.count > 0).length;
  const perRow = Math.max(
    1,
    Math.floor((width - m.pad * 2 + m.gapX) / (m.swatchW + m.gapX)),
  );
  const legendRows = options.showLegend ? Math.max(1, Math.ceil(used / perRow)) : 0;
  const countLineH = Math.max(9, Math.round(12 * clamp(cell / 16, 0.5, 2)));
  const legendH = legendRows * (m.swatchH + countLineH);
  const height =
    m.pad +
    m.headerH +
    m.gap +
    cardH +
    (legendRows > 0 ? m.gap + legendH : 0) +
    m.gap +
    m.footerH +
    m.pad;

  return {
    layout: {
      width: Math.round(width),
      height: Math.round(height),
      gridOriginX,
      gridOriginY,
      cellSize: cell,
      gutter: m.ruler,
    },
    m: { ...m, itemH: m.swatchH + countLineH },
    cardX,
    cardY,
    cardW,
    cardH,
    perRow,
    legendRows,
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
  rgb: { r: number; g: number; b: number },
): void {
  const x1 = Math.min(width, Math.ceil(x0 + w));
  const y1 = Math.min(height, Math.ceil(y0 + h));
  const xs = Math.max(0, Math.round(x0));
  const ys = Math.max(0, Math.round(y0));
  for (let y = ys; y < y1; y += 1) {
    for (let x = xs; x < x1; x += 1) {
      setPixel(data, width, height, x, y, rgb.r, rgb.g, rgb.b);
    }
  }
}

/** 圆角矩形逐行填充：按行算出圆角内缩，避免逐像素 SDF。 */
function fillRoundedRect(
  data: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  r: number,
  rgb: { r: number; g: number; b: number },
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  const xs = Math.max(0, Math.round(x0));
  const xe = Math.min(width, Math.round(x0 + w));
  const ys = Math.max(0, Math.round(y0));
  const ye = Math.min(height, Math.round(y0 + h));
  const r2 = radius * radius;
  for (let y = ys; y < ye; y += 1) {
    let inset = 0;
    if (y < y0 + radius) {
      const k = y0 + radius - y;
      inset = radius - Math.sqrt(Math.max(0, r2 - k * k));
    } else if (y > y0 + h - radius - 1) {
      const k = y - (y0 + h - radius);
      inset = radius - Math.sqrt(Math.max(0, r2 - k * k));
    }
    const rowStart = Math.max(xs, Math.round(x0 + inset));
    const rowEnd = Math.min(xe, Math.round(x0 + w - inset));
    for (let x = rowStart; x < rowEnd; x += 1) {
      setPixel(data, width, height, x, y, rgb.r, rgb.g, rgb.b);
    }
  }
}

/** 红描边空心标签：外圈描边色 + 内圈父级底色。 */
function drawOutlinePill(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  border: number,
  stroke: { r: number; g: number; b: number },
  face: { r: number; g: number; b: number },
): void {
  fillRoundedRect(data, width, height, x, y, w, h, h / 2, stroke);
  fillRoundedRect(
    data,
    width,
    height,
    x + border,
    y + border,
    w - border * 2,
    h - border * 2,
    Math.max(1, h / 2 - border),
    face,
  );
}

function plotText(
  data: Uint8Array,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  rgb: { r: number; g: number; b: number },
  scale = 1,
): void {
  forEachBitmapPixel(text, x, y, scale, (px, py) => {
    setPixel(data, width, height, px, py, rgb.r, rgb.g, rgb.b);
  });
}

function drawBackground(
  data: Uint8Array,
  layout: PngLayout,
): void {
  const top = hexRgb(CARD_BG_GRADIENT.top);
  const bottom = hexRgb(CARD_BG_GRADIENT.bottom);
  for (let y = 0; y < layout.height; y += 1) {
    const t = layout.height <= 1 ? 0 : y / (layout.height - 1);
    const rgb = {
      r: Math.round(top.r + (bottom.r - top.r) * t),
      g: Math.round(top.g + (bottom.g - top.g) * t),
      b: Math.round(top.b + (bottom.b - top.b) * t),
    };
    fillRect(data, layout.width, layout.height, 0, y, layout.width, 1, rgb);
  }
}

function drawHeader(
  data: Uint8Array,
  layout: PngLayout,
  m: CardMetrics,
  pattern: BeadPattern,
  stats: PatternStats,
): void {
  const soft = hexRgb(INK_SOFT);
  const ink = hexRgb(INK);
  const accent = hexRgb(ACCENT);
  const face = hexRgb(CARD_FACE);
  const x = m.pad;
  const y = m.pad;
  const w = layout.width - m.pad * 2;
  const h = m.headerH;
  fillRoundedRect(data, layout.width, layout.height, x, y, w, h, Math.max(4, m.cardR), face);

  const items = asciiCardHeaderItems(pattern, stats);
  const valueScale = Math.max(2, Math.round(2 * clamp(m.headerH / 52, 0.5, 2)));
  let itemX = x + Math.round(w * 0.03);
  const labelY = y + Math.round(h * 0.16);
  const valueY = y + Math.round(h * 0.42);
  for (const item of items) {
    plotText(data, layout.width, layout.height, item.label, itemX, labelY, soft, 1);
    plotText(data, layout.width, layout.height, item.value, itemX, valueY, ink, valueScale);
    itemX +=
      Math.max(bitmapTextWidth(item.value, valueScale), Math.round(w * 0.06)) +
      Math.round(w * 0.045);
  }

  // 右侧红描边标签（与分享卡片同款）；空间不足时省略。
  const tagText = CARD_TAG_EN;
  const tagTextW = bitmapTextWidth(tagText, 1);
  const tagPadX = Math.round(w * 0.02);
  const tagW = tagTextW + tagPadX * 2;
  const tagH = Math.round(h * 0.46);
  const tagX = x + w - Math.round(w * 0.03) - tagW;
  const tagY = y + Math.round((h - tagH) / 2);
  if (tagX > itemX + m.gap) {
    drawOutlinePill(
      data,
      layout.width,
      layout.height,
      tagX,
      tagY,
      tagW,
      tagH,
      Math.max(1, Math.round(tagH * 0.12)),
      accent,
      face,
    );
    plotText(
      data,
      layout.width,
      layout.height,
      tagText,
      tagX + tagPadX,
      tagY + Math.round((tagH - GLYPH_H) / 2),
      accent,
      1,
    );
  }
}

function drawCardFrame(
  data: Uint8Array,
  layout: PngLayout,
  m: CardMetrics,
  cardX: number,
  cardY: number,
  cardW: number,
  cardH: number,
): void {
  const face = hexRgb(CARD_FACE);
  // 暖灰假投影：向下偏移的圆角矩形垫底。
  const drop = Math.max(2, Math.round(3 * clamp(cardW / 1000, 0.5, 2)));
  fillRoundedRect(
    data,
    layout.width,
    layout.height,
    cardX,
    cardY + drop,
    cardW,
    cardH,
    m.cardR,
    hexRgb(CARD_SHADOW),
  );
  fillRoundedRect(data, layout.width, layout.height, cardX, cardY, cardW, cardH, m.cardR, face);

  // 红色 L 形角标：左上 + 右下（与分享卡片同款）。
  const inset = Math.max(6, Math.round(m.cardPad * 0.9));
  const len = Math.max(14, Math.round(m.cardPad * 1.8));
  const thick = Math.max(3, Math.round(m.cardPad * 0.45));
  const accent = hexRgb(ACCENT);
  fillRect(data, layout.width, layout.height, cardX + inset, cardY + inset, thick, len, accent);
  fillRect(data, layout.width, layout.height, cardX + inset, cardY + inset, len, thick, accent);
  fillRect(
    data,
    layout.width,
    layout.height,
    cardX + cardW - inset - thick,
    cardY + cardH - inset - len,
    thick,
    len,
    accent,
  );
  fillRect(
    data,
    layout.width,
    layout.height,
    cardX + cardW - inset - len,
    cardY + cardH - inset - thick,
    len,
    thick,
    accent,
  );
}

/** 标尺数字字号档位：取「能装进标尺带（留 4px 边距）」的最大档（位图字高 = 7×档位）。 */
export function pickRulerLabelScale(longestLabel: string, ruler: number): number {
  for (const candidate of [4, 3, 2] as const) {
    if (bitmapTextWidth(longestLabel, candidate) <= ruler - 4) return candidate;
  }
  return 1;
}

function drawRulers(
  data: Uint8Array,
  layout: PngLayout,
  m: CardMetrics,
  pattern: BeadPattern,
): void {
  if (m.ruler <= 0) return;
  const soft = hexRgb(INK_SOFT);
  const { gridOriginX, gridOriginY, cellSize } = layout;
  // 数字字号取「能装进标尺带的最大档」：格尺寸越大数字越大，放大看依然清晰。
  const longest = String(Math.max(pattern.width - 1, pattern.height - 1, 1));
  const labelScale = pickRulerLabelScale(longest, m.ruler);
  const glyphH = GLYPH_H * labelScale;
  const gridW = pattern.width * cellSize;
  const gridH = pattern.height * cellSize;
  for (let line = CARD_MAJOR_EVERY; line < pattern.width; line += CARD_MAJOR_EVERY) {
    const label = String(line);
    const tx = Math.round(gridOriginX + line * cellSize - bitmapTextWidth(label, labelScale) / 2);
    plotText(data, layout.width, layout.height, label, tx, Math.round(gridOriginY - m.ruler / 2 - glyphH / 2), soft, labelScale);
    plotText(data, layout.width, layout.height, label, tx, Math.round(gridOriginY + gridH + m.ruler / 2 - glyphH / 2), soft, labelScale);
  }
  for (let line = CARD_MAJOR_EVERY; line < pattern.height; line += CARD_MAJOR_EVERY) {
    const label = String(line);
    const tx = Math.round(gridOriginX - m.ruler / 2 - bitmapTextWidth(label, labelScale) / 2);
    const ty = Math.round(gridOriginY + line * cellSize - glyphH / 2);
    plotText(data, layout.width, layout.height, label, tx, ty, soft, labelScale);
    plotText(
      data,
      layout.width,
      layout.height,
      label,
      Math.round(gridOriginX + gridW + m.ruler / 2 - bitmapTextWidth(label, labelScale) / 2),
      ty,
      soft,
      labelScale,
    );
  }
}

function drawGrid(
  data: Uint8Array,
  layout: PngLayout,
  pattern: BeadPattern,
  options: PngExportOptions,
): void {
  const { gridOriginX, gridOriginY, cellSize } = layout;
  const showCodes = options.showCodes && cellSize >= 16;
  const paletteRgb = pattern.palette.map((color) => hexToRgb(color.hex));
  const empty = hexRgb(EMPTY_CELL_FILL);

  for (let gy = 0; gy < pattern.height; gy += 1) {
    for (let gx = 0; gx < pattern.width; gx += 1) {
      const cell = pattern.cells[gy * pattern.width + gx] ?? EMPTY_CELL;
      const px = gridOriginX + gx * cellSize;
      const py = gridOriginY + gy * cellSize;
      if (cell === EMPTY_CELL) {
        fillRect(data, layout.width, layout.height, px, py, cellSize, cellSize, empty);
        continue;
      }
      const rgb = paletteRgb[cell];
      if (rgb === undefined) {
        throw new ExportError("E_EXPORT", `cell (${gx},${gy}) palette index ${cell} is missing`);
      }
      fillRect(data, layout.width, layout.height, px, py, cellSize, cellSize, rgb);
      if (showCodes) {
        const ink = inkRgbOnCard(pattern.palette[cell]?.hex ?? "#FFFFFF");
        const code = pattern.palette[cell]?.code ?? "";
        // 字号随格尺寸放大（48/64px 超清导出放大看依然清晰）；装不下就降一档。
        let scale = clamp(Math.round(cellSize / 16), 1, 4);
        while (scale > 1 && bitmapTextWidth(code, scale) > cellSize - 2) scale -= 1;
        const tw = bitmapTextWidth(code, scale);
        // 色号宽于格子（±1px 容差）时跳过，避免渗进邻格。
        if (tw <= cellSize + 2) {
          const tx = px + Math.max(1, Math.floor((cellSize - tw) / 2));
          const ty = py + Math.max(1, Math.floor((cellSize - GLYPH_H * scale) / 2));
          plotText(data, layout.width, layout.height, code, tx, ty, ink, scale);
        }
      }
    }
  }

  // 细网格线 + 每 5 格分区粗线（与分享卡片同款；格点过小时省略细线）。
  const gridW = pattern.width * cellSize;
  const gridH = pattern.height * cellSize;
  const thin = GRID_LINE_SOLID;
  const major = GRID_MAJOR_SOLID;
  if (options.showGrid && cellSize >= 6) {
    const majorThick = cellSize >= 16 ? 2 : 1;
    for (let gx = 1; gx < pattern.width; gx += 1) {
      const x = gridOriginX + gx * cellSize;
      const isMajor = gx % CARD_MAJOR_EVERY === 0;
      fillRect(
        data,
        layout.width,
        layout.height,
        x,
        gridOriginY,
        isMajor ? majorThick : 1,
        gridH,
        isMajor ? major : thin,
      );
    }
    for (let gy = 1; gy < pattern.height; gy += 1) {
      const y = gridOriginY + gy * cellSize;
      const isMajor = gy % CARD_MAJOR_EVERY === 0;
      fillRect(
        data,
        layout.width,
        layout.height,
        gridOriginX,
        y,
        gridW,
        isMajor ? majorThick : 1,
        isMajor ? major : thin,
      );
    }
  }
}

function drawLegend(
  data: Uint8Array,
  layout: PngLayout,
  m: CardMetrics,
  stats: PatternStats,
  cardBottom: number,
  legendRows: number,
  perRow: number,
): void {
  if (legendRows <= 0) return;
  const used = stats.byColor.filter((row) => row.count > 0);
  used.sort((a, b) => b.count - a.count);
  const faded = hexRgb(INK_FADED);
  const inkStrong = hexRgb(INK);
  const top = cardBottom + m.gap;

  used.forEach((row, index) => {
    const col = index % perRow;
    const lineRow = Math.floor(index / perRow);
    const px = m.pad + col * (m.swatchW + m.gapX);
    const py = top + lineRow * m.itemH;
    const rgb = hexToRgb(row.hex);
    fillRoundedRect(
      data,
      layout.width,
      layout.height,
      px,
      py,
      m.swatchW,
      m.swatchH,
      Math.max(3, Math.round(m.swatchH * 0.28)),
      rgb,
    );
    // 亮底深字、暗底浅字；色号过宽时画在色块右侧，保证浅色块可读。
    const ink = inkRgbOnCard(row.hex);
    const codeW = bitmapTextWidth(row.code, 1);
    if (codeW <= m.swatchW - 6) {
      plotText(
        data,
        layout.width,
        layout.height,
        row.code,
        Math.round(px + (m.swatchW - codeW) / 2),
        Math.round(py + (m.swatchH - 7) / 2),
        ink,
        1,
      );
    } else {
      plotText(
        data,
        layout.width,
        layout.height,
        row.code,
        px + m.swatchW + 4,
        Math.round(py + (m.swatchH - 7) / 2),
        inkStrong,
        1,
      );
    }
    const countLabel = String(row.count);
    const cw = bitmapTextWidth(countLabel, 1);
    plotText(
      data,
      layout.width,
      layout.height,
      countLabel,
      Math.round(px + (m.swatchW - cw) / 2),
      py + m.swatchH + 2,
      faded,
      1,
    );
  });
}

function drawFooter(
  data: Uint8Array,
  layout: PngLayout,
  m: CardMetrics,
): void {
  const faded = hexRgb(INK_FADED);
  plotText(
    data,
    layout.width,
    layout.height,
    CARD_FOOTER_EN,
    m.pad,
    layout.height - m.pad - m.footerH,
    faded,
    1,
  );
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
  const stats = assertExportReady(pattern);
  const { layout, m, cardX, cardY, cardW, cardH, perRow, legendRows } = computeLayout(
    pattern,
    options,
    stats,
  );
  const data = new Uint8Array(layout.width * layout.height * 4);

  drawBackground(data, layout);
  drawHeader(data, layout, m, pattern, stats);
  drawCardFrame(data, layout, m, cardX, cardY, cardW, cardH);
  drawRulers(data, layout, m, pattern);
  drawGrid(data, layout, pattern, options);
  drawLegend(data, layout, m, stats, cardY + cardH, legendRows, perRow);
  drawFooter(data, layout, m);

  return { layout, data };
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
