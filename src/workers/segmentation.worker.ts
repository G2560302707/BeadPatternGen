/**
 * C4 · 主体分割 Worker 入口。
 *
 * 协议见 `src/core/subject/types.ts`（`SegmentationWorkerRequest / Response`）。
 * 主线程通过 `src/workers/segmentation-client.ts` 调用，不直接拼消息。
 */

import {
  SEGMENTATION_MODEL_CACHE_NAME,
  segmentationModelPath,
} from "../core/subject/segmentation/models";
import type { SegmentationWorkerResponse } from "../core/subject/types";
import { decodeImageToRgba } from "./segmentation/decode";
import { loadModelBytes } from "./segmentation/model-loader";
import { createOrtSession } from "./segmentation/ort-session";
import { createSegmentationWorkerRuntime } from "./segmentation/runtime";

interface WorkerPost {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}

const scope = globalThis as unknown as WorkerPost;

const base = import.meta.env.BASE_URL;
const absoluteBase = new URL(base.endsWith("/") ? base : `${base}/`, self.location.origin).href;
const preferWebGPU = import.meta.env.VITE_SEGMENTATION_WEBGPU === "1";

const runtime = createSegmentationWorkerRuntime({
  post(message: SegmentationWorkerResponse, transfer?: Transferable[]) {
    if (transfer && transfer.length > 0) {
      scope.postMessage(message, transfer);
    } else {
      scope.postMessage(message);
    }
  },
  loadModelBytes(spec, hooks) {
    return loadModelBytes({
      url: new URL(`${absoluteBase}${segmentationModelPath(spec)}`, self.location.origin).href,
      cacheName: SEGMENTATION_MODEL_CACHE_NAME,
      byteLength: spec.byteLength,
      sha256: spec.sha256,
      signal: hooks.signal,
      onProgress: hooks.onProgress,
    });
  },
  createSession(bytes, spec) {
    return createOrtSession(bytes, spec, {
      baseUrl: absoluteBase,
      preferWebGPU,
    }).then((session) => {
      // R9 · 冒烟用：DevTools 控制台里确认实际走的执行后端。
      console.info(
        `[segmentation] 推理后端 provider=${session.provider}${
          preferWebGPU ? "（已请求 WebGPU，失败自动回退 WASM）" : "（WASM 默认路径）"
        }`,
      );
      return session;
    });
  },
  decodeImage: decodeImageToRgba,
});

onmessage = (event: MessageEvent<unknown>) => {
  runtime.handle(event.data);
};
