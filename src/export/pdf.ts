/**
 * 分页 PDF（宣传卡片版式）。制作版切片只调用 S12 computePages()，不自己算页矩阵；
 * 细条分页通过 balancedCapacity 调整传入容量，不改 paginate 内核。
 *
 * 视觉与分享图纸卡片统一（card-style 令牌）：暖粉纸底、页眉信息栏（红描边标签）、
 * 白色圆角图纸卡 + 红 L 角标、每 5 格分区线、卡片式色表页。中文文案走内嵌子集字体
 * public/fonts/pindou-zh-subset.ttf；字体加载失败（Node 测试环境等）自动回退
 * Helvetica + 英文文案，页数与网格几何完全不变。
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { hexToRgb } from "../core/color";
import { computePages } from "../core/export/geometry/paginate";
import type { PageSlice } from "../core/export/geometry/types";
import { EMPTY_CELL } from "../core/pattern";
import type { BeadPattern, PatternStats } from "../core/pattern";
import { inkOnHex } from "../render/chart-style";
import {
  ACCENT,
  CARD_BG_GRADIENT,
  CARD_FACE,
  CARD_FOOTER_ZH,
  CARD_MAJOR_EVERY,
  CARD_TAG_ZH,
  EMPTY_CELL_FILL,
  GRID_LINE_SOLID,
  GRID_MAJOR_SOLID,
  INK,
  INK_FADED,
  INK_SOFT,
  PDF_CJK_CHARSET,
  cardHeaderItems,
} from "./card-style";
import { assertExportReady } from "./assert";
import { DEFAULT_CELL_PT, MIN_CELL_PT, PAGE_WARN_COUNT, balancedCapacity } from "./capacity";
import { ExportError } from "./errors";

export type PaperSizeName = "a4" | "a3" | "letter";
export type PdfMode = "preview" | "make";

export interface PdfExportOptions {
  paper: PaperSizeName;
  mode: PdfMode;
  overlap: number;
  showCodes: boolean;
  /** 制作版超出整档格点容量时，改用小数格点把整图缩放进单页，不再切片分页。 */
  fitSinglePage?: boolean;
  /** 是否追加色表页（独立分页，不影响图纸本体）。 */
  includeLegend?: boolean;
}

export interface PdfExportResult {
  bytes: Uint8Array;
  patternPageCount: number;
  legendPageCount: number;
  cellsDrawnPerPage: number[];
  slices: PageSlice[];
  cellPt: number;
  colPages: number;
  rowPages: number;
}

export interface MakeLayout {
  cellPt: number;
  maxCols: number;
  maxRows: number;
  slices: PageSlice[];
  colPages: number;
  rowPages: number;
}

const PAPER_PT: Record<PaperSizeName, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  a3: { width: 841.89, height: 1190.55 },
  letter: { width: 612, height: 792 },
};

const MARGIN = 36;
const HEADER = 52;
const RULER = 16;
/** 圆角图纸卡四周相对「网格 + 标尺」的外扩。 */
const CARD_PAD = 10;

/** 中文字体子集（与分享卡片同源文案）；加载失败时所有文案回退英文。 */
const ZH_FONT_URL = "/fonts/pindou-zh-subset.ttf";
let zhFontBytesPromise: Promise<Uint8Array | null> | null = null;

function loadZhFontBytes(): Promise<Uint8Array | null> {
  if (!zhFontBytesPromise) {
    zhFontBytesPromise = (async () => {
      try {
        const response = await fetch(ZH_FONT_URL);
        if (!response.ok) return null;
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        return null;
      }
    })();
  }
  return zhFontBytesPromise;
}

function hexRgb(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return rgb(r / 255, g / 255, b / 255);
}

/** card-style 里已是 {r,g,b} 的实色（如网格线预混合色）转 pdf-lib 颜色。 */
function solidRgb(color: { r: number; g: number; b: number }) {
  return rgb(color.r / 255, color.g / 255, color.b / 255);
}

export function pdfPageCapacity(
  paper: PaperSizeName,
  cellPt: number = DEFAULT_CELL_PT,
  withRuler = true,
): { maxCols: number; maxRows: number } {
  const size = PAPER_PT[paper];
  const ruler = withRuler ? RULER * 2 : 0;
  const usableW = size.width - MARGIN * 2 - ruler;
  const usableH = size.height - MARGIN * 2 - HEADER - ruler;
  return {
    maxCols: Math.max(3, Math.floor(usableW / cellPt)),
    maxRows: Math.max(3, Math.floor(usableH / cellPt)),
  };
}

