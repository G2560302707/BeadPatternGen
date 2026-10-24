import { describe, expect, it } from "vitest";
import { createDraftPattern, EMPTY_CELL } from "../core/pattern";
import type { BeadColor, BeadPattern } from "../core/pattern";
import { paletteColors } from "../features/palette-panel/locked-palette";
import { shareCardLayout } from "./share-card";
import type { ShareCardOptions } from "./share-card";

function twoColorPalette(): BeadColor[] {
  return paletteColors("mard-221").slice(0, 2);
}

function makePattern(width: number, height: number): BeadPattern {
  const palette = twoColorPalette();
  const cells = new Int16Array(width * height);
  for (let index = 0; index < cells.length; index += 1) {
    cells[index] = index % 3 === 0 ? EMPTY_CELL : ((index % 2) as number);
  }
  return createDraftPattern({
    id: "test-share-card",
    title: "share card test",
    width,
    height,
    palette,
    mode: "anime",
    paletteId: "mard-221-mini-2.6mm",
    paletteVersion: "pindou-color-data-2026-05-19",
    settings: {
      maxColors: 2,
      dithering: "none",
      colorMetric: "ciede2000",
      transparentPolicy: "empty",
    },
    source: {
      originalWidth: width * 10,
      originalHeight: height * 10,
      aspectRatio: 1,
    },
  });
}

const BASE_OPTIONS: ShareCardOptions = { showCompare: false };

describe("share card layout", () => {
  it("fits a 52×52 grid like the reference chart: cell 20+px, codes visible", () => {
    const layout = shareCardLayout(makePattern(52, 52), 18, BASE_OPTIONS);
    expect(layout.width).toBe(1242);
    expect(layout.grid.cell).toBeGreaterThanOrEqual(13);
    expect(layout.showCodes).toBe(true);
    expect(layout.compare).toBeNull();
  });

  it("keeps cell size at least the floor for very large grids and hides codes", () => {
    const layout = shareCardLayout(makePattern(200, 200), 18, BASE_OPTIONS);
    expect(layout.grid.cell).toBeGreaterThanOrEqual(3);
    expect(layout.showCodes).toBe(false);
  });

  it("reserves a compare section when enabled", () => {
    const layout = shareCardLayout(makePattern(52, 52), 18, {
      ...BASE_OPTIONS,
      showCompare: true,
      source: { image: null as unknown as CanvasImageSource, width: 10, height: 10 },
    });
    expect(layout.compare).not.toBeNull();
    expect(layout.height).toBeGreaterThan(
      shareCardLayout(makePattern(52, 52), 18, BASE_OPTIONS).height,
    );
  });

  it("grows legend rows with used color count", () => {
    const few = shareCardLayout(makePattern(52, 52), 6, BASE_OPTIONS);
    const many = shareCardLayout(makePattern(52, 52), 23, BASE_OPTIONS);
    expect(many.legend.rows).toBeGreaterThan(few.legend.rows);
  });

  it("keeps the grid inside the white card with ruler margins", () => {
    const layout = shareCardLayout(makePattern(52, 52), 18, BASE_OPTIONS);
    const { card, grid } = layout;
    expect(grid.x).toBeGreaterThanOrEqual(card.x + card.pad);
    expect(grid.y).toBeGreaterThanOrEqual(card.y + card.pad);
    expect(grid.x + grid.cols * grid.cell).toBeLessThanOrEqual(
      card.x + card.w - card.pad + 1,
    );
    expect(grid.y + grid.rows * grid.cell).toBeLessThanOrEqual(
      card.y + card.h - card.pad + 1,
    );
  });
});
