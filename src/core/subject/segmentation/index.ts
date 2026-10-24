/**
 * C4 · 浏览器端主体分割 —— 公共出口。
 *
 * 这里只导出纯计算与契约；onnxruntime / Cache Storage / OffscreenCanvas
 * 的实现位于 `src/workers/segmentation/`，避免 core 层依赖浏览器 API。
 */

export {
  SegmentationError,
  cancelledError,
  isSegmentationError,
  isSegmentationErrorCode,
  wrapSegmentationError,
} from "./errors";
export {
  DEFAULT_SEGMENTATION_MODEL_ID,
  SEGMENTATION_MODEL_CACHE_NAME,
  SEGMENTATION_MODEL_MANIFEST,
  getSegmentationModelSpec,
  segmentationModelPath,
} from "./models";
export { SEGMENTATION_ALGORITHM_VERSION, runSegmentation } from "./pipeline";
export { maskFromModelOutput, normalizeModelOutput, resizeGrayBilinear } from "./postprocess";
export type { MaskFromOutputInput, MaskFromOutputResult } from "./postprocess";
export { preprocessForModel, preprocessRgbaToChw, validateRgbaImage } from "./preprocess";
export { DEFAULT_MIN_FOREGROUND_RATIO, toModelRef } from "./types";
export type {
  RgbaImage,
  SegmentationModelManifest,
  SegmentationModelSpec,
  SegmentationRunOptions,
  SegmentationRunStage,
  SegmentationSession,
} from "./types";
