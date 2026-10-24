import { describe, expect, it } from "vitest";
import { SegmentationError } from "./errors";
import { maskFromModelOutput, normalizeModelOutput, resizeGrayBilinear } from "./postprocess";
import type { SegmentationModelSpec } from "./types";

const MODEL = {
  id: "u2netp",
  version: "test",
  license: "Apache-2.0",
  upstream: "https://example.invalid",
  sourceUrl: "https://example.invalid/model.onnx",
  fileName: "model.onnx",
  sha256: "0".repeat(64),
  byteLength: 1,
  inputWidth: 4,
  inputHeight: 4,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  outputIndex: 0,
} satisfies SegmentationModelSpec;

/** 4×4 显著性图，中心 2×2 为前景。 */
function centerOutput(): Float32Array {
  const output = new Float32Array(16);
  output[5] = 1;
  output[6] = 1;
  output[9] = 1;
  output[10] = 1;
  return output;
}

describe("normalizeModelOutput", () => {
  it("按全图 min-max 映射到 0–255", () => {
    const out = normalizeModelOutput(new Float32Array([-1, 0, 1, 2]));
    expect(Array.from(out)).toEqual([0, 85, 170, 255]);
  });

  it("所有值相同时返回全 0（交给上层判定无主体）", () => {
    const out = normalizeModelOutput(new Float32Array([0.5, 0.5, 0.5]));
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it("遇到 NaN 直接报错，不静默修补", () => {
    expect(() => normalizeModelOutput(new Float32Array([0, Number.NaN, 1]))).toThrow(/非有限值/);
  });

  it("拒绝空输出", () => {
    expect(() => normalizeModelOutput(new Float32Array(0))).toThrow(/为空/);
  });
});

describe("resizeGrayBilinear", () => {
  it("同尺寸复制且不共享底层数组", () => {
    const source = new Uint8ClampedArray([0, 255, 0, 255]);
    const out = resizeGrayBilinear(source, 2, 2, 2, 2);
    expect(Array.from(out)).toEqual([0, 255, 0, 255]);
    out[0] = 99;
    expect(source[0]).toBe(0);
  });

  it("放大时在像素中心之间线性插值", () => {
    const source = new Uint8ClampedArray([0, 255, 0, 255]);
    const out = resizeGrayBilinear(source, 2, 2, 4, 4);
    expect(out).toHaveLength(16);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeGreaterThan(0);
    expect(out[1]).toBeLessThan(255);
  });
});

describe("maskFromModelOutput", () => {
  it("输出原图尺寸的蒙版、有效 bbox、占比与置信度", () => {
    const result = maskFromModelOutput({
      output: centerOutput(),
      outputWidth: 4,
      outputHeight: 4,
      imageWidth: 4,
      imageHeight: 4,
      sourceImageId: "img-1",
      model: MODEL,
      createdAt: "2026-10-24T00:00:00.000Z",
    });

    expect(result.mask.width).toBe(4);
    expect(result.mask.height).toBe(4);
    expect(result.mask.sourceImageId).toBe("img-1");
    expect(result.mask.model).toEqual({ id: "u2netp", version: "test", license: "Apache-2.0" });
    expect(result.bbox).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(result.foregroundRatio).toBeCloseTo(4 / 16);
    expect(result.confidence).toBeCloseTo(1);
  });

  it("上采样回大图尺寸", () => {
    const output = new Float32Array(4);
    output[0] = 1;
    const result = maskFromModelOutput({
      output,
      outputWidth: 2,
      outputHeight: 2,
      imageWidth: 8,
      imageHeight: 8,
      sourceImageId: "img-1",
      model: { ...MODEL, inputWidth: 2, inputHeight: 2 },
      createdAt: "2026-10-24T00:00:00.000Z",
    });
    expect(result.mask.width).toBe(8);
    expect(result.mask.height).toBe(8);
    expect(result.mask.data.length).toBe(64);
  });

  it("没有前景时抛 E_NO_SUBJECT", () => {
    try {
      maskFromModelOutput({
        output: new Float32Array(16),
        outputWidth: 4,
        outputHeight: 4,
        imageWidth: 4,
        imageHeight: 4,
        sourceImageId: "img-1",
        model: MODEL,
        createdAt: "2026-10-24T00:00:00.000Z",
      });
      throw new Error("应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(SegmentationError);
      expect((error as SegmentationError).code).toBe("E_NO_SUBJECT");
    }
  });

  it("输出长度与尺寸不符时报错", () => {
    expect(() =>
      maskFromModelOutput({
        output: new Float32Array(3),
        outputWidth: 2,
        outputHeight: 2,
        imageWidth: 4,
        imageHeight: 4,
        sourceImageId: "img-1",
        model: MODEL,
        createdAt: "2026-10-24T00:00:00.000Z",
      }),
    ).toThrow(/模型输出长度/);
  });
});
