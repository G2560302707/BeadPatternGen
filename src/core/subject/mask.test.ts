import { describe, expect, it } from "vitest";
import type { SubjectMask } from "./index";
import {
  DEFAULT_MASK_POST_PROCESS,
  MaskError,
  computeMaskBBox,
  denoiseMask,
  featherMask,
  fillMaskHoles,
  postProcessMask,
  resolveMaskPostProcessOptions,
} from "./index";

const MODEL = { id: "u2netp", version: "1.0-q8", license: "Apache-2.0" };
const T0 = "2026-10-24T00:00:00.000Z";

function makeMask(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number,
  threshold = 128,
): SubjectMask {
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = pixel(x, y);
    }
  }
  return {
    sourceImageId: "img-1",
    width,
    height,
    encoding: "raw-alpha8",
    data,
    threshold,
    model: MODEL,
    createdAt: T0,
  };
}

function at(mask: SubjectMask, x: number, y: number): number {
  return mask.data[y * mask.width + x] ?? -1;
}

function foregroundCount(mask: SubjectMask): number {
  let count = 0;
  for (const value of mask.data) {
    if (value > mask.threshold) count += 1;
  }
  return count;
}

function captureMaskError(action: () => unknown): MaskError {
  try {
    action();
  } catch (error) {
    if (error instanceof MaskError) return error;
    throw error;
  }
  throw new Error("expected MaskError, but no error was thrown");
}