export function planMakeLayout(
  width: number,
  height: number,
  paper: PaperSizeName,
  overlap: number,
  fitSinglePage = true,
): MakeLayout {
  let cellPt = DEFAULT_CELL_PT;
  let fitsInteger = false;
  for (let tryPt = DEFAULT_CELL_PT; tryPt >= MIN_CELL_PT; tryPt -= 1) {
    const cap = pdfPageCapacity(paper, tryPt, true);
    if (width <= cap.maxCols && height <= cap.maxRows) {
      cellPt = tryPt;
      fitsInteger = true;
      break;
    }
  }

  // 整档格点装不下：单页模式用小数格点缩放整图（PDF 是矢量，缩放不失真），
  // 保留标尺 / 每 5 格分区线；色号与标尺数字在格点过小时自动降级省略。
  if (!fitsInteger && fitSinglePage) {
    const size = PAPER_PT[paper];
    const usableW = size.width - MARGIN * 2 - RULER * 2 - CARD_PAD;
    const usableH = size.height - MARGIN * 2 - HEADER - RULER * 2 - CARD_PAD;
    const fitPt = Math.min(usableW / Math.max(1, width), usableH / Math.max(1, height));
    const full: PageSlice = {
      page: 1,
      row: 0,
      col: 0,
      x0: 0,
      y0: 0,
      cols: width,
      rows: height,
      overlapRight: 0,
      overlapBottom: 0,
      isLastCol: true,
      isLastRow: true,
    };
    return { cellPt: fitPt, maxCols: width, maxRows: height, slices: [full], colPages: 1, rowPages: 1 };
  }

  const cap = pdfPageCapacity(paper, cellPt, true);
  const maxCols = balancedCapacity(width, cap.maxCols, overlap);
  const maxRows = balancedCapacity(height, cap.maxRows, overlap);
  const slices = computePages({
    width,
    height,
    maxColsPerPage: maxCols,
    maxRowsPerPage: maxRows,
    overlap,
  });
  const colPages = Math.max(...slices.map((slice) => slice.col)) + 1;
  const rowPages = Math.max(...slices.map((slice) => slice.row)) + 1;
  return { cellPt, maxCols, maxRows, slices, colPages, rowPages };
}

/** 双语文案：有中文字体用中文，否则回退 ASCII 英文。 */
interface TextSkin {
  zh: PDFFont | null;
  latin: PDFFont;
}

function isCjk(ch: string): boolean {
  return /[\u4e00-\u9fff]/.test(ch);
}

/** 中文字体是固定字符集子集：超集外的汉字直接剔除，避免豆腐块。 */
function sanitizeZh(text: string): string {
  return [...text].filter((ch) => !isCjk(ch) || PDF_CJK_CHARSET.includes(ch)).join("");
}

function pickText(skin: TextSkin, zhText: string, enText: string): string {
  return skin.zh ? sanitizeZh(zhText) : enText;
}

/** 无中文字体时把值里的中文剔除（「18 色」→「18」），保证 Helvetica 可编码。 */
function displayValue(skin: TextSkin, text: string): string {
  if (skin.zh) return sanitizeZh(text);
  return [...text]
    .filter((ch) => !isCjk(ch) && ch !== "·" && ch !== "×")
    .join("")
    .trim()
    .replace(/\s+/g, " ");
}

/** 信息栏标签的英文回退（与图纸 PNG 的 ASCII 位图文案一致）。 */
const LABEL_EN: Record<string, string> = {
  规格: "SIZE",
  色板: "PALETTE",
  色数: "COLORS",
  用豆: "BEADS",
  色卡清单: "COLOR LIST",
};

function displayLabel(skin: TextSkin, label: string): string {
  return skin.zh ? sanitizeZh(label) : (LABEL_EN[label] ?? label);
}

function textFont(skin: TextSkin, text: string): PDFFont {
  return skin.zh && [...text].some(isCjk) ? skin.zh : skin.latin;
}

function measure(skin: TextSkin, text: string, size: number): number {
  return textFont(skin, text).widthOfTextAtSize(text, size);
}

