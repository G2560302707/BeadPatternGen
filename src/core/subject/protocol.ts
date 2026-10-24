/**
 * C6 · 主体识别 / 构图任务的统一协议。
 *
 * C1/C4 的 `SegmentationWorkerRequest / Response` 只覆盖 Worker 内部的阶段：
 * `load-model → preprocess → inference → postprocess`。完整链路还要在**主线程**
 * 做 C2 蒙版后处理与 C1 落库，因此这里在其上再补两个阶段：
 *
 * ```text
 * load-model → preprocess → inference → postprocess → mask-cleanup → persist
 * ```
 *
 * 消息仍沿用 `taskId + stage + done/total` 的既有风格（见 `core/pipeline/protocol.ts`）：
 * UI 落地前必须比对 taskId，过期事件直接丢弃。
 * 本文件只放类型、常量与错误收口，不引用 DOM。
 */

import { isSegmentationError } from "./segmentation/errors";
import type { SegmentationErrorCode, SegmentationStage } from "./types";
import { SEGMENTATION_STAGE_LABELS } from "./types";

/** 二期完整链路阶段：C4 的四段 + C2 后处理 + C1 落库。 */
export type SubjectPipelineStage = SegmentationStage | "mask-cleanup" | "persist";

export const SUBJECT_PIPELINE_STAGE_LABELS: Record<SubjectPipelineStage, string> = {
  ...SEGMENTATION_STAGE_LABELS,
  "mask-cleanup": "蒙版后处理",
  persist: "保存主体",
};

/** 任务状态（与架构文档 8.1 节的 PENDING / RUNNING / SUCCEEDED / FAILED / CANCELED 对应）。 */
export type SubjectTaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export const SUBJECT_TASK_STATUS_LABELS: Record<SubjectTaskStatus, string> = {
  pending: "等待中",
  running: "处理中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

/**
 * 集成层错误码。
 *
 * 分割错误沿用 C4 的六个 code；后处理、存储与构图阶段各自收口成稳定 code，
 * UI 不需要理解底层抛的是 MaskError / StorageError / CompositionError。
 */
export type SubjectIntegrationErrorCode =
  | SegmentationErrorCode
  | "E_SUBJECT_INVALID"
  | "E_STORAGE_FAILED"
  | "E_COMPOSITION_FAILED"
  | "E_INTEGRATION_FAILED";

const SUBJECT_INTEGRATION_ERROR_CODES: readonly SubjectIntegrationErrorCode[] = [
  "E_MODEL_LOAD_FAILED",
  "E_MODEL_UNSUPPORTED",
  "E_INFERENCE_FAILED",
  "E_NO_SUBJECT",
  "E_INPUT_INVALID",
  "E_CANCELLED",
  "E_SUBJECT_INVALID",
  "E_STORAGE_FAILED",
  "E_COMPOSITION_FAILED",
  "E_INTEGRATION_FAILED",
];

export function isSubjectIntegrationErrorCode(
  value: unknown,
): value is SubjectIntegrationErrorCode {
  return (
    typeof value === "string" &&
    (SUBJECT_INTEGRATION_ERROR_CODES as readonly string[]).includes(value)
  );
}

export class SubjectIntegrationError extends Error {
  readonly code: SubjectIntegrationErrorCode;
  /** 是否值得让用户点“重试”。输入非法、记录损坏等为 false。 */
  readonly recoverable: boolean;

  constructor(code: SubjectIntegrationErrorCode, message: string, recoverable = true) {
    super(message);
    this.name = "SubjectIntegrationError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export function isSubjectIntegrationError(error: unknown): error is SubjectIntegrationError {
  return error instanceof SubjectIntegrationError;
}

/** C2 抛出的 `MaskError.code`。 */
const MASK_ERROR_CODES = new Set(["INVALID_MASK", "INVALID_OPTIONS"]);

/** C3 抛出的 `CompositionError.code`。 */
const COMPOSITION_ERROR_CODES = new Set([
  "E_SOURCE_INVALID",
  "E_MASK_INVALID",
  "E_MASK_SIZE_MISMATCH",
  "E_BBOX_INVALID",
  "E_PARAMS_INVALID",
  "E_MARGIN_TOO_LARGE",
  "E_BACKGROUND_REQUIRED",
  "E_BACKGROUND_INVALID",
]);

/** C1 存储层抛出的 `StorageError.code`。 */
const STORAGE_ERROR_CODES = new Set([
  "E_SUBJECT_INVALID",
  "E_COMPOSITION_INVALID",
  "E_ID_CONFLICT",
  "E_CORRUPT_RECORD",
  "E_NOT_FOUND",
  "E_IDB_UNAVAILABLE",
]);

/** 这些存储错误重试也不会改变结果。 */
const NON_RECOVERABLE_STORAGE_CODES = new Set([
  "E_NOT_FOUND",
  "E_CORRUPT_RECORD",
  "E_IDB_UNAVAILABLE",
]);

function errorCodeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * 把任意阶段抛出的异常收口成 `SubjectIntegrationError`。
 *
 * 未知异常按“可重试的集成失败”处理，避免 UI 因为浏览器 DOMException
 * 等非契约错误拿不到可渲染的 code。
 */
export function wrapSubjectIntegrationError(error: unknown): SubjectIntegrationError {
  if (error instanceof SubjectIntegrationError) return error;
  if (isSegmentationError(error)) {
    return new SubjectIntegrationError(error.code, error.message, error.recoverable);
  }

  const code = errorCodeOf(error);
  const message = error instanceof Error ? error.message : String(error);

  if (code !== null && MASK_ERROR_CODES.has(code)) {
    return new SubjectIntegrationError("E_SUBJECT_INVALID", message, false);
  }
  if (code !== null && COMPOSITION_ERROR_CODES.has(code)) {
    return new SubjectIntegrationError("E_COMPOSITION_FAILED", message, true);
  }
  if (code !== null && STORAGE_ERROR_CODES.has(code)) {
    return new SubjectIntegrationError(
      "E_STORAGE_FAILED",
      message,
      !NON_RECOVERABLE_STORAGE_CODES.has(code),
    );
  }
  return new SubjectIntegrationError("E_INTEGRATION_FAILED", message, true);
}

/** 一次检测 / 构图任务的进度事件。 */
export interface SubjectProgressEvent {
  taskId: number;
  stage: SubjectPipelineStage;
  /** 已完成量；`load-model` 以字节为单位，其余阶段由产出方约定。 */
  done: number;
  total: number;
}
