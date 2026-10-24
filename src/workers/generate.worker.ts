/**
 * S10 · 生成 Worker。协议见 src/core/pipeline/protocol.ts。
 */

import { createWorkerRuntime } from "../core/pipeline/worker-runtime";

interface WorkerPost {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}

const scope = globalThis as unknown as WorkerPost;

const runtime = createWorkerRuntime((message, transfer) => {
  if (transfer && transfer.length > 0) {
    scope.postMessage(message, transfer);
  } else {
    scope.postMessage(message);
  }
});

onmessage = (event: MessageEvent<unknown>) => {
  runtime.handle(event.data);
};
