export const PATTERN_ERROR_CODES = [
  "E_CELLS_LENGTH",
  "E_INDEX_OUT_OF_RANGE",
  "E_DUP_CODE",
  "E_DUP_HEX",
  "E_NON_POSITIVE_DIMENSION",
  "E_DIMENSION_LIMIT",
  "E_INVALID_HEX",
  "E_EMPTY_FIELD",
  "E_INVALID_SETTINGS",
  "E_UNKNOWN_SCHEMA",
  "E_INVALID_JSON",
  "E_STATS_INVARIANT",
  "E_PALETTE_REF",
] as const;

export type PatternErrorCode = (typeof PATTERN_ERROR_CODES)[number];

export class PatternError extends Error {
  readonly code: PatternErrorCode;

  constructor(code: PatternErrorCode, message: string) {
    super(message);
    this.name = "PatternError";
    this.code = code;
  }
}
