import { describe, expect, it } from "vitest";
import { EMPTY_ALPHA_THRESHOLD, SamplingError, computeCellCoverage, sampleToGrid } from "./index";
import type { AlphaPolicy, SamplingErrorCode } from "./index";

interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

function makeImage(
  width: number,
  height: number,
  pixels: readonly Pixel[] | ((x: number, y: number) => Pixel),
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = typeof pixels === "function" ? pixels(x, y) : pixels[y * width + x];
      if (!pixel) {
        throw new Error(`missing pixel at ${x},${y}`);
      }
      const offset = (y * width + x) * 4;
      data[offset] = pixel.r;
      data[offset + 1] = pixel.g;
      data[offset + 2] = pixel.b;
      data[offset + 3] = pixel.a;
    }
  }
  return { width, height, data, colorSpace: "srgb" } as unknown as ImageData;
}

function solid(width: number, height: number, pixel: Pixel): ImageData {
  return makeImage(width, height, () => pixel);
}

function captureSamplingError(action: () => unknown): SamplingError {
  try {
    action();
  } catch (error) {
    if (error instanceof SamplingError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected SamplingError, but no error was thrown");
}

function expectCode(code: SamplingErrorCode, action: () => unknown): void {
  const error = captureSamplingError(action);
  expect(error.code).toBe(code);
}

const FULL = { x: 0, y: 0, width: 1, height: 1 };

describe("sampleToGrid · 核心向量", () => {
  it("V1: 2×2 纯色 → 1×1，输出四色面积平均（精确值）", () => {
    const img = makeImage(2, 2, [
      { r: 10, g: 20, b: 30, a: 255 },
      { r: 50, g: 60, b: 70, a: 255 },
      { r: 90, g: 100, b: 110, a: 255 },
      { r: 130, g: 140, b: 150, a: 255 },
    ]);
    const result = sampleToGrid(img, 1, 1, { x: 0, y: 0, width: 2, height: 2 }, "empty");
    // 1.1 起颜色在线性光空间平均：先 sRGB→线性求均值，再编码回 sRGB。
    // 线性均值 (0.0901, 0.1104, 0.1352) → sRGB (85, 93, 102)；
    // 旧 sRGB 直接平均 (70, 80, 90) 会把暗角抬亮，物理上不正确。
    expect(Array.from(result.rgb)).toEqual([85, 93, 102]);
    expect(Array.from(result.alpha)).toEqual([255]);
  });

  it("V2: 4×4 灰阶渐变 → 2×2，手算期望值", () => {
    const img = makeImage(4, 4, (x, y) => {
      const value = (y * 4 + x) * 2;
      return { r: value, g: value, b: value, a: 255 };
    });
    const result = sampleToGrid(img, 2, 2, { x: 0, y: 0, width: 4, height: 4 }, "empty");
    expect(Array.from(result.rgb)).toEqual([5, 5, 5, 9, 9, 9, 21, 21, 21, 25, 25, 25]);
    expect(Array.from(result.alpha)).toEqual([255, 255, 255, 255]);
  });

  it("V3: 1×1 全透明 + empty → alpha=0（空格标记）", () => {
    const img = solid(1, 1, { r: 0, g: 0, b: 0, a: 0 });
    const result = sampleToGrid(img, 1, 1, FULL, "empty");
    expect(Array.from(result.rgb)).toEqual([0, 0, 0]);
    expect(Array.from(result.alpha)).toEqual([0]);
  });

  it("阈值向量：127 为空，128 不为空（严格小于 128）", () => {
    expect(EMPTY_ALPHA_THRESHOLD).toBe(128);
    const below = sampleToGrid(solid(1, 1, { r: 50, g: 60, b: 70, a: 127 }), 1, 1, FULL, "empty");
    const at = sampleToGrid(solid(1, 1, { r: 50, g: 60, b: 70, a: 128 }), 1, 1, FULL, "empty");
    expect(Array.from(below.alpha)).toEqual([0]);
    expect(Array.from(at.alpha)).toEqual([128]);
    // 半透明格的颜色取可见内容的直色，不被 alpha 压暗。
    expect(Array.from(at.rgb)).toEqual([50, 60, 70]);
  });

  it("V6: 半透明红 + 白色背景合成 → 精确值", () => {
    const img = solid(1, 1, { r: 255, g: 0, b: 0, a: 128 });
    const result = sampleToGrid(img, 1, 1, FULL, "background", "#FFFFFF");
    // 1.1 起合成在线性光空间进行：50.2% 红 + 49.8% 白的物理混合结果。
    // sRGB 直接合成 (255,127,127) 偏暗；线性合成后编码回 sRGB 为 (255,187,187)。
    expect(Array.from(result.rgb)).toEqual([255, 187, 187]);
    expect(Array.from(result.alpha)).toEqual([128]);
  });
});

describe("sampleToGrid · 非整数比例", () => {
  const crop = { x: 0, y: 0, width: 7, height: 5 };

  it("V4: 源 7×5 → 网格 3×2，每格权重归一化且无 0 面积", () => {
    for (let cy = 0; cy < 2; cy += 1) {
      for (let cx = 0; cx < 3; cx += 1) {
        const coverage = computeCellCoverage(7, 5, 3, 2, crop, cx, cy);
        expect(coverage.nearestFallback).toBe(false);
        expect(coverage.spans.length).toBeGreaterThan(0);
        const total = coverage.spans.reduce((sum, span) => sum + span.weight, 0);
        for (const span of coverage.spans) {
          expect(span.weight).toBeGreaterThan(0);
        }
        expect(total).toBeGreaterThan(0);
        expect(Math.abs(total / coverage.regionArea - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it("V4: 非整数比例下恒色图不产生亮度漂移", () => {
    const img = solid(7, 5, { r: 123, g: 123, b: 123, a: 255 });
    const result = sampleToGrid(img, 3, 2, crop, "empty");
    expect(Array.from(result.rgb)).toEqual(new Array(18).fill(123));
    expect(Array.from(result.alpha)).toEqual(new Array(6).fill(255));
  });
});

describe("sampleToGrid · 放大退化", () => {
  it("V5: 1×1 源图 → 3×2 网格，全部退化为最近单像素", () => {
    const img = solid(1, 1, { r: 200, g: 100, b: 50, a: 255 });
    const result = sampleToGrid(img, 3, 2, FULL, "empty");
    expect(Array.from(result.rgb)).toEqual([
      200, 100, 50, 200, 100, 50, 200, 100, 50, 200, 100, 50, 200, 100, 50, 200, 100, 50,
    ]);
    expect(Array.from(result.alpha)).toEqual([255, 255, 255, 255, 255, 255]);
    const coverage = computeCellCoverage(1, 1, 3, 2, FULL, 1, 1);
    expect(coverage.nearestFallback).toBe(true);
    expect(coverage.spans).toHaveLength(1);
    expect(coverage.spans[0]?.weight).toBe(1);
  });
});

describe("sampleToGrid · 输入守卫", () => {
  const img = solid(2, 2, { r: 0, g: 0, b: 0, a: 255 });

  it("crop 越界 → INVALID_CROP", () => {
    expectCode("INVALID_CROP", () =>
      sampleToGrid(img, 1, 1, { x: 0, y: 0, width: 3, height: 2 }, "empty"),
    );
  });

  it("crop 宽高为 0 → INVALID_CROP", () => {
    expectCode("INVALID_CROP", () =>
      sampleToGrid(img, 1, 1, { x: 0, y: 0, width: 0, height: 2 }, "empty"),
    );
  });

  it("网格非正整数 → INVALID_GRID", () => {
    expectCode("INVALID_GRID", () =>
      sampleToGrid(img, 0, 1, { x: 0, y: 0, width: 2, height: 2 }, "empty"),
    );
  });

  it("background 缺少 backgroundHex → INVALID_BACKGROUND", () => {
    expectCode("INVALID_BACKGROUND", () =>
      sampleToGrid(img, 1, 1, { x: 0, y: 0, width: 2, height: 2 }, "background"),
    );
  });

  it("非法 alphaPolicy → INVALID_ALPHA_POLICY", () => {
    expectCode("INVALID_ALPHA_POLICY", () =>
      sampleToGrid(
        img,
        1,
        1,
        { x: 0, y: 0, width: 2, height: 2 },
        "keep" as unknown as AlphaPolicy,
      ),
    );
  });

  it("ImageData 长度不匹配 → INVALID_IMAGE", () => {
    const broken = { width: 2, height: 2, data: new Uint8ClampedArray(3) } as unknown as ImageData;
    expectCode("INVALID_IMAGE", () =>
      sampleToGrid(broken, 1, 1, { x: 0, y: 0, width: 2, height: 2 }, "empty"),
    );
  });
});
