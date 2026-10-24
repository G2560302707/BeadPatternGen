import { describe, expect, it } from "vitest";
import { createDraftPattern } from "./draft";
import { PatternError } from "./errors";
import { EMPTY_CELL } from "./limits";
import type { BeadColor, GenerationSettings, PatternSource } from "./types";

const PALETTE: BeadColor[] = [
  { code: "A", name: "Black", hex: "#000000", manufacturer: "TEST" },
  { code: "B", name: "White", hex: "#FFFFFF", manufacturer: "TEST" },
];

const SETTINGS: GenerationSettings = {
  maxColors: 24,
  dithering: "none",
  colorMetric: "ciede2000",
  transparentPolicy: "empty",
};

const SOURCE: PatternSource = {
  originalWidth: 800,
  originalHeight: 600,
  aspectRatio: 800 / 600,
  crop: { x: 100, y: 50, width: 400, height: 300 },
};

function makeDraft(source: PatternSource = SOURCE) {
  return createDraftPattern({
    id: "draft-1",
    title: "test.png",
    width: 40,
    height: 30,
    palette: PALETTE,
    mode: "photo",
    paletteId: "test-palette",
    paletteVersion: "1",
    settings: SETTINGS,
    source,
    now: "2026-10-24T00:00:00.000Z",
  });
}

describe("createDraftPattern", () => {
  it("source.crop（源图像素坐标）原样写入 BeadPattern", () => {
    const pattern = makeDraft();
    expect(pattern.source.crop).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    expect(pattern.source.originalWidth).toBe(800);
    expect(pattern.source.originalHeight).toBe(600);
  });

  it("草稿格子全部为 -1（不做色卡匹配）", () => {
    const pattern = makeDraft();
    expect(pattern.cells).toHaveLength(40 * 30);
    expect(Array.from(pattern.cells).every((value) => value === EMPTY_CELL)).toBe(true);
    expect(pattern.paletteHash).toBeDefined();
  });

  it("裁剪矩形越出原图 → E_INVALID_SETTINGS", () => {
    expect(() =>
      makeDraft({
        originalWidth: 100,
        originalHeight: 100,
        aspectRatio: 1,
        crop: { x: 50, y: 0, width: 60, height: 10 },
      }),
    ).toThrowError(PatternError);

    try {
      makeDraft({
        originalWidth: 100,
        originalHeight: 100,
        aspectRatio: 1,
        crop: { x: 50, y: 0, width: 60, height: 10 },
      });
    } catch (error) {
      expect((error as PatternError).code).toBe("E_INVALID_SETTINGS");
    }
  });
});
