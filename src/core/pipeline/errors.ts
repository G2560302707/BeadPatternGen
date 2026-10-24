/**
 * S10 · 流水线错误。取消必须使用 E_CANCELLED，UI 据此回到可重试、不落地半成品。
 */

export const PIPELINE_ERROR_CODES = [
  "E_CANCELLED",
  "E_INVALID_SAMPLE",
  "E_INVALID_SETTINGS",
  "E_PIPELINE",
] as const;

export type PipelineErrorCode = (typeof PIPELINE_ERROR_CODES)[number] | string;

export class PipelineError extends Error {
  readonly code: PipelineErrorCode;

  constructor(code: PipelineErrorCode, message: string) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
  }
}

export function wrapPipelineError(error: unknown): PipelineError {
  if (error instanceof PipelineError) return error;
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return new PipelineError(error.code, error.message);
  }
  if (error instanceof Error) {
    return new PipelineError("E_PIPELINE", error.message);
  }
  return new PipelineError("E_PIPELINE", String(error));
}
