import { describe, expect, it, vi } from "vitest";
import type { SegmentationInput, SubjectCandidate } from "../core/subject/types";
import { SegmentationClient } from "./segmentation-client";

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  emitError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }

  asWorker(): Worker {
    return this as unknown as Worker;
  }
}

function input(): SegmentationInput {
  return {
    sourceImageId: "img-1",
    imageBytes: new Uint8Array([1, 2, 3]),
    mimeType: "image/png",
  };
}

function candidate(): SubjectCandidate {
  return {
    id: "candidate-1",
    sourceImageId: "img-1",
    mask: {
      sourceImageId: "img-1",
      width: 2,
      height: 2,
      encoding: "raw-alpha8",
      data: new Uint8ClampedArray(4).fill(255),
      threshold: 128,
      model: { id: "u2netp", version: "test", license: "Apache-2.0" },
      createdAt: "2026-10-24T00:00:00.000Z",
    },
    bbox: { x: 0, y: 0, width: 2, height: 2 },
    confidence: 0.9,
    label: "main-subject",
    createdAt: "2026-10-24T00:00:00.000Z",
  };
}

function setup() {
  const worker = new FakeWorker();
  const client = new SegmentationClient({ workerFactory: () => worker.asWorker() });
  return { worker, client };
}

type PostedMessage = {
  type: string;
  taskId: number;
  payload?: { imageBytes: Uint8Array };
};

function posted(
  worker: FakeWorker,
  index = 0,
): { message: PostedMessage; transfer: Transferable[] } {
  const call = worker.postMessage.mock.calls[index] as [PostedMessage, Transferable[]];
  return { message: call[0], transfer: call[1] };
}

describe("SegmentationClient", () => {
  it("发送任务并转发进度，done 后返回候选", async () => {
    const { worker, client } = setup();
    const progress = vi.fn();

    const promise = client.segment(input(), { onProgress: progress });
    const { message, transfer } = posted(worker);

    expect(message.type).toBe("segment-subject");
    expect(message.payload?.imageBytes).toBeInstanceOf(Uint8Array);
    expect(transfer).toHaveLength(1);

    const taskId = message.taskId;
    worker.emit({ type: "progress", taskId, stage: "inference", done: 0, total: 1 });
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "inference", done: 0, total: 1 }),
    );

    worker.emit({
      type: "done",
      taskId,
      sourceImageId: "img-1",
      candidates: [candidate()],
    });

    await expect(promise).resolves.toEqual([candidate()]);
  });

  it("复制图片字节再转移，调用方数组不会被 detach", async () => {
    const { worker, client } = setup();
    const payload = input();

    void client.segment(payload);
    const { message, transfer } = posted(worker);

    expect(payload.imageBytes).toHaveLength(3);
    expect(message.payload?.imageBytes).not.toBe(payload.imageBytes);
    expect(message.payload?.imageBytes.buffer).toBe(transfer[0]);
  });

  it("cancel 以 E_CANCELLED 拒绝并向 Worker 发送 cancel", async () => {
    const { worker, client } = setup();
    const promise = client.segment(input());
    const taskId = posted(worker).message.taskId;

    client.cancel();

    await expect(promise).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "cancel", taskId });
  });

  it("协议错误转成 SegmentationError 并保留可重试标记", async () => {
    const { worker, client } = setup();
    const promise = client.segment(input());
    const taskId = posted(worker).message.taskId;

    worker.emit({
      type: "error",
      taskId,
      code: "E_MODEL_LOAD_FAILED",
      message: "模型下载失败",
      recoverable: true,
    });

    await expect(promise).rejects.toMatchObject({
      code: "E_MODEL_LOAD_FAILED",
      message: "模型下载失败",
      recoverable: true,
    });
  });

  it("丢弃结构不符 / 过期 taskId 的响应", async () => {
    const { worker, client } = setup();
    const progress = vi.fn();
    const promise = client.segment(input(), { onProgress: progress });
    const taskId = posted(worker).message.taskId;

    worker.emit({ type: "progress", taskId, stage: "not-a-stage", done: 0, total: 1 });
    worker.emit({ type: "progress", taskId: taskId + 99, stage: "inference", done: 0, total: 1 });
    expect(progress).not.toHaveBeenCalled();

    worker.emit({ type: "done", taskId, sourceImageId: "img-1", candidates: [candidate()] });
    await expect(promise).resolves.toHaveLength(1);
  });

  it("Worker 崩溃时拒绝当前任务", async () => {
    const { worker, client } = setup();
    const promise = client.segment(input());

    worker.emitError("out of memory");

    await expect(promise).rejects.toMatchObject({ code: "E_INFERENCE_FAILED", recoverable: true });
  });

  it("dispose 终止 Worker", () => {
    const { worker, client } = setup();
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    return expect(client.segment(input())).rejects.toMatchObject({ code: "E_INFERENCE_FAILED" });
  });
});
