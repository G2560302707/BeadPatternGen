/**
 * 图纸 SVG 矢量导出：与图纸 PNG（png.ts）共用同一套「宣传卡片」版式与布局
 * 计算（computeLayout + card-style 令牌），只是把像素绘图换成 SVG 图元——
 * rect / line / text 全部矢量描述，任意缩放不失真，适合印刷、大屏查看或
 * 再加工。颜色同样只来自 pattern.palette，不二次量化。
 *
 * 相比 PNG 位图字体（仅 ASCII），SVG 直接用系统字体：页眉与脚注走中文文案，
 * 格内色号与行列号走等宽字体。相邻同色格按行合并成一个 rect，控制文件体积。
 */

import { EMPTY_CELL } from "../core/pattern";
import type { BeadPattern, PatternStats } from "../core/pattern";
import { computeLayout, pickRulerLabelScale, PNG_CELL_SIZES } from "./png";
import type { PngExportOptions } from "./png";
import { assertExportReady } from "./assert";
import {
  ACCENT,
  CARD_BG_GRADIENT,
  CARD_FACE,
  CARD_FOOTER_ZH,
  CARD_MAJOR_EVERY,
  CARD_SHADOW,
  CARD_TAG_ZH,
  EMPTY_CELL_FILL,
  GRID_LINE_SOLID,
  GRID_MAJOR_SOLID,
  INK,
  INK_FADED,
  INK_SOFT,
  cardHeaderItems,
  hexRgb,
  inkRgbOnCard,
  type Rgb,
} from "./card-style";
import { ExportError } from "./errors";

const MONO_FONT = "ui-monospace, Consolas, 'Courier New', monospace";
const SANS_FONT = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";