interface BandTextOptions {
  zh: string;
  en: string;
  x: number;
  y: number;
  size: number;
  color: ReturnType<typeof rgb>;
  align?: "left" | "center" | "right";
}

function drawBandText(page: PDFPage, skin: TextSkin, options: BandTextOptions): number {
  const text = pickText(skin, options.zh, options.en);
  const font = textFont(skin, text);
  let x = options.x;
  if (options.align === "center") x -= font.widthOfTextAtSize(text, options.size) / 2;
  if (options.align === "right") x -= font.widthOfTextAtSize(text, options.size);
  page.drawText(text, { x, y: options.y, size: options.size, font, color: options.color });
  return font.widthOfTextAtSize(text, options.size);
}

function roundedRectPath(w: number, h: number, r: number): string {
  const c = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    `M ${c} 0`,
    `L ${w - c} 0`,
    `Q ${w} 0 ${w} ${c}`,
    `L ${w} ${h - c}`,
    `Q ${w} ${h} ${w - c} ${h}`,
    `L ${c} ${h}`,
    `Q 0 ${h} 0 ${h - c}`,
    `L 0 ${c}`,
    `Q 0 0 ${c} 0`,
    "Z",
  ].join(" ");
}

interface RoundedRectOptions {
  x: number;
  /** 卡片顶边的 PDF 纵坐标（drawSvgPath 以左上角定位、路径内 y 向下）。 */
  yTop: number;
  w: number;
  h: number;
  r: number;
  fill?: ReturnType<typeof rgb>;
  stroke?: ReturnType<typeof rgb>;
  strokeWidth?: number;
}

function drawRoundedRect(page: PDFPage, options: RoundedRectOptions): void {
  const drawOptions: Parameters<PDFPage["drawSvgPath"]>[1] = {
    x: options.x,
    y: options.yTop,
  };
  if (options.fill !== undefined) drawOptions.color = options.fill;
  if (options.stroke !== undefined) {
    drawOptions.borderColor = options.stroke;
    drawOptions.borderWidth = options.strokeWidth ?? 1;
  }
  page.drawSvgPath(roundedRectPath(options.w, options.h, options.r), drawOptions);
}

/** 页面暖粉底：满页平涂渐变顶端色，打印友好。 */
function drawPageBackground(page: PDFPage, width: number, height: number): void {
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: hexRgb(CARD_BG_GRADIENT.top),
  });
}

function drawFooterNote(page: PDFPage, skin: TextSkin): void {
  drawBandText(page, skin, {
    zh: CARD_FOOTER_ZH,
    en: "* Codes and counts are for reference only",
    x: MARGIN,
    y: 16,
    size: 7,
    color: hexRgb(INK_FADED),
  });
}

/** 红描边胶囊标签（与分享卡片右上角同款）。 */
function drawTagPill(
  page: PDFPage,
  skin: TextSkin,
  xRight: number,
  centerY: number,
): number {
  const text = pickText(skin, CARD_TAG_ZH, "BEAD CHART");
  const size = 8;
  const font = textFont(skin, text);
  const textW = font.widthOfTextAtSize(text, size);
  const padX = 9;
  const w = textW + padX * 2;
  const h = 18;
  drawRoundedRect(page, {
    x: xRight - w,
    yTop: centerY + h / 2,
    w,
    h,
    r: h / 2,
    stroke: hexRgb(ACCENT),
    strokeWidth: 1.2,
  });
  page.drawText(text, {
    x: xRight - w + padX,
    y: centerY - size * 0.36,
    size,
    font,
    color: hexRgb(ACCENT),
  });
  return w;
}

/** 页眉信息栏：白色圆角横条；items 版（规格/色板/色数/用豆）与分享卡片同构。 */
function drawInfoBand(
  page: PDFPage,
  skin: TextSkin,
  pageWidth: number,
  pageHeight: number,
  items: Array<{ label: string; value: string }>,
): void {
  const bandH = 44;
  // PDF 的 y 轴向上：页面顶部 = pageHeight，栏顶距页顶 24pt。
  const yTop = pageHeight - 24;
  const x = MARGIN;
  const w = pageWidth - MARGIN * 2;
  drawRoundedRect(page, { x, yTop, w, h: bandH, r: 10, fill: hexRgb(CARD_FACE) });

  const rightEdge = x + w - 12;
  const tagW = drawTagPill(page, skin, rightEdge, yTop - bandH / 2);
  let cursor = x + 14;
  const limit = rightEdge - tagW - 14;
  for (const item of items) {
    const value = displayValue(skin, item.value);
    const valueW = measure(skin, value, 11);
    if (cursor + Math.max(valueW, 34) > limit) break;
    const label = displayLabel(skin, item.label);
    page.drawText(label, {
      x: cursor,
      y: yTop - 15,
      size: 6.5,
      font: textFont(skin, label),
      color: hexRgb(INK_SOFT),
    });
    page.drawText(value, {
      x: cursor,
      y: yTop - 33,
      size: 11,
      font: textFont(skin, value),
      color: hexRgb(INK),
    });
    cursor += Math.max(valueW, 34) + 24;
  }
}

