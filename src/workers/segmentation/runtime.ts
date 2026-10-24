/**
 * C4 · 分割 Worker 运行时。
 *
 * 与 `src/core/pipeline/worker-runtime.ts` 保持同一套模式：
 * taskId 闸门 + 阶段进度 + `E_CANCELLED`，并复用 C1 的 `SegmentationWorkerResponse` 协议。
 *
 * 通过依赖注入把浏览器 API（fetch / Cache Storage / ORT / OffscreenCanvas）
 * 与协议逻辑分开，测试可以在 Node 中验证加载 → 推理 → 完成 / 取消的全部分支。
 */

import { SegmentationError, wrapSegmentationError } from "../../core/subject/segmentation/errors";
import { runSegmentation } from "../../core/subject/segmentation/pipeline";
import { getSegmentationModelSpec } from "../../core/subject/segmentation/models";
import type {
  RgbaImage,
  SegmentationModelSpec,
  SegmentationSession,
} from "../../core/subject/segmentation/types";
import type {
  SegmentationInput,
  SegmentationWorkerResponse,
  SubjectCandidate,
} from "../../core/subject/types";

export interface ModelLoadHooks {
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
}

export interface SegmentationRuntimeDeps {
  post: (message: SegmentationWorkerResponse, transfer?: Transferable[]) => void;
  loadModelBytes: (spec: SegmentationModelSpec, hooks: ModelLoadHooks) => Promise<Uint8Array>;
  createSession: (bytes: Uint8Array, spec: SegmentationModelSpec) => Promise<SegmentationSession>;
  decodeImage: (bytes: Uint8Array, mimeType: string) => Promise<RgbaImage>;
  /** 便于测试注入模型清单；默认读取 `model-manifest.json`。 */
  getModelSpec?: (modelId?: string) => SegmentationModelSpec;
  candidateId?: () => string;
  now?: () => string;
  minForegroundRatio?: number;
}