const DEFAULT_OPTIONS: PngExportOptions = {
  cellSize: 16,
  showGrid: true,
  showCoords: true,
  showCodes: true,
  showLegend: true,
};

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 坐标统一保留 ≤2 位小数，避免二进制浮点尾巴。 */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function rgbHex(color: Rgb): string {
  return `#${[color.r, color.g, color.b]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** 估宽：CJK 按一个字宽，ASCII 按等宽字体约 0.6 字宽。 */
function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) width += ch.charCodeAt(0) > 0x2e80 ? fontSize : fontSize * 0.62;
  return width;
}

function textEl(
  x: number,
  y: number,
  content: string,
  fontSize: number,
  fill: string,
  options: { anchor?: "middle" | "start" | "end"; weight?: string; family?: string } = {},
): string {
  const anchor = options.anchor ? ` text-anchor="${options.anchor}"` : "";
  const weight = options.weight ? ` font-weight="${options.weight}"` : "";
  const family = options.family ?? MONO_FONT;
  return `<text x="${num(x)}" y="${num(y)}" font-family="${esc(family)}" font-size="${num(fontSize)}"${weight} fill="${fill}"${anchor}>${esc(content)}</text>`;
}

/** 每行把相邻同色格合并成一个 rect（空格也算一种颜色），控制大图的节点数。 */
function drawCellRuns(pattern: BeadPattern, layout: { gridOriginX: number; gridOriginY: number; cellSize: number }): string {
  const paletteRgb = pattern.palette.map((color) => rgbHex(hexRgb(color.hex)));
  const empty = rgbHex(hexRgb(EMPTY_CELL_FILL));
  const parts: string[] = [];
  for (let gy = 0; gy < pattern.height; gy += 1) {
    let runStart = 0;
    let runFill: string | null = null;
    const flush = (endX: number) => {
      if (runFill === null) return;
      const x = layout.gridOriginX + runStart * layout.cellSize;
      const width = (endX - runStart) * layout.cellSize;
      parts.push(
        `<rect x="${num(x)}" y="${num(layout.gridOriginY + gy * layout.cellSize)}" width="${num(width)}" height="${num(layout.cellSize)}" fill="${runFill}"/>`,
      );
    };
    for (let gx = 0; gx < pattern.width; gx += 1) {
      const cell = pattern.cells[gy * pattern.width + gx] ?? EMPTY_CELL;
      let fill: string;
      if (cell === EMPTY_CELL) {
        fill = empty;
      } else {
        const hex = paletteRgb[cell];
        if (hex === undefined) {
          throw new ExportError("E_EXPORT", `svg cell (${gx},${gy}) palette index ${cell} is missing`);
        }
        fill = hex;
      }
      if (fill === runFill) continue;
      flush(gx);
      runStart = gx;
      runFill = fill;
    }
    flush(pattern.width);
  }
  return parts.join("\n");
}

function drawCodeTexts(pattern: BeadPattern, layout: { gridOriginX: number; gridOriginY: number; cellSize: number }): string {
  const parts: string[] = [];
  const cell = layout.cellSize;
  for (let gy = 0; gy < pattern.height; gy += 1) {
    for (let gx = 0; gx < pattern.width; gx += 1) {
      const index = pattern.cells[gy * pattern.width + gx] ?? EMPTY_CELL;
      if (index === EMPTY_CELL) continue;
      const color = pattern.palette[index];
      if (color === undefined) continue;
      const chars = Math.max(1, [...color.code].length);
      let fontSize = Math.round(cell * 0.42);
      if (fontSize * 0.62 * chars > cell - 2) {
        fontSize = Math.max(5, Math.floor((cell - 2) / (0.62 * chars)));
      }
      parts.push(
        textEl(
          layout.gridOriginX + gx * cell + cell / 2,
          layout.gridOriginY + gy * cell + cell / 2 + fontSize * 0.35,
          color.code,
          fontSize,
          rgbHex(inkRgbOnCard(color.hex)),
          { anchor: "middle" },
        ),
      );
    }
  }
  return parts.join("\n");
}

function drawGridLines(pattern: BeadPattern, layout: { gridOriginX: number; gridOriginY: number; cellSize: number }): string {
  const { gridOriginX, gridOriginY, cellSize } = layout;
  const gridW = pattern.width * cellSize;
  const gridH = pattern.height * cellSize;
  const parts: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, width: number) =>
    parts.push(
      `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${stroke}" stroke-width="${num(width)}"/>`,
    );
  const thin = rgbHex(GRID_LINE_SOLID);
  const major = rgbHex(GRID_MAJOR_SOLID);
  for (let gx = 1; gx < pattern.width; gx += 1) {
    if (gx % CARD_MAJOR_EVERY === 0) continue;
    const x = gridOriginX + gx * cellSize;
    line(x, gridOriginY, x, gridOriginY + gridH, thin, 1);
  }
  for (let gy = 1; gy < pattern.height; gy += 1) {
    if (gy % CARD_MAJOR_EVERY === 0) continue;
    const y = gridOriginY + gy * cellSize;
    line(gridOriginX, y, gridOriginX + gridW, y, thin, 1);
  }
  const majorThick = cellSize >= 16 ? 2 : 1;
  for (let gx = CARD_MAJOR_EVERY; gx < pattern.width; gx += CARD_MAJOR_EVERY) {
    const x = gridOriginX + gx * cellSize;
    line(x, gridOriginY, x, gridOriginY + gridH, major, majorThick);
  }
  for (let gy = CARD_MAJOR_EVERY; gy < pattern.height; gy += CARD_MAJOR_EVERY) {
    const y = gridOriginY + gy * cellSize;
    line(gridOriginX, y, gridOriginX + gridW, y, major, majorThick);
  }
  return parts.join("\n");
}

/** 上/下/左/右四边行列号（每 5 格），与图纸 PNG / PDF 一致。 */
function drawRulers(
  pattern: BeadPattern,
  layout: { gridOriginX: number; gridOriginY: number; cellSize: number },
  ruler: number,
): string {
  if (ruler <= 0) return "";
  const soft = rgbHex(hexRgb(INK_SOFT));
  const { gridOriginX, gridOriginY, cellSize } = layout;
  const longest = String(Math.max(pattern.width - 1, pattern.height - 1, 1));
  const scale = pickRulerLabelScale(longest, ruler);
  const fontSize = 7 * scale;
  const gridW = pattern.width * cellSize;
  const gridH = pattern.height * cellSize;
  const parts: string[] = [];
  for (let line = CARD_MAJOR_EVERY; line < pattern.width; line += CARD_MAJOR_EVERY) {
    const x = gridOriginX + line * cellSize;
    parts.push(textEl(x, gridOriginY - ruler / 2 + fontSize * 0.35, String(line), fontSize, soft, { anchor: "middle" }));
    parts.push(textEl(x, gridOriginY + gridH + ruler / 2 + fontSize * 0.35, String(line), fontSize, soft, { anchor: "middle" }));
  }
  for (let line = CARD_MAJOR_EVERY; line < pattern.height; line += CARD_MAJOR_EVERY) {
    const y = gridOriginY + line * cellSize + fontSize * 0.35;
    parts.push(textEl(gridOriginX - ruler / 2, y, String(line), fontSize, soft, { anchor: "middle" }));
    parts.push(textEl(gridOriginX + gridW + ruler / 2, y, String(line), fontSize, soft, { anchor: "middle" }));
  }
  return parts.join("\n");
}

