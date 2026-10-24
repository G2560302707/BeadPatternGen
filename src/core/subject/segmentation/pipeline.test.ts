import { describe, expect, it } from "vitest";
import { SegmentationError } from "./errors";
import { runSegmentation } from "./pipeline";
import type { RgbaImage, SegmentationModelSpec, SegmentationSession } from "./types";

const MODEL: SegmentationModelSpec = {
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
};

function image(width = 4, height = 4): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { width, height, data };
}

function centerOutput(): Float32Array {
  const output = new Float32Array(16);
  output[5] = 1;
  output[6] = 1;
  output[9] = 1;
  output[10] = 1;
  return output;
}

function session(
  run: () => Promise<Float32Array> = async () => centerOutput(),
): SegmentationSession {
  return { provider: "wasm", run };
}

const BASE = {
  image: image(),
  sourceImageId: "img-1",
  model: MODEL,
  candidateId: () => "candidate-1",
  now: () => "2026-10-24T00:00:00.000Z",
};

describe("runSegmentation", () => {
  it("输出候选主体，并按阶段上报进度", async () => {
    const progress: string[] = [];
    const candidate = await runSegmentation({
      ...BASE,
      session: session(),
      onProgress: (stage, done, total) => progress.push(`${stage}:${done}/${total}`),
    });

    expect(candidate.id).toBe("candidate-1");
    expect(candidate.sourceImageId).toBe("img-1");
    expect(candidate.label).toBe("main-subject");
    expect(candidate.mask.model.id).toBe("u2netp");
    expect(candidate.bbox).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(candidate.createdAt).toBe("2026-10-24T00:00:00.000Z");
    expect(progress).toEqual([
      "preprocess:0/1",
      "preprocess:1/1",
      "inference:0/1",
      "inference:1/1",
      "postprocess:0/1",
      "postprocess:1/1",
    ]);
  });

  it("开始前取消，抛 E_CANCELLED 且不调用模型", async () => {
    let called = false;
    try {
      await runSegmentation({
        ...BASE,
        session: session(async () => {
          called = true;
          return centerOutput();
        }),
        shouldCancel: () => true,
      });
      throw new Error("应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(SegmentationError);
      expect((error as SegmentationError).code).toBe("E_CANCELLED");
    }
    expect(called).toBe(false);
  });

  it("推理异常转成 E_INFERENCE_FAILED", async () => {
    await expect(
      runSegmentation({
        ...BASE,
        session: session(async () => {
          throw new Error("wasm OOM");
        }),
      }),
    ).rejects.toMatchObject({ code: "E_INFERENCE_FAILED", message: "wasm OOM" });
  });

  it("前景占比过低时抛 E_NO_SUBJECT", async () => {
    const output = new Float32Array(16);
    output[0] = 1;
    await expect(
      runSegmentation({ ...BASE, session: session(async () => output), minForegroundRatio: 0.5 }),
    ).rejects.toMatchObject({ code: "E_NO_SUBJECT" });
  });

  it("输入非法时抛 E_INPUT_INVALID 且不可重试", async () => {
    try {
      await runSegmentation({
        ...BASE,
        image: { width: 4, height: 4, data: new Uint8ClampedArray(3) },
        session: session(),
      });
      throw new Error("应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(SegmentationError);
      expect((error as SegmentationError).code).toBe("E_INPUT_INVALID");
      expect((error as SegmentationError).recoverable).toBe(false);
    }
  });

  it("sourceImageId 为空时拒绝", async () => {
    await expect(
      runSegmentation({ ...BASE, sourceImageId: "", session: session() }),
    ).rejects.toMatchObject({ code: "E_INPUT_INVALID", recoverable: false });
  });
});
