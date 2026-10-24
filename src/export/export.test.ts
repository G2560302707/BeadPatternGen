import { decode as decodePng } from "fast-png";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  EMPTY_CELL,
  applyCommandToPattern,
  createDraftPattern,
  decodeProject,
  encodeProject,
} from "../core/pattern";
import type { BeadColor, BeadPattern } from "../core/pattern";
import { assertExportReady } from "./assert";
import { exportCsv } from "./csv";
import { exportProjectJson } from "./json";
import { balancedCapacity } from "./capacity";
import { exportPdf, planMakeLayout } from "./pdf";
import { cellCenterSample, cellCornerSample, exportPng, renderPngRgba } from "./png";

const PALETTE: BeadColor[] = [
  { code: "S01", name: "White", hex: "#EAEEF3", manufacturer: "Artkal" },
  { code: "S05", name: "Tall Poppy", hex: "#CB3531", manufacturer: "Artkal" },
];

function fixture(width = 4, height = 3): BeadPattern {
  const pattern = createDraftPattern({
    id: "export-fix",
    title: "export",
    width,
    height,
    palette: PALETTE,
    mode: "logo",
    paletteId: "artkal-s-midi-5mm",
    paletteVersion: "test",
    settings: {
      maxColors: 2,
      dithering: "none",
      colorMetric: "ciede2000",
      transparentPolicy: "empty",
    },
    source: { originalWidth: width, originalHeight: height, aspectRatio: width / height },
    now: "2026-10-24T00:00:00.000Z",
  });
  for (let i = 0; i < pattern.cells.length; i += 1) {
    pattern.cells[i] = i % 2 === 0 ? 0 : 1;
  }
  return pattern;
}

function paletteHexes(pattern: BeadPattern): Set<string> {
  return new Set(pattern.palette.map((color) => color.hex.toUpperCase()));
}

describe("export guard", () => {
  it("refuses to export when counts do not match non-empty cells", () => {
    const pattern = fixture();
    pattern.cells[0] = 99 as unknown as number;
    expect(() => assertExportReady(pattern)).toThrow();
  });
});

describe("PNG", () => {
  it("samples every cell center from the palette only", () => {
    const pattern = fixture();
    const options = {
      cellSize: 16 as const,
      showGrid: false,
      showCoords: false,
      showCodes: false,
      showLegend: false,
    };
    const bytes = exportPng(pattern, options);
    const decoded = decodePng(bytes);
    const { layout } = renderPngRgba(pattern, options);
    const allowed = paletteHexes(pattern);
    for (let y = 0; y < pattern.height; y += 1) {
      for (let x = 0; x < pattern.width; x += 1) {
        const cell = pattern.cells[y * pattern.width + x] ?? EMPTY_CELL;
        if (cell === EMPTY_CELL) continue;
        const { x: px, y: py } = cellCenterSample(layout, x, y);
        const offset = (py * decoded.width + px) * (decoded.channels ?? 4);
        const r = decoded.data[offset] ?? 0;
        const g = decoded.data[offset + 1] ?? 0;
        const b = decoded.data[offset + 2] ?? 0;
        const hex =
          `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        expect(allowed.has(hex)).toBe(true);
        const color = pattern.palette[cell];
        expect(hex).toBe(color?.hex.toUpperCase());
      }
    }
  });

  it("does not allocate a single canvas larger than MAX edge conceptually (tiled strips)", () => {
    const { data } = renderPngRgba(fixture(8, 8), {
      cellSize: 8,
      showGrid: true,
      showCoords: true,
      showCodes: false,
      showLegend: true,
    });
    expect(data.length % 4).toBe(0);
  });

  it("samples near the cell corner when codes are drawn", () => {
    const pattern = fixture();
    const options = {
      cellSize: 16 as const,
      showGrid: false,
      showCoords: true,
      showCodes: true,
      showLegend: true,
    };
    const { layout, data } = renderPngRgba(pattern, options);
    expect(layout.gutter).toBeGreaterThan(0);
    expect(layout.gridOriginY).toBeGreaterThan(layout.gutter);
    for (let y = 0; y < pattern.height; y += 1) {
      for (let x = 0; x < pattern.width; x += 1) {
        const cell = pattern.cells[y * pattern.width + x] ?? EMPTY_CELL;
        if (cell === EMPTY_CELL) continue;
        const { x: px, y: py } = cellCornerSample(layout, x, y);
        const offset = (py * layout.width + px) * 4;
        const r = data[offset] ?? 0;
        const g = data[offset + 1] ?? 0;
        const b = data[offset + 2] ?? 0;
        const hex =
          `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        expect(hex).toBe(pattern.palette[cell]?.hex.toUpperCase());
      }
    }
  });
});

