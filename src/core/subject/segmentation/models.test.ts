import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEGMENTATION_MODEL_ID,
  SEGMENTATION_MODEL_CACHE_NAME,
  SEGMENTATION_MODEL_MANIFEST,
  getSegmentationModelSpec,
  segmentationModelPath,
} from "./models";

describe("分割模型清单", () => {
  it("默认模型是 u2netp，且元数据完整", () => {
    const spec = getSegmentationModelSpec();
    expect(spec.id).toBe(DEFAULT_SEGMENTATION_MODEL_ID);
    expect(spec.id).toBe("u2netp");
    expect(spec.inputWidth).toBe(320);
    expect(spec.inputHeight).toBe(320);
    expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(spec.byteLength).toBeGreaterThan(0);
    expect(spec.license).toBe("Apache-2.0");
    expect(segmentationModelPath(spec)).toBe("models/u2netp.onnx");
  });

  it("按 id 取模型", () => {
    expect(getSegmentationModelSpec("u2netp").id).toBe("u2netp");
  });

  it("未知模型抛错，便于上层转成 E_MODEL_UNSUPPORTED", () => {
    expect(() => getSegmentationModelSpec("does-not-exist")).toThrow(/不支持的分割模型/);
  });

  it("清单里的模型 id 唯一且缓存桶名非空", () => {
    const ids = SEGMENTATION_MODEL_MANIFEST.models.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SEGMENTATION_MODEL_CACHE_NAME.length).toBeGreaterThan(0);
  });
});
