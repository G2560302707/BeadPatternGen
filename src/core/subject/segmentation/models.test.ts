import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEGMENTATION_MODEL_ID,
  SEGMENTATION_MODEL_CACHE_NAME,
  SEGMENTATION_MODEL_MANIFEST,
  getSegmentationModelSpec,
  segmentationModelPath,
} from "./models";

describe("分割模型清单", () => {
  it("默认模型是清单 defaultModelId（高精度 isnet），且元数据完整", () => {
    const spec = getSegmentationModelSpec();
    expect(spec.id).toBe(DEFAULT_SEGMENTATION_MODEL_ID);
    expect(spec.id).toBe("isnet-general-use");
    expect(spec.inputWidth).toBe(1024);
    expect(spec.inputHeight).toBe(1024);
    expect(spec.inputName).toBe("input_image");
    expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(spec.byteLength).toBeGreaterThan(0);
    expect(spec.license).toBe("Apache-2.0");
    expect(segmentationModelPath(spec)).toBe("models/isnet-general-use.onnx");
  });

  it("按 id 取模型，u2netp / silueta 沿用 u2net 预处理参数", () => {
    expect(getSegmentationModelSpec("u2netp").id).toBe("u2netp");
    const silueta = getSegmentationModelSpec("silueta");
    expect(silueta.inputWidth).toBe(320);
    expect(silueta.mean).toEqual([0.485, 0.456, 0.406]);
    expect(silueta.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("未知模型抛错，便于上层转成 E_MODEL_UNSUPPORTED", () => {
    expect(() => getSegmentationModelSpec("does-not-exist")).toThrow(/不支持的分割模型/);
  });

  it("清单里的模型 id 唯一、defaultModelId 指向其中一项、缓存桶名非空", () => {
    const ids = SEGMENTATION_MODEL_MANIFEST.models.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(SEGMENTATION_MODEL_MANIFEST.defaultModelId);
    expect(SEGMENTATION_MODEL_CACHE_NAME.length).toBeGreaterThan(0);
  });
});
