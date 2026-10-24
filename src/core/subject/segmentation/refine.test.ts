import { describe, expect, it } from "vitest";
import {
  REFINE_MIN_RESOLUTION_GAIN,
  cropRgbaImage,
  mergeMaskRegion,
  planRefineCrop,
} from "./refine";

describe("planRefineCrop", () => {
  it("plans a crop with margin for a small subject", () => {
    const plan = planRefineCrop({ x: 100, y: 100, width: 100, height: 100 }, 800, 600);
    expect(plan).not.toBeNull();
    // 外扩 12%：100 + 2×12 = 124。
    expect(plan?.crop).toEqual({ x: 88, y: 88, width: 124, height: 124 });
    expect(plan?.gain).toBeGreaterThanOrEqual(REFINE_MIN_RESOLUTION_GAIN);
  });

  it("clamps the crop to image bounds", () => {
    // margin = round(40 × 0.12) = 5，宽高 40 + 2×5 = 50。
    const plan = planRefineCrop({ x: 0, y: 0, width: 40, height: 40 }, 100, 100);
    expect(plan?.crop).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });

  it("skips refinement when bbox covers most of the image", () => {
    const plan = planRefineCrop({ x: 0, y: 0, width: 300, height: 300 }, 320, 320);
    expect(plan).toBeNull();
  });

  it("skips refinement when resolution gain is too small", () => {
    // bbox 占 90% 短边：增益 ≈ 1.1，低于阈值。
    const plan = planRefineCrop({ x: 0, y: 0, width: 540, height: 540 }, 600, 600);
    expect(plan).toBeNull();
  });

  it("rejects degenerate inputs", () => {
    expect(planRefineCrop({ x: 0, y: 0, width: 0, height: 10 }, 100, 100)).toBeNull();
    expect(planRefineCrop({ x: 0, y: 0, width: 10, height: 10 }, 0, 100)).toBeNull();
  });
});

describe("cropRgbaImage", () => {
  it("crops rows without sharing the underlying buffer", () => {
    const image = {
      width: 4,
      height: 4,
      data: new Uint8ClampedArray(64),
    };
    for (let i = 0; i < 64; i += 1) image.data[i] = i;
    const crop = cropRgbaImage(image, { x: 1, y: 1, width: 2, height: 2 });
    expect(crop.width).toBe(2);
    expect(crop.height).toBe(2);
    // (1,1) 行首 = (1*4+1)*4 = 20。
    expect(Array.from(crop.data.slice(0, 4))).toEqual([20, 21, 22, 23]);
    crop.data[0] = 255;
    expect(image.data[20]).toBe(20);
  });

  it("throws on out-of-bounds crops", () => {
    const image = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
    expect(() => cropRgbaImage(image, { x: 1, y: 1, width: 2, height: 2 })).toThrow(/超出/);
    expect(() => cropRgbaImage(image, { x: -1, y: 0, width: 1, height: 1 })).toThrow(/越界/);
  });
});

describe("mergeMaskRegion", () => {
  it("replaces only the crop region and keeps the rest", () => {
    const base = new Uint8ClampedArray(16).fill(10);
    const region = new Uint8ClampedArray(4).fill(200);
    const merged = mergeMaskRegion(base, region, 4, { x: 1, y: 1, width: 2, height: 2 });
    expect(merged[0]).toBe(10);
    expect(merged[5]).toBe(200);
    expect(merged[10]).toBe(200);
    expect(merged[15]).toBe(10);
    // 不改入参。
    expect(base[5]).toBe(10);
  });
});
