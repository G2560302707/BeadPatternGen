/**
 * C4 · 分割错误模型。
 *
 * code 与 `src/core/subject/types.ts` 的 `SegmentationErrorCode` 完全一致：
 * Worker 直接把 code 写进协议响应，UI 不需要再做映射。
 */

import type { SegmentationErrorCode } from "../types";

export class SegmentationError extends Error {
  readonly code: SegmentationErrorCode;
  /** 是否值得让用户点"重试"。输入非法、模型不支持为 false。 */
  readonly recoverable: boolean;

  constructor(code: SegmentationErrorCode, message: string, recoverable = true) {
    super(message);
    this.name = "SegmentationError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export function isSegmentationError(error: unknown): error is SegmentationError {
  return error instanceof SegmentationError;
}

/**
 * 把任意异常收口成 `SegmentationError`。
 *
 * 未知异常一律视为推理失败（可重试），避免 Worker 抛出的 DOMException
 *（例如内存不足）导致 UI 无法渲染错误态。
 */
export function wrapSegmentationError(error: unknown): SegmentationError {
  if (error instanceof SegmentationError) return error;
  if (error instanceof Error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && isSegmentationErrorCode(code)) {
      return new SegmentationError(code, error.message, code !== "E_INPUT_INVALID");
    }
  }
  if (error instanceof Error) {
    return new SegmentationError("E_INFERENCE_FAILED", error.message, true);
  }
  return new SegmentationError("E_INFERENCE_FAILED", String(error), true);
}

const ERROR_CODES: readonly SegmentationErrorCode[] = [
  "E_MODEL_LOAD_FAILED",
  "E_MODEL_UNSUPPORTED",
  "E_INFERENCE_FAILED",
  "E_NO_SUBJECT",
  "E_INPUT_INVALID",
  "E_CANCELLED",
];

export function isSegmentationErrorCode(value: string): value is SegmentationErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

export function cancelledError(message = "分割任务已取消"): SegmentationError {
  return new SegmentationError("E_CANCELLED", message, true);
}