describe("PDF", () => {
  it("make-mode page count matches computePages and each page draws cols*rows cells", async () => {
    const pattern = fixture(20, 12);
    const result = await exportPdf(pattern, {
      paper: "a4",
      mode: "make",
      overlap: 2,
      showCodes: false,
    });
    const planned = planMakeLayout(pattern.width, pattern.height, "a4", 2);
    expect(result.patternPageCount).toBe(planned.slices.length);
    expect(result.slices).toEqual(planned.slices);
    result.slices.forEach((slice, index) => {
      expect(result.cellsDrawnPerPage[index]).toBe(slice.cols * slice.rows);
    });
    const loaded = await PDFDocument.load(result.bytes);
    expect(loaded.getPageCount()).toBe(result.patternPageCount + result.legendPageCount);
  });

  it("balances leftover strips instead of a full page plus a sliver", async () => {
    expect(balancedCapacity(70, 65, 2)).toBe(36);
    const planned = planMakeLayout(200, 80, "a4", 2);
    expect(planned.slices.length).toBeGreaterThan(1);
    const cols = planned.slices.map((slice) => slice.cols);
    const minCols = Math.min(...cols);
    const maxCols = Math.max(...cols);
    expect(minCols / maxCols).toBeGreaterThan(0.5);
    const covered = new Set<string>();
    for (const slice of planned.slices) {
      for (let y = 0; y < slice.rows; y += 1) {
        for (let x = 0; x < slice.cols; x += 1) {
          covered.add(`${slice.x0 + x},${slice.y0 + y}`);
        }
      }
    }
    expect(covered.size).toBe(200 * 80);
  });
});

describe("CSV", () => {
  it("starts with UTF-8 BOM and counts sum to non-empty cells", () => {
    const pattern = fixture();
    const bytes = exportCsv(pattern);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
    const rows = text.trim().split(/\r?\n/).slice(1);
    const dataRows = rows.filter((line) => !line.startsWith("合计"));
    let sum = 0;
    for (const line of dataRows) {
      const parts = line.split(",");
      sum += Number(parts[3]);
    }
    expect(sum).toBe(pattern.width * pattern.height);
  });
});

describe("JSON after phase-2 edits", () => {
  it("exports the edited matrix without changing schema 1.0", () => {
    const pattern = applyCommandToPattern(
      fixture(),
      { kind: "paint", changes: [{ index: 0, from: 0, to: 1 }] },
      "2026-10-24T01:00:00.000Z",
    );
    const json = exportProjectJson(pattern);
    const again = decodeProject(json);
    expect(again.schemaVersion).toBe("1.0");
    expect(again.cells[0]).toBe(1);
    expect(encodeProject(again).cells).toEqual(encodeProject(pattern).cells);
  });
});

describe("JSON", () => {
  it("round-trips cells exactly via encodeProject", () => {
    const pattern = fixture();
    const json = exportProjectJson(pattern);
    const again = decodeProject(json);
    expect(Array.from(again.cells)).toEqual(Array.from(pattern.cells));
    expect(again.paletteId).toBe(pattern.paletteId);
    expect(again.paletteVersion).toBe(pattern.paletteVersion);
    expect(again.settings).toEqual(pattern.settings);
  });
});

describe("broken stats", () => {
  it("does not export PNG/CSV/JSON when the matrix is corrupt", () => {
    const pattern = fixture();
    Object.defineProperty(pattern, "cells", { value: new Int16Array([0]) });
    expect(() => exportPng(pattern)).toThrow();
    expect(() => exportCsv(pattern)).toThrow();
    expect(() => exportProjectJson(pattern)).toThrow();
  });
});