/** 制作版页眉：标题 + 页码/切片信息一行，右侧规格摘要。 */
function drawMakeBand(
  page: PDFPage,
  skin: TextSkin,
  pageWidth: number,
  pageHeight: number,
  pattern: BeadPattern,
  stats: PatternStats,
  line: { zh: string; en: string },
): void {
  const bandH = 38;
  const yTop = pageHeight - 24;
  const x = MARGIN;
  const w = pageWidth - MARGIN * 2;
  drawRoundedRect(page, { x, yTop, w, h: bandH, r: 10, fill: hexRgb(CARD_FACE) });

  const asciiTitle = [...(pattern.title || "")]
    .map((ch) => (/^[A-Za-z0-9 ._\-x/()]/.test(ch) ? ch : ""))
    .join("")
    .trim();
  const title = pickText(skin, pattern.title || "拼豆图纸", asciiTitle || "Bead Pattern");
  const titleFont = textFont(skin, title);
  page.drawText(title, { x: x + 14, y: yTop - 16, size: 10.5, font: titleFont, color: hexRgb(INK) });
  drawBandText(page, skin, {
    ...line,
    x: x + 14,
    y: yTop - 30,
    size: 7.5,
    color: hexRgb(INK_SOFT),
  });

  const rightEdge = x + w - 12;
  const tagW = drawTagPill(page, skin, rightEdge, yTop - bandH / 2);
  drawBandText(page, skin, {
    zh: `规格 ${pattern.width}×${pattern.height} · 色数 ${stats.colorCount} · 用豆 ${stats.beadCount.toLocaleString("en-US")}`,
    en: `${pattern.width}x${pattern.height} · ${stats.colorCount} colors · ${stats.beadCount.toLocaleString("en-US")} beads`,
    x: rightEdge - tagW - 14,
    y: yTop - 23,
    size: 7.5,
    color: hexRgb(INK_SOFT),
    align: "right",
  });
}

function drawJoinMarks(
  page: PDFPage,
  slice: PageSlice,
  originX: number,
  originY: number,
  cell: number,
): void {
  const mark = hexRgb(ACCENT);
  if (!slice.isLastCol && slice.overlapRight > 0) {
    const x = originX + (slice.cols - slice.overlapRight) * cell;
    page.drawRectangle({
      x,
      y: originY,
      width: 1.2,
      height: slice.rows * cell,
      color: mark,
    });
  }
  if (!slice.isLastRow && slice.overlapBottom > 0) {
    const y = originY + slice.overlapBottom * cell;
    page.drawRectangle({
      x: originX,
      y,
      width: slice.cols * cell,
      height: 1.2,
      color: mark,
    });
  }
}

/** 白色圆角图纸卡 + 红 L 角标（左上 + 右下，与分享卡片同款）。 */
function drawCardFrame(
  page: PDFPage,
  originX: number,
  originYTop: number,
  gridW: number,
  gridH: number,
): void {
  // 上下留出标尺数字的高度，左右留出标尺列，保证数字全部落在卡片内。
  const x = originX - RULER - 8;
  const yTop = originYTop + 14;
  const w = gridW + RULER * 2 + 12;
  const h = gridH + 14 + 16;
  drawRoundedRect(page, { x, yTop, w, h, r: 10, fill: hexRgb(CARD_FACE) });

  const inset = 6;
  const len = 12;
  const thick = 2.2;
  const accent = hexRgb(ACCENT);
  const bottom = yTop - h;
  page.drawRectangle({ x: x + inset, y: yTop - inset - len, width: thick, height: len, color: accent });
  page.drawRectangle({ x: x + inset, y: yTop - inset - thick, width: len, height: thick, color: accent });
  page.drawRectangle({ x: x + w - inset - thick, y: bottom + inset, width: thick, height: len, color: accent });
  page.drawRectangle({ x: x + w - inset - len, y: bottom + inset, width: len, height: thick, color: accent });
}