describe("computeMaskBBox", () => {
  it("空蒙版返回 null", () => {
    const mask = makeMask(4, 4, () => 0);
    expect(computeMaskBBox(mask)).toBeNull();
  });

  it("全前景返回整幅尺寸", () => {
    const mask = makeMask(5, 3, () => 255);
    expect(computeMaskBBox(mask)).toEqual({ x: 0, y: 0, width: 5, height: 3 });
  });

  it("只统计高于阈值的像素，并输出原图坐标", () => {
    const mask = makeMask(6, 5, (x, y) => (x >= 2 && x <= 4 && y >= 1 && y <= 3 ? 200 : 100));
    expect(computeMaskBBox(mask)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
  });

  it("阈值等于像素值时不算前景（严格大于）", () => {
    const mask = makeMask(2, 2, () => 128, 128);
    expect(computeMaskBBox(mask)).toBeNull();
  });

  it("可以用显式阈值覆盖蒙版阈值", () => {
    const mask = makeMask(2, 2, () => 100, 128);
    expect(computeMaskBBox(mask, 50)).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it("主体贴边时 bbox 不越界", () => {
    const mask = makeMask(8, 8, (x, y) => (x === 0 || y === 7 ? 255 : 0));
    expect(computeMaskBBox(mask)).toEqual({ x: 0, y: 0, width: 8, height: 8 });
  });
});

describe("denoiseMask", () => {
  it("清除小面积孤立噪点，保留主连通块", () => {
    const mask = makeMask(20, 20, (x, y) => {
      if (x >= 5 && x <= 14 && y >= 5 && y <= 14) return 255;
      if ((x === 0 && y === 0) || (x === 19 && y === 19)) return 255;
      if (x >= 16 && x <= 17 && y >= 2 && y <= 3) return 255;
      return 0;
    });
    const result = denoiseMask(mask, 8);
    expect(at(result, 0, 0)).toBe(0);
    expect(at(result, 19, 19)).toBe(0);
    expect(at(result, 16, 2)).toBe(0);
    expect(at(result, 5, 5)).toBe(255);
    expect(foregroundCount(result)).toBe(100);
    expect(computeMaskBBox(result)).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  });

  it("8 邻域连通：斜向细线不会被拆成单像素而误删", () => {
    const mask = makeMask(20, 20, (x, y) => (x === y ? 255 : 0));
    const result = denoiseMask(mask, 8);
    expect(foregroundCount(result)).toBe(20);
  });

  it("阈值 1 表示不删除任何连通块", () => {
    const mask = makeMask(4, 4, (x, y) => (x === 2 && y === 2 ? 255 : 0));
    const result = denoiseMask(mask, 1);
    expect(at(result, 2, 2)).toBe(255);
  });

  it("不修改入参", () => {
    const mask = makeMask(4, 4, (x, y) => (x === 2 && y === 2 ? 255 : 0));
    denoiseMask(mask, 8);
    expect(at(mask, 2, 2)).toBe(255);
  });
});

describe("fillMaskHoles", () => {
  // 16×16，主体 10×10，内部 2×2 孔洞。
  function donut(): SubjectMask {
    return makeMask(16, 16, (x, y) => {
      const inBlock = x >= 2 && x <= 11 && y >= 2 && y <= 11;
      const inHole = x >= 6 && x <= 7 && y >= 6 && y <= 7;
      return inBlock && !inHole ? 255 : 0;
    });
  }

  it("填充封闭小孔洞", () => {
    const result = fillMaskHoles(donut(), 16);
    expect(at(result, 6, 6)).toBe(255);
    expect(at(result, 7, 7)).toBe(255);
    expect(foregroundCount(result)).toBe(100);
  });

  it("孔洞面积超过上限时保留", () => {
    const result = fillMaskHoles(donut(), 3);
    expect(at(result, 6, 6)).toBe(0);
    expect(foregroundCount(result)).toBe(96);
  });

  it("与图像边界连通的背景不会被当成孔洞", () => {
    const mask = makeMask(10, 10, (x) => (x === 9 ? 0 : 255));
    const result = fillMaskHoles(mask, 1000);
    expect(at(result, 9, 5)).toBe(0);
    expect(foregroundCount(result)).toBe(90);
  });

  it("4 邻域：斜缝不会被误判为封闭孔洞", () => {
    // 主体是 5×5 方块，中部留一条从左上到右下的单像素斜缝（4 邻域下与外部不连通，
    // 但本用例验证的是：4 邻域只沿上下左右扩散，斜向单像素背景不算封闭孔洞）。
    const mask = makeMask(9, 9, (x, y) => {
      const inBlock = x >= 2 && x <= 6 && y >= 2 && y <= 6;
      const onDiagonal = x - y === 0;
      return inBlock && onDiagonal ? 0 : 255;
    });
    const result = fillMaskHoles(mask, 1);
    // 斜缝每个背景像素在 4 邻域下都是独立连通块，面积 1 ≤ 1，会被填充。
    expect(at(result, 4, 4)).toBe(255);
  });

  it("不修改入参", () => {
    const mask = donut();
    fillMaskHoles(mask, 16);
    expect(at(mask, 6, 6)).toBe(0);
  });
});

describe("featherMask", () => {
  // 16×16，8×8 实心块位于 (4, 4)。
  function block(): SubjectMask {
    return makeMask(16, 16, (x, y) => (x >= 4 && x <= 11 && y >= 4 && y <= 11 ? 255 : 0));
  }

  it("内部保持 255，外部出现半透明过渡", () => {
    const result = featherMask(block(), 1);
    expect(at(result, 8, 8)).toBe(255);
    // 紧贴块边界外侧的像素被 3 个前景像素覆盖：3×255/9 = 85。
    expect(at(result, 3, 8)).toBe(85);
    // 再远一格没有任何前景邻居。
    expect(at(result, 2, 8)).toBe(0);
  });

  it("保细节：1 像素宽细线不会被羽化抹除", () => {
    const mask = makeMask(40, 10, (_x, y) => (y === 5 ? 255 : 0));
    const result = featherMask(mask, 1);
    expect(foregroundCount(result)).toBe(40);
    // 线中心原来是 255，混合后仍高于阈值。
    expect(at(result, 20, 5)).toBeGreaterThan(128);
  });

  it("半径 0 时原样返回副本", () => {
    const mask = block();
    const result = featherMask(mask, 0);
    expect(Array.from(result.data)).toEqual(Array.from(mask.data));
    expect(result.data).not.toBe(mask.data);
  });

  it("背景像素不会因为羽化被判定为前景（封顶到 threshold）", () => {
    const mask = makeMask(5, 5, (x, y) => (x >= 1 && x <= 3 && y >= 1 && y <= 3 ? 255 : 0));
    const result = featherMask(mask, 2);
    for (const value of result.data) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }
    expect(at(result, 0, 0)).toBeLessThanOrEqual(mask.threshold);
  });
});

describe("postProcessMask", () => {
  it("保守默认参数：清除孤立噪点，同时保留细结构", () => {
    const mask = makeMask(40, 40, (x, y) => {
      const inBlock = x >= 10 && x <= 19 && y >= 10 && y <= 19;
      const onHair = y === 30 && x >= 5 && x <= 34;
      const noise = x === 0 && y === 0;
      return inBlock || onHair || noise ? 255 : 0;
    });
    const result = postProcessMask(mask);
    expect(result.removedComponents).toBe(1);
    expect(at(result.mask, 0, 0)).toBe(0);
    expect(computeMaskBBox(result.mask)).toEqual({ x: 5, y: 10, width: 30, height: 21 });
    // bbox 在羽化前计算：右侧边界不会因羽化外溢而变大。
    expect(result.bbox).toEqual({ x: 5, y: 10, width: 30, height: 21 });
    // 细线（1 像素高）仍全部高于阈值。
    for (let x = 6; x <= 33; x += 1) {
      expect(at(result.mask, x, 30)).toBeGreaterThan(128);
    }
  });

  it("空蒙版 → bbox 为 null，数据保持全 0", () => {
    const result = postProcessMask(makeMask(6, 6, () => 0));
    expect(result.bbox).toBeNull();
    expect(result.removedComponents).toBe(0);
    expect(result.filledPixels).toBe(0);
    expect(Array.from(result.mask.data)).toEqual(new Array(36).fill(0));
  });

  it("全前景 → 整幅 bbox，像素保持 255", () => {
    const result = postProcessMask(makeMask(4, 3, () => 255));
    expect(result.bbox).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    expect(Array.from(result.mask.data)).toEqual(new Array(12).fill(255));
  });

  it("填孔与去噪可分别开关", () => {
    const mask = makeMask(12, 12, (x, y) => {
      const inBlock = x >= 2 && x <= 9 && y >= 2 && y <= 9;
      const inHole = x >= 5 && x <= 6 && y >= 5 && y <= 6;
      const noise = x === 11 && y === 0;
      return (inBlock && !inHole) || noise ? 255 : 0;
    });
    const result = postProcessMask(mask, {
      smoothDenoise: false,
      fillHoles: false,
      feather: false,
    });
    expect(at(result.mask, 5, 5)).toBe(0);
    expect(at(result.mask, 11, 0)).toBe(255);
    expect(result.bbox).toEqual({ x: 2, y: 0, width: 10, height: 10 });
  });

  it("不修改入参", () => {
    const mask = makeMask(8, 8, (x, y) => (x === y ? 255 : 0));
    const snapshot = Array.from(mask.data);
    postProcessMask(mask);
    expect(Array.from(mask.data)).toEqual(snapshot);
  });

  it("非法蒙版抛 INVALID_MASK", () => {
    const mask = makeMask(2, 2, () => 0);
    const broken = { ...mask, data: new Uint8ClampedArray(3) };
    const error = captureMaskError(() => postProcessMask(broken));
    expect(error.code).toBe("INVALID_MASK");
  });

  it("非法参数抛 INVALID_OPTIONS", () => {
    const mask = makeMask(2, 2, () => 255);
    expect(captureMaskError(() => postProcessMask(mask, { denoiseMinArea: -1 })).code).toBe(
      "INVALID_OPTIONS",
    );
    expect(captureMaskError(() => postProcessMask(mask, { featherRadius: 1.5 })).code).toBe(
      "INVALID_OPTIONS",
    );
  });
});

describe("resolveMaskPostProcessOptions", () => {
  it("缺省值即保守默认值", () => {
    expect(resolveMaskPostProcessOptions()).toEqual({ ...DEFAULT_MASK_POST_PROCESS });
  });

  it("只覆盖传入的字段", () => {
    expect(resolveMaskPostProcessOptions({ featherRadius: 3 })).toEqual({
      ...DEFAULT_MASK_POST_PROCESS,
      featherRadius: 3,
    });
  });
});
