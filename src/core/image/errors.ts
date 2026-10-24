/**
 * S06 · 图片导入错误模型。
 *
 * 所有可预期失败都抛 ImageImportError，携带机器可读 code 与 recoverable 标记。
 * 上层必须把它渲染成可恢复的提示（可重新选择文件），不得白屏或只写 console。
 */

export type ImageImportErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "CORRUPT_HEADER"
  | "DIMENSION_LIMIT"
  | "RESOLUTION_TOO_LOW"
  | "DECODE_FAILED"
  | "ORIENTATION_UNSUPPORTED";

export class ImageImportError extends Error {
  readonly code: ImageImportErrorCode;
  readonly recoverable: boolean;

  constructor(code: ImageImportErrorCode, message: string, recoverable = true) {
    super(message);
    this.name = "ImageImportError";
    this.code = code;
    this.recoverable = recoverable;
  }
}
