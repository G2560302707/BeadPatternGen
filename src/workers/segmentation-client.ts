/**
 * C4 · 分割 Worker 的主线程客户端。
 *
 * 职责：创建 Worker、生成 taskId、校验响应、把协议错误转成 `SegmentationError`。
 * C6 的 `detectSubjects` 直接用这个客户端；UI 不需要理解 postMessage 细节。
 *
 * 注意：`segment()` 会复制一份图片字节再转移给 Worker，
 * 调用方的 `imageBytes` 不会被 detach，可以安全地重复识别 / 后续构图。
 */

import { createMessageGate } from "../core/pipeline/protocol";
import {
  SegmentationError,
  cancelledError,
  isSegmentationErrorCode,
} from "../core/subject/segmentation/errors";
import { isSegmentationWorkerResponse } from "../core/subject/guards";
import type {
  SegmentationInput,
  SegmentationProgressResponse,
  SubjectCandidate,
} from "../core/subject/types";

export interface SegmentCallbacks {
  onProgress?: (progress: SegmentationProgressResponse) => void;
}

export interface SegmentationClientOptions {
  /** 测试或自定义打包方式时注入。 */
  workerFactory?: () => Worker;
}

interface PendingTask {
  taskId: number;
  resolve: (candidates: SubjectCandidate[]) => void;
  reject: (error: Error) => void;
  callbacks: SegmentCallbacks;
}

/** 默认 Worker 工厂：Vite 会把 `segmentation.worker.ts` 打成独立模块。 */
export function createBrowserSegmentationWorker(): Worker {
  return new Worker(new URL("./segmentation.worker.ts", import.meta.url), { type: "module" });
}

export class SegmentationClient {
  private readonly worker: Worker;
  private readonly gate = createMessageGate();
  private pending: PendingTask | null = null;
  private disposed = false;

  constructor(options: SegmentationClientOptions = {}) {
    this.worker = options.workerFactory?.() ?? createBrowserSegmentationWorker();
    this.worker.onmessage = (event: MessageEvent<unknown>) => this.handleMessage(event.data);
    this.worker.onerror = (event: ErrorEvent) => {
      this.failPending(
        new SegmentationError(
          "E_INFERENCE_FAILED",
          event.message
            ? `分割 Worker 崩溃：${event.message}`
            : "分割 Worker 崩溃（可能是浏览器内存不足）",
          true,
        ),
      );
    };
  }

  /** 执行一次识别。重复调用会取消未完成的上一次任务。 */
  segment(input: SegmentationInput, callbacks: SegmentCallbacks = {}): Promise<SubjectCandidate[]> {
    if (this.disposed) {
      return Promise.reject(
        new SegmentationError("E_INFERENCE_FAILED", "SegmentationClient 已释放", false),
      );
    }
    if (this.pending) {
      this.cancel();
    }

    const taskId = this.gate.nextTaskId();
    const bytes = new Uint8Array(input.imageBytes);

    return new Promise<SubjectCandidate[]>((resolve, reject) => {
      this.pending = { taskId, resolve, reject, callbacks };
      const transfer: Transferable[] = [bytes.buffer];
      this.worker.postMessage(
        {
          type: "segment-subject",
          taskId,
          payload: { ...input, imageBytes: bytes },
        },
        transfer,
      );
    });
  }

  /** 取消当前任务。Promise 会以 `E_CANCELLED` 拒绝。 */
  cancel(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.gate.nextTaskId();
    this.worker.postMessage({ type: "cancel", taskId: pending.taskId });
    pending.reject(cancelledError());
  }

  /** 终止 Worker；之后不可复用。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const pending = this.pending;
    this.pending = null;
    pending?.reject(cancelledError("分割客户端已释放"));
    this.worker.terminate();
  }

  private failPending(error: SegmentationError): void {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }

  private handleMessage(raw: unknown): void {
    if (!isSegmentationWorkerResponse(raw)) return;
    const accepted = this.gate.accept(raw);
    if (accepted === null) return;

    const pending = this.pending;
    if (!pending || pending.taskId !== accepted.taskId) return;

    if (accepted.type === "progress") {
      pending.callbacks.onProgress?.(accepted);
      return;
    }

    this.pending = null;
    if (accepted.type === "done") {
      pending.resolve(accepted.candidates);
      return;
    }

    const code = isSegmentationErrorCode(accepted.code) ? accepted.code : "E_INFERENCE_FAILED";
    pending.reject(new SegmentationError(code, accepted.message, accepted.recoverable));
  }
}