function drawRulers(
  page: PDFPage,
  skin: TextSkin,
  slice: PageSlice,
  originX: number,
  originYTop: number,
  cell: number,
): void {
  const color = hexRgb(INK_SOFT);
  const size = Math.min(7, Math.max(5, cell * 0.7));
  // 与市面图纸一致：只在每 5 格分区线处标注计数（5/10/15…）；格点过小时改每 10 格。
  const step = cell < 6 ? CARD_MAJOR_EVERY * 2 : CARD_MAJOR_EVERY;
  const labelAt = (index: number) => index > 0 && index % step === 0;
  const font = skin.latin;
  for (let lx = 0; lx < slice.cols; lx += 1) {
    const gx = slice.x0 + lx;
    if (!labelAt(gx)) continue;
    const label = String(gx);
    const w = font.widthOfTextAtSize(label, size);
    const cx = originX + lx * cell + cell / 2 - w / 2;
    page.drawText(label, { x: cx, y: originYTop + 4, size, font, color });
    page.drawText(label, {
      x: cx,
      y: originYTop - slice.rows * cell - 12,
      size,
      font,
      color,
    });
  }
  for (let ly = 0; ly < slice.rows; ly += 1) {
    const gy = slice.y0 + ly;
    if (!labelAt(gy)) continue;
    const label = String(gy);
    const cy = originYTop - (ly + 0.65) * cell;
    page.drawText(label, { x: originX - RULER + 1, y: cy, size, font, color });
    page.drawText(label, {
      x: originX + slice.cols * cell + 3,
      y: cy,
      size,
      font,
      color,
    });
  }
}

/** 细网格线 + 每 5 格分区粗线（分享卡片同款；格点过小时省略细线）。 */
function drawGridLines(
  page: PDFPage,
  slice: PageSlice,
  originX: number,
  originYTop: number,
  cell: number,
): void {
  const gridW = slice.cols * cell;
  const gridH = slice.rows * cell;
  const major = solidRgb(GRID_MAJOR_SOLID);
  if (cell >= 5) {
    const thin = solidRgb(GRID_LINE_SOLID);
    for (let lx = 1; lx < slice.cols; lx += 1) {
      if ((slice.x0 + lx) % CARD_MAJOR_EVERY === 0) continue;
      const x = originX + lx * cell;
      page.drawLine({
        start: { x, y: originYTop },
        end: { x, y: originYTop - gridH },
        thickness: 0.25,
        color: thin,
      });
    }
    for (let ly = 1; ly < slice.rows; ly += 1) {
      if ((slice.y0 + ly) % CARD_MAJOR_EVERY === 0) continue;
      const y = originYTop - ly * cell;
      page.drawLine({
        start: { x: originX, y },
        end: { x: originX + gridW, y },
        thickness: 0.25,
        color: thin,
      });
    }
  }
  for (let lx = 1; lx < slice.cols; lx += 1) {
    if ((slice.x0 + lx) % CARD_MAJOR_EVERY !== 0) continue;
    const x = originX + lx * cell;
    page.drawRectangle({ x: x - 0.3, y: originYTop - gridH, width: 0.6, height: gridH, color: major });
  }
  for (let ly = 1; ly < slice.rows; ly += 1) {
    if ((slice.y0 + ly) % CARD_MAJOR_EVERY !== 0) continue;
    const y = originYTop - ly * cell;
    page.drawRectangle({ x: originX, y: y - 0.3, width: gridW, height: 0.6, color: major });
  }
}

