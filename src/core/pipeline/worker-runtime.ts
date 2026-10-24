/**
 * S10 · Worker 运行时（可在真实 Worker 与测试 mock postMessage 之间共用）。
 */

import { generatePattern } from "./generate";
import { wrapPipelineError } from "./errors";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { transferableDone } from "./protocol";

export type PostResponse = (message: WorkerResponse, transfer?: Transferable[]) => void;

export function createWorkerRuntime(post: PostResponse) {
  let runningTaskId = 0;
  let cancelledTaskId = 0;

  return {
    handle(raw: unknown): void {
      const message = raw as WorkerRequest;
      if (message === null || typeof message !== "object" || typeof message.type !== "string") {
        return;
      }

      if (message.type === "cancel") {
        cancelledTaskId = message.taskId;
        return;
      }

      if (message.type !== "generate") return;

      const { taskId, payload } = message;
      runningTaskId = taskId;

      try {
        const result = generatePattern(payload, {
          onProgress: (progress) => {
            post({
              type: "progress",
              taskId,
              stage: progress.stage,
              done: progress.done,
              total: progress.total,
            });
          },
          shouldCancel: () => cancelledTaskId === taskId && runningTaskId === taskId,
        });

        if (cancelledTaskId === taskId) {
          post({
            type: "error",
            taskId,
            code: "E_CANCELLED",
            message: "generation cancelled",
          });
          return;
        }

        const packed = transferableDone({
          type: "done",
          taskId,
          pattern: result.pattern,
          diagnostic: result.diagnostic,
          stats: result.stats,
        });
        post(packed.message, packed.transfer);
      } catch (error) {
        const wrapped = wrapPipelineError(error);
        post({
          type: "error",
          taskId,
          code: wrapped.code,
          message: wrapped.message,
        });
      }
    },
  };
}