function drawHeader(
  pattern: BeadPattern,
  stats: PatternStats,
  bounds: { x: number; y: number; w: number; h: number; r: number },
): string {
  const parts: string[] = [];
  const ink = rgbHex(hexRgb(INK));
  const soft = rgbHex(hexRgb(INK_SOFT));
  const accent = rgbHex(hexRgb(ACCENT));
  const { x, y, w, h } = bounds;
  parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(bounds.r)}" fill="${CARD_FACE}"/>`);

  const labelSize = Math.max(9, Math.round(h * 0.15));
  const valueSize = Math.max(13, Math.round(h * 0.28));
  let itemX = x + w * 0.03;
  for (const item of cardHeaderItems(pattern, stats)) {
    parts.push(textEl(itemX, y + h * 0.3, item.label, labelSize, soft, { family: SANS_FONT }));
    parts.push(textEl(itemX, y + h * 0.72, item.value, valueSize, ink, { weight: "700", family: SANS_FONT }));
    itemX += Math.max(estimateTextWidth(item.value, valueSize), w * 0.06) + w * 0.045;
  }

  // 右侧红描边标签「拼豆图纸分享」；空间不足时省略（与位图版一致）。
  const tagSize = Math.max(10, Math.round(h * 0.24));
  const tagTextW = estimateTextWidth(CARD_TAG_ZH, tagSize);
  const tagW = tagTextW + w * 0.04;
  const tagH = Math.round(h * 0.46);
  const tagX = x + w - w * 0.03 - tagW;
  const tagY = y + (h - tagH) / 2;
  if (tagX > itemX + 12) {
    parts.push(
      `<rect x="${num(tagX)}" y="${num(tagY)}" width="${num(tagW)}" height="${num(tagH)}" rx="${num(tagH / 2)}" fill="none" stroke="${accent}" stroke-width="2"/>`,
    );
    parts.push(
      textEl(tagX + tagW / 2, tagY + tagH / 2 + tagSize * 0.35, CARD_TAG_ZH, tagSize, accent, {
        anchor: "middle",
        weight: "600",
        family: SANS_FONT,
      }),
    );
  }
  return parts.join("\n");
}

function drawCardFrame(
  bounds: { x: number; y: number; w: number; h: number; r: number; pad: number },
): string {
  const parts: string[] = [];
  const drop = Math.max(2, Math.round(bounds.w * 0.004));
  parts.push(
    `<rect x="${num(bounds.x)}" y="${num(bounds.y + drop)}" width="${num(bounds.w)}" height="${num(bounds.h)}" rx="${num(bounds.r)}" fill="${rgbHex(hexRgb(CARD_SHADOW))}"/>`,
  );
  parts.push(
    `<rect x="${num(bounds.x)}" y="${num(bounds.y)}" width="${num(bounds.w)}" height="${num(bounds.h)}" rx="${num(bounds.r)}" fill="${CARD_FACE}"/>`,
  );
  // 红色 L 形角标：左上 + 右下（与分享卡片同款）。
  const inset = Math.max(6, Math.round(bounds.pad * 0.9));
  const len = Math.max(14, Math.round(bounds.pad * 1.8));
  const thick = Math.max(3, Math.round(bounds.pad * 0.45));
  const accent = rgbHex(hexRgb(ACCENT));
  parts.push(`<rect x="${num(bounds.x + inset)}" y="${num(bounds.y + inset)}" width="${num(thick)}" height="${num(len)}" fill="${accent}"/>`);
  parts.push(`<rect x="${num(bounds.x + inset)}" y="${num(bounds.y + inset)}" width="${num(len)}" height="${num(thick)}" fill="${accent}"/>`);
  parts.push(`<rect x="${num(bounds.x + bounds.w - inset - thick)}" y="${num(bounds.y + bounds.h - inset - len)}" width="${num(thick)}" height="${num(len)}" fill="${accent}"/>`);
  parts.push(`<rect x="${num(bounds.x + bounds.w - inset - len)}" y="${num(bounds.y + bounds.h - inset - thick)}" width="${num(len)}" height="${num(thick)}" fill="${accent}"/>`);
  return parts.join("\n");
}