function drawCells(
  page: PDFPage,
  pattern: BeadPattern,
  slice: PageSlice,
  originX: number,
  originYTop: number,
  cell: number,
  showCodes: boolean,
  font: PDFFont,
): number {
  let drawn = 0;
  for (let ly = 0; ly < slice.rows; ly += 1) {
    for (let lx = 0; lx < slice.cols; lx += 1) {
      const gx = slice.x0 + lx;
      const gy = slice.y0 + ly;
      const index = gy * pattern.width + gx;
      const paletteIndex = pattern.cells[index] ?? EMPTY_CELL;
      const x = originX + lx * cell;
      const y = originYTop - (ly + 1) * cell;
      if (paletteIndex === EMPTY_CELL) {
        page.drawRectangle({ x, y, width: cell, height: cell, color: hexRgb(EMPTY_CELL_FILL) });
      } else {
        const color = pattern.palette[paletteIndex];
        if (color === undefined) {
          throw new ExportError(
            "E_EXPORT",
            `PDF cell (${gx},${gy}) missing palette[${paletteIndex}]`,
          );
        }
        page.drawRectangle({ x, y, width: cell, height: cell, color: hexRgb(color.hex) });
        if (showCodes && cell >= 6) {
          const ink = inkOnHex(color.hex);
          page.drawText(color.code, {
            x: x + 0.5,
            y: y + 1.2,
            size: Math.min(5, cell * 0.45),
            font,
            color: rgb(ink.r / 255, ink.g / 255, ink.b / 255),
          });
        }
      }
      drawn += 1;
    }
  }
  return drawn;
}

/** 卡片式色表页：圆角色块内色号 + 用量，按用量降序。 */
async function appendLegendPages(
  doc: PDFDocument,
  skin: TextSkin,
  paper: PaperSizeName,
  pattern: BeadPattern,
  stats: PatternStats,
): Promise<number> {
  const size = PAPER_PT[paper];
  const used = stats.byColor.filter((row) => row.count > 0);
  used.sort((a, b) => b.count - a.count);

  const usableW = size.width - MARGIN * 2;
  const swatchW = 64;
  const swatchH = 34;
  const gapX = 18;
  const gapY = 26;
  const perRow = Math.max(1, Math.floor((usableW + gapX) / (swatchW + gapX)));
  const rowsPerPage = 12;
  const perPage = perRow * rowsPerPage;
  const pages = Math.max(1, Math.ceil(used.length / perPage));

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = doc.addPage([size.width, size.height]);
    drawPageBackground(page, size.width, size.height);
    drawInfoBand(page, skin, size.width, size.height, [
      { label: "色卡清单", value: `${pageIndex + 1} / ${pages}` },
      { label: "色数", value: `${stats.colorCount} 色` },
      { label: "用豆", value: `${stats.beadCount.toLocaleString("en-US")} 颗` },
      { label: "色板", value: pattern.paletteId },
    ]);
    drawFooterNote(page, skin);

    const chunk = used.slice(pageIndex * perPage, (pageIndex + 1) * perPage);
    chunk.forEach((row, index) => {
      const col = index % perRow;
      const gridRow = Math.floor(index / perRow);
      const x = MARGIN + col * (swatchW + gapX);
      // 页眉栏底部在 H-68，色块首行顶部再留 24pt。
      const yTop = size.height - 92 - gridRow * (swatchH + gapY);
      drawRoundedRect(page, {
        x,
        yTop,
        w: swatchW,
        h: swatchH,
        r: 8,
        fill: hexRgb(row.hex),
      });
      const ink = inkOnHex(row.hex);
      const codeColor = rgb(ink.r / 255, ink.g / 255, ink.b / 255);
      const codeW = skin.latin.widthOfTextAtSize(row.code, 8);
      page.drawText(row.code, {
        x: x + (swatchW - codeW) / 2,
        y: yTop - swatchH / 2 - 3,
        size: 8,
        font: skin.latin,
        color: codeColor,
      });
      const countLabel = `x${row.count}`;
      const countW = skin.latin.widthOfTextAtSize(countLabel, 7.5);
      page.drawText(countLabel, {
        x: x + (swatchW - countW) / 2,
        y: yTop - swatchH - 12,
        size: 7.5,
        font: skin.latin,
        color: hexRgb(INK_FADED),
      });
    });
  }
  return pages;
}

