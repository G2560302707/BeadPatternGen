import { describe, expect, it } from "vitest";
import { preprocessForModel, preprocessRgbaToChw } from "./preprocess";
import type { RgbaImage, SegmentationModelSpec } from "./types";

function image(width: number, height: number, pixels: number[][]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((pixel, index) => {
    data.set(pixel as number[], index * 4);
  });
  return { width, height, data };
}

const IDENTITY_MEAN = [0, 0, 0] as const;
const IDENTITY_STD = [1, 1, 1] as const;

describe("preprocessRgbaToChw", () => {
  it("保持 1:1 尺寸，输出 CHW 布局并在白底合成 alpha", () => {
    const source = image(2, 2, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ]);

    const out = preprocessRgbaToChw(source, 2, 2, IDENTITY_MEAN, IDENTITY_STD);

    // R 平面
    expect(Array.from(out.slice(0, 4))).toEqual([1, 0, 0, 1]);
    // G 平面
    expect(Array.from(out.slice(4, 8))).toEqual([0, 1, 0, 1]);
    // B 平面
    expect(Array.from(out.slice(8, 12))).toEqual([0, 0, 1, 1]);
  });

  it("全透明像素合成到白底，而不是黑色", () => {
    const source = image(1, 1, [[0, 0, 0, 0]]);
    const out = preprocessRgbaToChw(source, 1, 1, IDENTITY_MEAN, IDENTITY_STD);
    expect(out[0]).toBeCloseTo(1);
    expect(out[1]).toBeCloseTo(1);
    expect(out[2]).toBeCloseTo(1);
  });

  it("半透明像素按 alpha 与白色混合", () => {
    const source = image(1, 1, [[0, 0, 0, 128]]);
    const out = preprocessRgbaToChw(source, 1, 1, IDENTITY_MEAN, IDENTITY_STD);
    expect(out[0]).toBeCloseTo(0.5, 2);
  });

  it("双线性降采样得到面积平均值", () => {
    const source = image(
      4,
      4,
      Array.from({ length: 16 }, () => [200, 200, 200, 255]),
    );
    const out = preprocessRgbaToChw(source, 1, 1, IDENTITY_MEAN, IDENTITY_STD);
    expect(out[0]).toBeCloseTo(200 / 255, 5);
  });

  it("应用 mean / std 归一化", () => {
    const source = image(1, 1, [[255, 128, 0, 255]]);
    const out = preprocessRgbaToChw(source, 1, 1, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    expect(out[0]).toBeCloseTo(1);
    expect(out[1]).toBeCloseTo((128 / 255 - 0.5) / 0.5, 5);
    expect(out[2]).toBeCloseTo(-1);
  });

  it("拒绝长度不正确的像素数组", () => {
    const broken: RgbaImage = { width: 2, height: 2, data: new Uint8ClampedArray(4) };
    expect(() => preprocessRgbaToChw(broken, 1, 1, IDENTITY_MEAN, IDENTITY_STD)).toThrow(
      /width\*height\*4/,
    );
  });

  it("preprocessForModel 使用模型清单里的尺寸与参数", () => {
    const model: SegmentationModelSpec = {
      id: "test",
      version: "1",
      license: "Apache-2.0",
      upstream: "https://example.invalid",
      sourceUrl: "https://example.invalid/model.onnx",
      fileName: "model.onnx",
      sha256: "0".repeat(64),
      byteLength: 1,
      inputWidth: 2,
      inputHeight: 2,
      mean: [0, 0, 0],
      std: [1, 1, 1],
      outputIndex: 0,
    };
    const source = image(
      2,
      2,
      Array.from({ length: 4 }, () => [255, 255, 255, 255]),
    );
    const out = preprocessForModel(source, model);
    expect(out).toHaveLength(12);
    expect(Array.from(out)).toEqual(Array.from({ length: 12 }, () => 1));
  });
});