function drawLegend(
  stats: PatternStats,
  m: { pad: number; swatchW: number; swatchH: number; gapX: number; itemH: number },
  top: number,
  perRow: number,
  legendRows: number,
): string {
  if (legendRows <= 0) return "";
  const used = stats.byColor.filter((row) => row.count > 0);
  used.sort((a, b) => b.count - a.count);
  const ink = rgbHex(hexRgb(INK));
  const faded = rgbHex(hexRgb(INK_FADED));
  const codeSize = Math.max(10, Math.round(m.swatchH * 0.35));
  const countSize = Math.max(8, Math.round(m.swatchH * 0.25));
  const parts: string[] = [];
  used.forEach((row, index) => {
    const col = index % perRow;
    const lineRow = Math.floor(index / perRow);
    const px = m.pad + col * (m.swatchW + m.gapX);
    const py = top + lineRow * m.itemH;
    parts.push(
      `<rect x="${num(px)}" y="${num(py)}" width="${num(m.swatchW)}" height="${num(m.swatchH)}" rx="${num(Math.max(3, Math.round(m.swatchH * 0.28)))}" fill="${row.hex}"/>`,
    );
    // 亮底深字、暗底浅字；色号过宽时画在色块右侧，保证浅色块可读。
    const inkHex = rgbHex(inkRgbOnCard(row.hex));
    if (estimateTextWidth(row.code, codeSize) <= m.swatchW - 6) {
      parts.push(
        textEl(px + m.swatchW / 2, py + m.swatchH / 2 + codeSize * 0.35, row.code, codeSize, inkHex, {
          anchor: "middle",
          weight: "700",
        }),
      );
    } else {
      parts.push(
        textEl(px + m.swatchW + 4, py + m.swatchH / 2 + codeSize * 0.35, row.code, codeSize, ink, {
          weight: "700",
        }),
      );
    }
    parts.push(
      textEl(px + m.swatchW / 2, py + m.swatchH + countSize + 3, String(row.count), countSize, faded, {
        anchor: "middle",
      }),
    );
  });
  return parts.join("\n");
}

/**
 * 渲染矢量图纸（XML 字符串）。布局与 exportPng 完全同源：
 * 相同的 cellSize 参数产出相同的卡片结构，只是图元可无限缩放。
 */
export function exportSvg(pattern: BeadPattern, options: PngExportOptions = DEFAULT_OPTIONS): string {
  if (!PNG_CELL_SIZES.includes(options.cellSize)) {
    throw new ExportError(
      "E_INVALID_OPTION",
      `cellSize must be 8/16/24/32/48/64; got ${String(options.cellSize)}`,
    );
  }
  const stats = assertExportReady(pattern);
  const { m, layout, cardX, cardY, cardW, cardH, perRow, legendRows } = computeLayout(
    pattern,
    options,
    stats,
  );

  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(layout.width)}" height="${num(layout.height)}" viewBox="0 0 ${num(layout.width)} ${num(layout.height)}">`,
  );
  parts.push(
    `<defs><linearGradient id="pindou-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${CARD_BG_GRADIENT.top}"/><stop offset="1" stop-color="${CARD_BG_GRADIENT.bottom}"/></linearGradient></defs>`,
  );
  parts.push(`<rect width="${num(layout.width)}" height="${num(layout.height)}" fill="url(#pindou-bg)"/>`);
  parts.push(drawHeader(pattern, stats, { x: m.pad, y: m.pad, w: layout.width - m.pad * 2, h: m.headerH, r: Math.max(4, m.cardR) }));
  parts.push(drawCardFrame({ x: cardX, y: cardY, w: cardW, h: cardH, r: m.cardR, pad: m.cardPad }));
  parts.push(drawRulers(pattern, layout, m.ruler));
  const gridBounds = { gridOriginX: layout.gridOriginX, gridOriginY: layout.gridOriginY, cellSize: layout.cellSize };
  parts.push(`<g shape-rendering="crispEdges">`);
  parts.push(drawCellRuns(pattern, gridBounds));
  if (options.showGrid && layout.cellSize >= 6) parts.push(drawGridLines(pattern, gridBounds));
  parts.push(`</g>`);
  if (options.showCodes && layout.cellSize >= 16) parts.push(drawCodeTexts(pattern, gridBounds));
  parts.push(drawLegend(stats, m, cardY + cardH + m.gap, perRow, legendRows));
  parts.push(
    textEl(
      m.pad,
      layout.height - m.pad - m.footerH + Math.max(10, Math.round(m.footerH * 0.8)),
      CARD_FOOTER_ZH,
      Math.max(10, Math.round(m.footerH * 0.8)),
      rgbHex(hexRgb(INK_FADED)),
      { family: SANS_FONT },
    ),
  );
  parts.push(`</svg>`);
  return parts.join("\n");
}