export async function exportPdf(
  pattern: BeadPattern,
  options: PdfExportOptions = {
    paper: "a4",
    mode: "make",
    overlap: 2,
    showCodes: true,
    fitSinglePage: true,
    includeLegend: true,
  },
): Promise<PdfExportResult> {
  const stats = assertExportReady(pattern);
  const paper = PAPER_PT[options.paper];
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const latin = await doc.embedFont(StandardFonts.Helvetica);
  const zhBytes = await loadZhFontBytes();
  const zh = zhBytes ? await doc.embedFont(zhBytes, { subset: true }) : null;
  const skin: TextSkin = { zh, latin };
  const cellsDrawnPerPage: number[] = [];
  let slices: PageSlice[];
  let cellPt: number;
  let colPages = 1;
  let rowPages = 1;

  if (options.mode === "preview") {
    const page = doc.addPage([paper.width, paper.height]);
    drawPageBackground(page, paper.width, paper.height);
    // 页眉栏占 [H-68, H-24]，卡片顶 = H-84，网格顶 = 卡片顶 - 14（数字区）。
    const originYTop = paper.height - 98;
    const maxGridW = paper.width - MARGIN * 2 - RULER * 2 - 4;
    const maxGridH = originYTop - 56;
    const cell = Math.min(maxGridW / pattern.width, maxGridH / pattern.height);
    const originX = MARGIN + RULER;
    drawInfoBand(page, skin, paper.width, paper.height, cardHeaderItems(pattern, stats));
    const full: PageSlice = {
      page: 1,
      row: 0,
      col: 0,
      x0: 0,
      y0: 0,
      cols: pattern.width,
      rows: pattern.height,
      overlapRight: 0,
      overlapBottom: 0,
      isLastCol: true,
      isLastRow: true,
    };
    drawCardFrame(page, originX, originYTop, pattern.width * cell, pattern.height * cell);
    cellsDrawnPerPage.push(drawCells(page, pattern, full, originX, originYTop, cell, false, latin));
    drawGridLines(page, full, originX, originYTop, cell);
    drawRulers(page, skin, full, originX, originYTop, cell);
    drawFooterNote(page, skin);
    slices = [full];
    cellPt = cell;
  } else {
    const layout = planMakeLayout(
      pattern.width,
      pattern.height,
      options.paper,
      options.overlap,
      options.fitSinglePage ?? true,
    );
    slices = layout.slices;
    cellPt = layout.cellPt;
    colPages = layout.colPages;
    rowPages = layout.rowPages;
    for (const slice of slices) {
      const page = doc.addPage([paper.width, paper.height]);
      drawPageBackground(page, paper.width, paper.height);
      const originX = MARGIN + RULER;
      const originYTop = paper.height - MARGIN - HEADER;
      drawMakeBand(
        page,
        skin,
        paper.width,
        paper.height,
        pattern,
        stats,
        {
          zh: `第 ${slice.page}/${slices.length} 页 · ${layout.rowPages}x${layout.colPages} 切片 · 列 ${slice.x0 + 1}-${slice.x0 + slice.cols} · 行 ${slice.y0 + 1}-${slice.y0 + slice.rows} · 重叠 右${slice.overlapRight} 下${slice.overlapBottom}`,
          en: `Page ${slice.page}/${slices.length} · ${layout.rowPages}x${layout.colPages} · cols ${slice.x0 + 1}-${slice.x0 + slice.cols} · rows ${slice.y0 + 1}-${slice.y0 + slice.rows} · overlap R${slice.overlapRight} B${slice.overlapBottom}`,
        },
      );
      drawCardFrame(
        page,
        originX,
        originYTop,
        slice.cols * cellPt,
        slice.rows * cellPt,
      );
      const drawn = drawCells(
        page,
        pattern,
        slice,
        originX,
        originYTop,
        cellPt,
        options.showCodes,
        latin,
      );
      if (drawn !== slice.cols * slice.rows) {
        throw new ExportError(
          "E_EXPORT",
          `drew ${drawn} cells, expected ${slice.cols * slice.rows}`,
        );
      }
      drawGridLines(page, slice, originX, originYTop, cellPt);
      drawRulers(page, skin, slice, originX, originYTop, cellPt);
      drawJoinMarks(page, slice, originX, originYTop - slice.rows * cellPt, cellPt);
      drawFooterNote(page, skin);
      cellsDrawnPerPage.push(drawn);
    }
  }

  const legendPageCount =
    options.includeLegend === false
      ? 0
      : await appendLegendPages(doc, skin, options.paper, pattern, stats);
  const bytes = await doc.save();
  return {
    bytes,
    patternPageCount: slices.length,
    legendPageCount,
    cellsDrawnPerPage,
    slices,
    cellPt,
    colPages,
    rowPages,
  };
}

export { PAGE_WARN_COUNT };
