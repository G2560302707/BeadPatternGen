export type ExportErrorCode =
  "E_STATS_INVARIANT" | "E_NO_PATTERN" | "E_EXPORT" | "E_INVALID_OPTION";

export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.name = "ExportError";
    this.code = code;
  }
}