export interface SegmentationWorkerRuntime {
  handle(raw: unknown): void;
  dispose(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInput(input: SegmentationInput): void {
  if (typeof input.sourceImageId !== "string" || input.sourceImageId.length === 0) {
    throw new SegmentationError("E_INPUT_INVALID", "sourceImageId 不能为空", false);
  }
  if (!(input.imageBytes instanceof Uint8Array) || input.imageBytes.byteLength === 0) {
    throw new SegmentationError("E_INPUT_INVALID", "图片字节为空或类型不正确", false);
  }
  if (typeof input.mimeType !== "string" || input.mimeType.length === 0) {
    throw new SegmentationError("E_INPUT_INVALID", "mimeType 不能为空", false);
  }
  if (
    input.maxCandidates !== undefined &&
    (!Number.isInteger(input.maxCandidates) || input.maxCandidates < 1)
  ) {
    throw new SegmentationError("E_INPUT_INVALID", "maxCandidates 必须是正整数", false);
  }
}

function transferForCandidates(candidates: SubjectCandidate[]): Transferable[] {
  return candidates.map((candidate) => candidate.mask.data.buffer as ArrayBuffer);
}

export function createSegmentationWorkerRuntime(
  deps: SegmentationRuntimeDeps,
): SegmentationWorkerRuntime {
  const resolveModel = deps.getModelSpec ?? getSegmentationModelSpec;
  const modelBytes = new Map<string, Uint8Array>();
  const sessions = new Map<string, Promise<SegmentationSession>>();
  const controllers = new Map<number, AbortController>();

  let runningTaskId = 0;
  let cancelledTaskId = 0;
  let queue: Promise<void> = Promise.resolve();

  const isCurrent = (taskId: number): boolean => runningTaskId === taskId;
  const isActive = (taskId: number): boolean => isCurrent(taskId) && cancelledTaskId !== taskId;

  function postProgress(
    taskId: number,
    stage: "load-model" | "preprocess" | "inference" | "postprocess",
    done: number,
    total: number,
  ): void {
    if (!isActive(taskId)) return;
    deps.post({ type: "progress", taskId, stage, done, total });
  }

  async function ensureSession(
    spec: SegmentationModelSpec,
    taskId: number,
    signal: AbortSignal,
  ): Promise<SegmentationSession> {
    const key = `${spec.id}@${spec.version}`;
    const existing = sessions.get(key);
    if (existing) {
      const bytes = modelBytes.get(key);
      if (bytes) postProgress(taskId, "load-model", bytes.byteLength, bytes.byteLength);
      return existing;
    }

    const pending = (async () => {
      try {
        let bytes = modelBytes.get(key);
        if (!bytes) {
          bytes = await deps.loadModelBytes(spec, {
            signal,
            onProgress: (done, total) => postProgress(taskId, "load-model", done, total),
          });
          if (!isActive(taskId)) {
            throw new SegmentationError("E_CANCELLED", "模型加载已取消", true);
          }
          modelBytes.set(key, bytes);
        } else {
          postProgress(taskId, "load-model", bytes.byteLength, bytes.byteLength);
        }
        const session = await deps.createSession(bytes, spec);
        postProgress(taskId, "load-model", bytes.byteLength, bytes.byteLength);
        return session;
      } catch (error) {
        sessions.delete(key);
        throw error;
      }
    })();

    sessions.set(key, pending);
    return pending;
  }

  async function processSegment(taskId: number, input: SegmentationInput): Promise<void> {
    const controller = new AbortController();
    controllers.set(taskId, controller);

    try {
      validateInput(input);

      let spec: SegmentationModelSpec;
      try {
        spec = resolveModel(input.modelId);
      } catch (error) {
        throw new SegmentationError(
          "E_MODEL_UNSUPPORTED",
          error instanceof Error ? error.message : String(error),
          false,
        );
      }

      if (!isActive(taskId)) throw new SegmentationError("E_CANCELLED", "分割任务已取消", true);

      const session = await ensureSession(spec, taskId, controller.signal);
      if (!isActive(taskId)) throw new SegmentationError("E_CANCELLED", "分割任务已取消", true);

      postProgress(taskId, "preprocess", 0, 2);
      const image = await deps.decodeImage(input.imageBytes, input.mimeType);
      postProgress(taskId, "preprocess", 1, 2);

      const candidate = await runSegmentation({
        image,
        sourceImageId: input.sourceImageId,
        model: spec,
        session,
        ...(deps.minForegroundRatio === undefined
          ? {}
          : { minForegroundRatio: deps.minForegroundRatio }),
        ...(deps.candidateId === undefined ? {} : { candidateId: deps.candidateId }),
        ...(deps.now === undefined ? {} : { now: deps.now }),
        shouldCancel: () => !isActive(taskId),
        onProgress: (stage, done, total) => {
          if (stage === "preprocess") {
            postProgress(taskId, stage, 1 + done, 2);
          } else {
            postProgress(taskId, stage, done, total);
          }
        },
      });

      if (!isActive(taskId)) throw new SegmentationError("E_CANCELLED", "分割任务已取消", true);

      deps.post(
        {
          type: "done",
          taskId,
          sourceImageId: input.sourceImageId,
          candidates: [candidate],
        },
        transferForCandidates([candidate]),
      );
    } catch (error) {
      const wrapped = wrapSegmentationError(error);
      if (!isCurrent(taskId)) return;
      // 用户主动取消时也回一帧 E_CANCELLED：UI 可据此收掉"识别中"状态。
      deps.post({
        type: "error",
        taskId,
        code: wrapped.code,
        message: wrapped.message,
        recoverable: wrapped.recoverable,
      });
    } finally {
      controllers.delete(taskId);
      if (runningTaskId === taskId) runningTaskId = 0;
    }
  }

  return {
    handle(raw: unknown): void {
      if (!isRecord(raw) || typeof raw.type !== "string" || typeof raw.taskId !== "number") {
        return;
      }

      if (raw.type === "cancel") {
        cancelledTaskId = raw.taskId;
        controllers.get(raw.taskId)?.abort();
        return;
      }

      if (raw.type !== "segment-subject") return;
      const input = raw.payload;
      if (!isRecord(input)) return;

      // 新任务覆盖旧任务：旧任务的结果不再落地，模型下载也立即中止。
      if (runningTaskId !== 0 && runningTaskId !== raw.taskId) {
        cancelledTaskId = runningTaskId;
        controllers.get(runningTaskId)?.abort();
      }
      runningTaskId = raw.taskId;
      cancelledTaskId = 0;

      const taskId = raw.taskId;
      const payload = input as unknown as SegmentationInput;
      queue = queue.then(() => processSegment(taskId, payload)).catch(() => undefined);
    },

    async dispose(): Promise<void> {
      runningTaskId = 0;
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      const pending = [...sessions.values()];
      sessions.clear();
      modelBytes.clear();
      for (const session of pending) {
        try {
          const resolved = await session;
          await resolved.dispose?.();
        } catch {
          // 创建失败的会话无需释放。
        }
      }
    },
  };
}
