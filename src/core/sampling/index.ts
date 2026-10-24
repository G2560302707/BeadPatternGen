/**
 * S06 · 面积采样公共出口。
 * 目录外只通过 "./core/sampling"（或 "@/core/sampling"）导入。
 */

export type {
  AlphaPolicy,
  CellCoverage,
  CellSpan,
  CropRect,
  SampledGrid,
  SamplingErrorCode,
} from "./area-sample";
export {
  EMPTY_ALPHA_THRESHOLD,
  SamplingError,
  computeCellCoverage,
  sampleToGrid,
} from "./area-sample";
