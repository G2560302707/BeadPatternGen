import { describe, expect, it } from "vitest";
import type {
  RgbaImage,
  SegmentationModelSpec,
  SegmentationSession,
} from "../../core/subject/segmentation/types";
import type { SegmentationInput, SegmentationWorkerResponse } from "../../core/subject/types";
import { createSegmentationWorkerRuntime } from "./runtime";

const SPEC: SegmentationModelSpec = {
  id: "u2netp",
  version: "test",
  license: "Apache-2.0",
  upstream: "https://example.invalid",
  sourceUrl: "https://example.invalid/model.onnx",
  fileName: "model.onnx",
  sha256: "0".repeat(64),
  byteLength: 16,
  inputWidth: 4,
  inputHeight: 4,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  outputIndex: 0,
};

const IMAGE: RgbaImage = {
  width: 4,
  height: 4,
  data: new Uint8ClampedArray(4 * 4 * 4).fill(255),
};

function centerOutput(): Float32Array {
  const output = new Float32Array(16);
  output[5] = 1;
  output[6] = 1;
  output[9] = 1;
  output[10] = 1;
  return output;
}

function input(taskId: number, overrides: Partial<SegmentationInput> = {}): unknown {
  return {
    type: "segment-subject",
    taskId,
    payload: {
      sourceImageId: "img-1",
      imageBytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      ...overrides,
    },
  };
}

async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("等待消息超时");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createHarness(options: { run?: () => Promise<Float32Array> } = {}) {
  const messages: SegmentationWorkerResponse[] = [];
  const transfers: (Transferable[] | undefined)[] = [];
  let loadCalls = 0;
  let sessionCalls = 0;
  let disposeCalls = 0;

  const session: SegmentationSession = {
    provider: "wasm",
    run: options.run ?? (async () => centerOutput()),
    async dispose() {
      disposeCalls += 1;
    },
  };

  const runtime = createSegmentationWorkerRuntime({
    post(message, transfer) {
      messages.push(message);
      transfers.push(transfer);
    },
    async loadModelBytes(_spec, hooks) {
      loadCalls += 1;
      const bytes = new Uint8Array(16);
      hooks.onProgress(bytes.byteLength, bytes.byteLength);
      return bytes;
    },
    async createSession() {
      sessionCalls += 1;
      return session;
    },
    async decodeImage() {
      return IMAGE;
    },
    getModelSpec(modelId) {
      if (modelId !== undefined && modelId !== SPEC.id)
        throw new Error(`不支持的分割模型：${modelId}`);
      return SPEC;
    },
    candidateId: () => "candidate-1",
    now: () => "2026-10-24T00:00:00.000Z",
  });

  return {
    runtime,
    messages,
    transfers,
    stats: () => ({ loadCalls, sessionCalls, disposeCalls }),
  };
}

describe("createSegmentationWorkerRuntime", () => {
  it("完成一次分割：进度阶段齐全，done 携带转移的蒙版 buffer", async () => {
    const harness = createHarness();
    harness.runtime.handle(input(1));

    await until(() => harness.messages.some((message) => message.type === "done"));

    const stages = harness.messages
      .filter((message) => message.type === "progress")
      .map((message) => message.stage);
    expect(stages).toContain("load-model");
    expect(stages).toContain("preprocess");
    expect(stages).toContain("inference");
    expect(stages).toContain("postprocess");

    const done = harness.messages.find((message) => message.type === "done");
    expect(done).toMatchObject({ type: "done", taskId: 1, sourceImageId: "img-1" });
    if (done?.type !== "done") throw new Error("缺少 done 消息");
    expect(done.candidates).toHaveLength(1);
    expect(done.candidates[0]?.bbox).toEqual({ x: 1, y: 1, width: 2, height: 2 });

    const lastTransfer = harness.transfers.at(-1);
    expect(lastTransfer).toHaveLength(1);
    expect(done.candidates[0]?.mask.data.buffer).toBe(lastTransfer?.[0]);
  });

  it("第二次识别复用模型字节与会话，不重复加载", async () => {
    const harness = createHarness();
    harness.runtime.handle(input(1));
    await until(() => harness.messages.some((message) => message.type === "done"));

    harness.runtime.handle(input(2));
    await until(() => harness.messages.filter((message) => message.type === "done").length === 2);

    expect(harness.stats()).toMatchObject({ loadCalls: 1, sessionCalls: 1 });
  });

  it("主动取消后返回 E_CANCELLED", async () => {
    let release: (value: Float32Array) => void = () => undefined;
    let started = false;
    const harness = createHarness({
      run: () => {
        started = true;
        return new Promise<Float32Array>((resolve) => {
          release = resolve;
        });
      },
    });

    harness.runtime.handle(input(3));
    await until(() => started);
    harness.runtime.handle({ type: "cancel", taskId: 3 });
    release(centerOutput());

    await until(() => harness.messages.some((message) => message.type === "error"));
    const error = harness.messages.find((message) => message.type === "error");
    expect(error).toMatchObject({ code: "E_CANCELLED", recoverable: true });
    expect(harness.messages.some((message) => message.type === "done")).toBe(false);
  });

  it("未知模型返回 E_MODEL_UNSUPPORTED 且不可重试", async () => {
    const harness = createHarness();
    harness.runtime.handle(input(4, { modelId: "nope" }));

    await until(() => harness.messages.some((message) => message.type === "error"));
    expect(harness.messages.find((message) => message.type === "error")).toMatchObject({
      code: "E_MODEL_UNSUPPORTED",
      recoverable: false,
    });
  });

  it("空图片字节返回 E_INPUT_INVALID", async () => {
    const harness = createHarness();
    harness.runtime.handle(input(5, { imageBytes: new Uint8Array(0) }));

    await until(() => harness.messages.some((message) => message.type === "error"));
    expect(harness.messages.find((message) => message.type === "error")).toMatchObject({
      code: "E_INPUT_INVALID",
      recoverable: false,
    });
  });

  it("dispose 释放会话并停止接收新任务", async () => {
    const harness = createHarness();
    harness.runtime.handle(input(6));
    await until(() => harness.messages.some((message) => message.type === "done"));

    await harness.runtime.dispose();
    expect(harness.stats().disposeCalls).toBe(1);
  });
});
