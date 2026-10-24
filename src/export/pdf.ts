/**
 * 分页 PDF。制作版切片只调用 S12 computePages()，不自己算页矩阵。
 * 细条分页通过 balancedCapacity 调整传入容量，不改 paginate 内核。
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import { hexToRgb } from "../core/color";
import { computePages } from "../core/export/geometry/paginate";
import type { PageSlice } from "../core/export/geometry/types";
import { EMPTY_CELL } from "../core/pattern";
import type { BeadPattern, PatternStats } from "../core/pattern";
import { displayCoord, inkOnHex, isMajorLine } from "../render/chart-style";
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

function hexRgb(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return rgb(r / 255, g / 255, b / 255);
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
): MakeLayout {
  let cellPt = DEFAULT_CELL_PT;
  for (let tryPt = DEFAULT_CELL_PT; tryPt >= MIN_CELL_PT; tryPt -= 1) {
    const cap = pdfPageCapacity(paper, tryPt, true);
    if (width <= cap.maxCols && height <= cap.maxRows) {
      cellPt = tryPt;
      break;
    }
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

function drawHeader(page: PDFPage, font: PDFFont, text: string, y: number): void {
  page.drawText(text, {
    x: MARGIN,
    y,
    size: 9,
    font,
    color: rgb(0.17, 0.13, 0.09),
  });
}

function drawJoinMarks(
  page: PDFPage,
  slice: PageSlice,
  originX: number,
  originY: number,
  cell: number,
): void {
  const mark = rgb(0.71, 0.1, 0.15);
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

function hatchEmpty(page: PDFPage, x: number, y: number, cell: number): void {
  page.drawRectangle({
    x,
    y,
    width: cell,
    height: cell,
    color: rgb(0.96, 0.94, 0.91),
    borderColor: rgb(0.7, 0.66, 0.58),
    borderWidth: 0.2,
  });
  const step = Math.max(2.5, cell / 3);
  for (let d = 0; d < cell * 2; d += step) {
    page.drawLine({
      start: { x: x + d, y },
      end: { x: x + d - cell, y: y + cell },
      thickness: 0.3,
      color: rgb(0.78, 0.78, 0.78),
    });
  }
}

function drawRulers(
  page: PDFPage,
  font: PDFFont,
  slice: PageSlice,
  originX: number,
  originYTop: number,
  cell: number,
): void {
  const color = rgb(0.17, 0.13, 0.09);
  const size = Math.min(7, Math.max(5, cell * 0.7));
  for (let lx = 0; lx < slice.cols; lx += 1) {
    const label = String(displayCoord(slice.x0 + lx));
    const cx = originX + lx * cell + cell / 2 - 3;
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
    const label = String(displayCoord(slice.y0 + ly));
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

function drawMajorLines(
  page: PDFPage,
  slice: PageSlice,
  originX: number,
  originYTop: number,
  cell: number,
): void {
  const orange = rgb(0.84, 0.48, 0.19);
  for (let lx = 0; lx <= slice.cols; lx += 1) {
    const gx = slice.x0 + lx;
    if (lx !== 0 && lx !== slice.cols && !isMajorLine(gx)) continue;
    const x = originX + lx * cell;
    page.drawRectangle({
      x,
      y: originYTop - slice.rows * cell,
      width: 1.1,
      height: slice.rows * cell,
      color: orange,
    });
  }
  for (let ly = 0; ly <= slice.rows; ly += 1) {
    const gy = slice.y0 + ly;
    if (ly !== 0 && ly !== slice.rows && !isMajorLine(gy)) continue;
    const y = originYTop - ly * cell;
    page.drawRectangle({
      x: originX,
      y,
      width: slice.cols * cell,
      height: 1.1,
      color: orange,
    });
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
  const stroke = rgb(0.7, 0.66, 0.58);
  for (let ly = 0; ly < slice.rows; ly += 1) {
    for (let lx = 0; lx < slice.cols; lx += 1) {
      const gx = slice.x0 + lx;
      const gy = slice.y0 + ly;
      const index = gy * pattern.width + gx;
      const paletteIndex = pattern.cells[index] ?? EMPTY_CELL;
      const x = originX + lx * cell;
      const y = originYTop - (ly + 1) * cell;
      if (paletteIndex === EMPTY_CELL) {
        hatchEmpty(page, x, y, cell);
      } else {
        const color = pattern.palette[paletteIndex];
        if (color === undefined) {
          throw new ExportError(
            "E_EXPORT",
            `PDF cell (${gx},${gy}) missing palette[${paletteIndex}]`,
          );
        }
        page.drawRectangle({
          x,
          y,
          width: cell,
          height: cell,
          color: hexRgb(color.hex),
          borderColor: stroke,
          borderWidth: 0.2,
        });
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

async function appendLegendPages(
  doc: PDFDocument,
  font: PDFFont,
  paper: PaperSizeName,
  stats: PatternStats,
): Promise<number> {
  const size = PAPER_PT[paper];
  const used = stats.byColor.filter((row) => row.count > 0);
  const linesPerPage = 32;
  const pages = Math.max(1, Math.ceil(used.length / linesPerPage));
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = doc.addPage([size.width, size.height]);
    drawHeader(
      page,
      font,
      `Color list ${pageIndex + 1}/${pages}  beads ${stats.beadCount}  colors ${stats.colorCount}`,
      size.height - MARGIN - 12,
    );
    const chunk = used.slice(pageIndex * linesPerPage, (pageIndex + 1) * linesPerPage);
    chunk.forEach((row, index) => {
      const y = size.height - MARGIN - 36 - index * 18;
      page.drawRectangle({ x: MARGIN, y: y - 2, width: 12, height: 12, color: hexRgb(row.hex) });
      page.drawText(`${row.code}  ${row.hex}  x${row.count}`, {
        x: MARGIN + 18,
        y,
        size: 9,
        font,
        color: rgb(0.17, 0.13, 0.09),
      });
    });
  }
  return pages;
}

export async function exportPdf(
  pattern: BeadPattern,
  options: PdfExportOptions = { paper: "a4", mode: "make", overlap: 2, showCodes: true },
): Promise<PdfExportResult> {
  const stats = assertExportReady(pattern);
  const paper = PAPER_PT[options.paper];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cellsDrawnPerPage: number[] = [];
  let slices: PageSlice[];
  let cellPt: number;
  let colPages = 1;
  let rowPages = 1;

  if (options.mode === "preview") {
    const page = doc.addPage([paper.width, paper.height]);
    const usableW = paper.width - MARGIN * 2;
    const usableH = paper.height - MARGIN * 2 - HEADER;
    const cell = Math.min(usableW / pattern.width, usableH / pattern.height);
    const originX = MARGIN;
    const originYTop = paper.height - MARGIN - HEADER;
    drawHeader(
      page,
      font,
      `Preview  1/1  ${pattern.width}x${pattern.height}  ${pattern.paletteId}`,
      originYTop + 20,
    );
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
    cellsDrawnPerPage.push(drawCells(page, pattern, full, originX, originYTop, cell, false, font));
    slices = [full];
    cellPt = cell;
  } else {
    const layout = planMakeLayout(pattern.width, pattern.height, options.paper, options.overlap);
    slices = layout.slices;
    cellPt = layout.cellPt;
    colPages = layout.colPages;
    rowPages = layout.rowPages;
    for (const slice of slices) {
      const page = doc.addPage([paper.width, paper.height]);
      const originX = MARGIN + RULER;
      const originYTop = paper.height - MARGIN - HEADER;
      const range = `x ${displayCoord(slice.x0)}-${displayCoord(slice.x0 + slice.cols - 1)}  y ${displayCoord(slice.y0)}-${displayCoord(slice.y0 + slice.rows - 1)}`;
      drawHeader(
        page,
        font,
        `Page ${slice.page}/${slices.length}  ${layout.rowPages}x${layout.colPages}  ${range}  overlap R${slice.overlapRight}/B${slice.overlapBottom}`,
        originYTop + 28,
      );
      const drawn = drawCells(
        page,
        pattern,
        slice,
        originX,
        originYTop,
        cellPt,
        options.showCodes,
        font,
      );
      if (drawn !== slice.cols * slice.rows) {
        throw new ExportError(
          "E_EXPORT",
          `drew ${drawn} cells, expected ${slice.cols * slice.rows}`,
        );
      }
      drawMajorLines(page, slice, originX, originYTop, cellPt);
      drawRulers(page, font, slice, originX, originYTop, cellPt);
      drawJoinMarks(page, slice, originX, originYTop - slice.rows * cellPt, cellPt);
      cellsDrawnPerPage.push(drawn);
    }
  }

  const legendPageCount = await appendLegendPages(doc, font, options.paper, stats);
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
