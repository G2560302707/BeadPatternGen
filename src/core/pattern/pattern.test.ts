import { describe, expect, it } from "vitest";
import { decodeProject, encodeProject, migrate } from "./codec";
import { PatternError } from "./errors";
import { computePaletteHash } from "./hash";
import { EMPTY_CELL, MAX_GRID_WIDTH } from "./limits";
import { computeStats } from "./stats";
import type { BeadColor, BeadPattern } from "./types";
import { validatePattern } from "./validate";

const palette: BeadColor[] = [
  { code: "S01", name: "White", hex: "#EAEEF3", manufacturer: "Artkal" },
  { code: "S13", name: "Black", hex: "#292A2B", manufacturer: "Artkal" },
];

function makePattern(overrides: Partial<BeadPattern> = {}): BeadPattern {
  const width = overrides.width ?? 2;
  const height = overrides.height ?? 2;
  const cells = overrides.cells ?? Int16Array.from([0, 1, EMPTY_CELL, 0]);
  const pattern: BeadPattern = {
    schemaVersion: "1.0",
    id: "pat-1",
    title: "fixture",
    width,
    height,
    cells,
    palette,
    mode: "logo",
    paletteId: "artkal-s-midi-5mm",
    paletteVersion: "beadcolors-f97ff428-2026-08-17",
    settings: {
      maxColors: 2,
      dithering: "none",
      colorMetric: "ciede2000",
      transparentPolicy: "empty",
    },
    source: {
      originalWidth: 16,
      originalHeight: 16,
      aspectRatio: 1,
    },
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
    ...overrides,
  };
  return pattern;
}

function expectCode(fn: () => void, code: string): void {
  try {
    fn();
    throw new Error(`expected PatternError ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(PatternError);
    expect((err as PatternError).code).toBe(code);
  }
}

describe("validatePattern", () => {
  it("accepts a legal 2×2 pattern", () => {
    expect(() => validatePattern(makePattern())).not.toThrow();
  });

  it("rejects cells length mismatch", () => {
    expectCode(
      () => validatePattern(makePattern({ cells: Int16Array.from([0]) })),
      "E_CELLS_LENGTH",
    );
  });

  it("rejects out-of-range index", () => {
    expectCode(
      () => validatePattern(makePattern({ cells: Int16Array.from([0, 2, -1, 0]) })),
      "E_INDEX_OUT_OF_RANGE",
    );
  });

  it("rejects 0×0 empty grid", () => {
    expectCode(
      () => validatePattern(makePattern({ width: 0, height: 0, cells: new Int16Array(0) })),
      "E_NON_POSITIVE_DIMENSION",
    );
  });

  it("rejects duplicate palette codes", () => {
    expectCode(
      () =>
        validatePattern(
          makePattern({
            palette: [
              { code: "S01", name: "A", hex: "#EAEEF3", manufacturer: "Artkal" },
              { code: "S01", name: "B", hex: "#292A2B", manufacturer: "Artkal" },
            ],
          }),
        ),
      "E_DUP_CODE",
    );
  });

  it("rejects oversized grids", () => {
    expectCode(
      () =>
        validatePattern(
          makePattern({
            width: MAX_GRID_WIDTH + 1,
            height: 1,
            cells: new Int16Array(MAX_GRID_WIDTH + 1),
          }),
        ),
      "E_DIMENSION_LIMIT",
    );
  });
});

describe("computeStats", () => {
  it("counts non-empty cells only and matches the sum invariant", () => {
    const stats = computeStats(makePattern());
    expect(stats.beadCount).toBe(3);
    expect(stats.colorCount).toBe(2);
    const white = stats.byColor.find((row) => row.code === "S01");
    const black = stats.byColor.find((row) => row.code === "S13");
    expect(white?.count).toBe(2);
    expect(black?.count).toBe(1);
    const sum = stats.byColor.reduce((acc, row) => acc + row.count, 0);
    expect(sum).toBe(stats.beadCount);
    expect(white?.percentage).toBeCloseTo((2 / 3) * 100);
  });
});

describe("codec", () => {
  it("round-trips cells and settings without using Int16Array JSON objects", () => {
    const original = makePattern({
      paletteHash: computePaletteHash(palette),
      source: {
        originalWidth: 32,
        originalHeight: 16,
        aspectRatio: 2,
        crop: { x: 1, y: 2, width: 8, height: 8 },
      },
    });
    const json = encodeProject(original);
    expect(Array.isArray(json.cells)).toBe(true);
    expect(json.cells).toEqual([0, 1, -1, 0]);
    const encoded = JSON.stringify(json);
    expect(encoded.includes('"0":')).toBe(false);
    const restored = decodeProject(JSON.parse(encoded) as unknown);
    expect(restored.width).toBe(original.width);
    expect(restored.height).toBe(original.height);
    expect(Array.from(restored.cells)).toEqual(Array.from(original.cells));
    expect(restored.settings).toEqual(original.settings);
    expect(restored.palette).toEqual(original.palette);
    expect(restored.mode).toBe(original.mode);
    expect(restored.paletteId).toBe(original.paletteId);
    expect(restored.paletteVersion).toBe(original.paletteVersion);
    expect(restored.source).toEqual(original.source);
    expect(restored.schemaVersion).toBe("1.0");
  });

  it("rejects unknown schemaVersion", () => {
    const json = encodeProject(makePattern());
    expectCode(() => decodeProject({ ...json, schemaVersion: "9.9" }), "E_UNKNOWN_SCHEMA");
  });

  it("migrate 1.0 is identity and unknown versions throw", () => {
    const json = encodeProject(makePattern());
    expect(migrate(json, "1.0")).toBe(json);
    expectCode(() => migrate(json, "2.0"), "E_UNKNOWN_SCHEMA");
  });

  it("fills paletteHash on encode when omitted", () => {
    const json = encodeProject(makePattern());
    expect(json.paletteHash).toBe(computePaletteHash(palette));
  });
});
