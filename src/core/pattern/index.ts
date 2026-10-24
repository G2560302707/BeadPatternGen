export { computePaletteHash } from "./hash";
export {
  EMPTY_CELL,
  MAX_CELL_COUNT,
  MAX_GRID_HEIGHT,
  MAX_GRID_WIDTH,
  MIN_GRID_SIZE,
  SCHEMA_VERSION_V1,
} from "./limits";
export { PatternError, PATTERN_ERROR_CODES } from "./errors";
export type { PatternErrorCode } from "./errors";
export type {
  BeadColor,
  BeadPattern,
  ColorMetricName,
  ColorUsageStat,
  DitheringMode,
  GenerationSettings,
  ImageMode,
  PaletteDefinition,
  PatternSource,
  PatternStats,
  ProjectJsonV1,
  QualityDiagnostic,
  QualityDiagnosticCode,
  TransparentPolicy,
} from "./types";
export { computeStats } from "./stats";
export { MAX_EDIT_HISTORY, cellAtScreen, paintValue, writeCell } from "./edit";
export type { PatternEditTool } from "./edit";
export {
  applyChanges,
  applyCommandToPattern,
  changesFromMap,
  collectStrokeChange,
  estimateHistoryBytes,
  invertChanges,
  MAX_HISTORY_BYTES,
} from "./commands";
export type { CellChange, EditCommand, EditKind } from "./commands";
export { applyChangesToStats, emptyLocked, markLocked } from "./stats-delta";
export {
  copySelection,
  fillSelection,
  lassoIndices,
  mirrorSelection,
  pastePatch,
  rectIndices,
  replaceColorInSelection,
  rotateSelection,
  rotateSelectionCW,
  translateSelection,
} from "./selection";
export type { ClipboardPatch, SelectionTransformResult } from "./selection";
export {
  applyChangesToOverlay,
  compositeCells,
  deriveOverlay,
  hasOverlayContent,
} from "./layers";
export { regenSelection } from "./local-regen";
export { decodeProject, encodeProject, migrate } from "./codec";
export type { DraftPatternInput } from "./draft";
export { createDraftPattern } from "./draft";
export { validatePattern, validatePaletteColors, validateDimensions } from "./validate";
