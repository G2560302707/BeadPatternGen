import { describe, expect, it } from "vitest";
import { EMPTY_CELL, createDraftPattern, encodeProject } from "../core/pattern";
import type { BeadColor, BeadPattern } from "../core/pattern";
import { generatePattern } from "../core/pipeline";
import type { GenerateInput } from "../core/pipeline";
import { paintPattern } from "./canvas-renderer";
import {
  applyPan,
  canShowCodes,
  fitView,
  shouldDrawGrid,
  visibleCellRange,
  zoomAt,
  type ViewTransform,
} from "./view-transform";

const PALETTE: BeadColor[] = [
  { code: "S01", name: "White", hex: "#EAEEF3", manufacturer: "Artkal" },
  { code: "S05", name: "Tall Poppy", hex: "#CB3531", manufacturer: "Artkal" },
];

function sampleInput(width: number, height: number): GenerateInput {
  const rgb = new Uint8ClampedArray(width * height * 3);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const hot = i % 3 === 0;
    rgb[i * 3] = hot ? 203 : 234;
    rgb[i * 3 + 1] = hot ? 53 : 238;
    rgb[i * 3 + 2] = hot ? 49 : 243;
    alpha[i] = 255;
  }
  return {
    rgb,
    alpha,
    width,
    height,
    palette: PALETTE,
    paletteId: "artkal-s-midi-5mm",
    paletteVersion: "test",
    maxColors: 2,
    mode: "logo",
    dithering: "none",
    colorMetric: "ciede2000",
    transparentPolicy: "empty",
    ditherStrength: 1,
    source: { originalWidth: width, originalHeight: height, aspectRatio: width / height },
    title: "preview-fixture",
    id: "preview-1",
    now: "2026-10-24T00:00:00.000Z",
  };
}

function fakePattern(width: number, height: number): BeadPattern {
  const pattern = createDraftPattern({
    id: `grid-${width}x${height}`,
    title: "paint",
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

class FakeCtx {
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  font = "";
  textAlign = "left";
  textBaseline = "top";
  globalAlpha = 1;
  fillRects = 0;
  texts: string[] = [];
  clearRect(): void {}
  fillRect(): void {
    this.fillRects += 1;
  }
  strokeRect(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  save(): void {}
  restore(): void {}
  clip(): void {}
  rect(): void {}
  fillText(text: string): void {
    this.texts.push(text);
  }
}

describe("view transform", () => {
  it("hides the grid when scale is too small", () => {
    expect(shouldDrawGrid(4, true)).toBe(false);
    expect(shouldDrawGrid(8, true)).toBe(true);
    expect(canShowCodes(10)).toBe(false);
    expect(canShowCodes(16)).toBe(true);
  });

  it("clips to the viewport instead of enumerating the whole grid", () => {
    const view: ViewTransform = { scale: 10, offsetX: -200, offsetY: -50 };
    const range = visibleCellRange(200, 200, view, { width: 100, height: 80 });
    expect(range.x1 - range.x0).toBeLessThan(30);
    expect(range.y1 - range.y0).toBeLessThan(30);
  });
});

describe("read-only paint", () => {
  it("does not change pattern JSON after zoom and pan", () => {
    const { pattern } = generatePattern(sampleInput(8, 8));
    const before = JSON.stringify(encodeProject(pattern));
    let view = fitView(pattern.width, pattern.height, { width: 320, height: 240 });
    view = zoomAt(view, 40, 40, view.scale * 1.5);
    view = applyPan(view, 12, -8);
    const ctx = new FakeCtx() as unknown as CanvasRenderingContext2D;
    paintPattern(
      ctx,
      pattern,
      view,
      { width: 320, height: 240 },
      {
        showGrid: true,
        showCoords: true,
        showCodes: true,
        highlightColorIndex: 0,
        highlightCells: null,
      },
    );
    expect(JSON.stringify(encodeProject(pattern))).toBe(before);
  });

  it("paints 1×1 and 1×500 without throwing", () => {
    const tiny = fakePattern(1, 1);
    const stripBase = fakePattern(1, 256);
    const strip: BeadPattern = {
      ...stripBase,
      height: 500,
      cells: new Int16Array(500),
    };
    strip.cells.fill(0);
    const ctx = new FakeCtx() as unknown as CanvasRenderingContext2D;
    paintPattern(
      ctx,
      tiny,
      { scale: 20, offsetX: 0, offsetY: 0 },
      { width: 40, height: 40 },
      {
        showGrid: true,
        showCoords: false,
        showCodes: false,
        highlightColorIndex: null,
        highlightCells: null,
      },
    );
    paintPattern(
      ctx,
      strip,
      { scale: 2, offsetX: 0, offsetY: 0 },
      { width: 40, height: 200 },
      {
        showGrid: false,
        showCoords: false,
        showCodes: false,
        highlightColorIndex: null,
        highlightCells: null,
      },
    );
  });

  it("draws 1-based coordinates on empty and filled cells", () => {
    const pattern = fakePattern(3, 2);
    pattern.cells[0] = EMPTY_CELL;
    const ctx = new FakeCtx();
    paintPattern(
      ctx as unknown as CanvasRenderingContext2D,
      pattern,
      { scale: 20, offsetX: 40, offsetY: 40 },
      { width: 200, height: 120 },
      {
        showGrid: true,
        showCoords: true,
        showCodes: false,
        highlightColorIndex: null,
        highlightCells: null,
      },
    );
    expect(ctx.fillRects).toBeGreaterThan(1);
    expect(ctx.texts).toContain("1");
    expect(ctx.texts).toContain("3");
    expect(ctx.texts).not.toContain("0");
  });

  it("records first-frame time for a 200×200 grid", () => {
    const pattern = fakePattern(200, 200);
    const ctx = new FakeCtx() as unknown as CanvasRenderingContext2D;
    const view = fitView(200, 200, { width: 800, height: 800 });
    const stats = paintPattern(
      ctx,
      pattern,
      view,
      { width: 800, height: 800 },
      {
        showGrid: true,
        showCoords: false,
        showCodes: false,
        highlightColorIndex: null,
        highlightCells: null,
      },
    );
    console.log(
      `S11 200x200 first paint: ${stats.elapsedMs.toFixed(2)}ms, cells=${stats.cellsPainted}`,
    );
    expect(stats.cellsPainted).toBeGreaterThan(0);
    expect(stats.elapsedMs).toBeLessThan(2000);
  });
});
