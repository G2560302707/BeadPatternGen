import { describe, expect, it } from "vitest";
import { EMPTY_CELL } from "../../core/pattern";
import { regenSelection } from "../../core/pattern/local-regen";
import type { BeadPattern } from "../../core/pattern";
import { resolveRegenCrop } from "./regen-sample";

function pattern(crop?: { x: number; y: number; width: number; height: number }): BeadPattern {
  return {
    schemaVersion: "1.0",
    id: "regen-p",
    title: "regen",
    width: 4,
    height: 4,
    cells: new Int16Array(16).fill(EMPTY_CELL),
    palette: [{ code: "A", name: "A", hex: "#111111", manufacturer: "x" }],
    mode: "logo",
    paletteId: "p",
    paletteVersion: "1",
    settings: {
      maxColors: 1,
      dithering: "none",
      colorMetric: "ciede2000",
      transparentPolicy: "empty",
    },
    source: {
      originalWidth: 32,
      originalHeight: 32,
      aspectRatio: 1,
      ...(crop ? { crop } : {}),
    },
    createdAt: "t0",
    updatedAt: "t1",
  };
}

describe("regen sample derivation (R3)", () => {
  it("prefers the pattern source crop and clamps it to the bitmap", () => {
    const resolved = resolveRegenCrop(pattern({ x: 0, y: 0, width: 40, height: 20 }), null, 32, 32);
    expect(resolved).toEqual({ x: 0, y: 0, width: 32, height: 20 });
  });

  it("falls back to the workspace crop when the pattern has no source crop", () => {
    const resolved = resolveRegenCrop(pattern(), { x: 4, y: 4, width: 8, height: 8 }, 32, 32);
    expect(resolved).toEqual({ x: 4, y: 4, width: 8, height: 8 });
  });

  it("returns null without any usable crop or bitmap", () => {
    expect(resolveRegenCrop(pattern(), null, 32, 32)).toBeNull();
    expect(
      resolveRegenCrop(pattern({ x: 0, y: 0, width: 16, height: 16 }), null, 0, 32),
    ).toBeNull();
  });

  it("regenerates from a reconstructed sample without covering locked cells", () => {
    // 纯函数层构造 rgb/alpha（等价于 sampleBitmapToGrid 的产物），
    // 模拟打开旧项目后重采样再生成：locked 格必须保持原色。
    const palette = [
      { code: "Y", name: "Y", hex: "#FFFF00", manufacturer: "x" },
      { code: "B", name: "B", hex: "#0000FF", manufacturer: "x" },
    ];
    const cells = Int16Array.from([0, 0, 0, 0]);
    const locked = new Uint8Array([1, 0, 0, 1]);
    // 采样把格子 2 判为蓝色（色 1），格子 1 透明。
    const rgb = new Uint8ClampedArray([
      0, 0, 255, 255, 255, 255, 0, 0, 255, 255, 255, 255,
    ]);
    const alpha = new Uint8Array([255, 0, 255, 255]);
    const changes = regenSelection({
      cells,
      locked,
      indices: [0, 1, 2, 3],
      width: 2,
      height: 2,
      rgb,
      alpha,
      palette,
      metric: "ciede2000",
      transparentPolicy: "empty",
    });
    expect(changes.some((change) => change.index === 0)).toBe(false);
    expect(changes.some((change) => change.index === 3)).toBe(false);
    expect(changes).toContainEqual({ index: 1, from: 0, to: EMPTY_CELL });
    expect(changes).toContainEqual({ index: 2, from: 0, to: 1 });
  });
});
