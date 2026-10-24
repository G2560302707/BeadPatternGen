/**
 * S11 · 主体识别契约 —— 公共出口。
 *
 * 目录之外只应通过 `./core/subject`（或 `@/core/subject`）导入类型与守卫。
 * C2 之后新增的蒙版后处理函数也从此处导出，保持单一入口。
 */

export type {
  BBox,
  CancelSegmentWorkerRequest,
  Composition,
  CompositionBackgroundType,
  CompositionParams,
  MaskThumbnailRef,
  SegmentationDoneResponse,
  SegmentationErrorCode,
  SegmentationErrorResponse,
  SegmentationInput,
  SegmentationModelRef,
  SegmentationProgressResponse,
  SegmentationStage,
  SegmentationWorkerRequest,
  SegmentationWorkerResponse,
  SegmentWorkerRequest,
  Subject,
  SubjectCandidate,
  SubjectMask,
  SubjectMaskEncoding,
  SubjectWithMask,
} from "./types";
export {
  DEFAULT_COMPOSITION_PARAMS,
  DEFAULT_MASK_THRESHOLD,
  SEGMENTATION_STAGE_LABELS,
  SUBJECT_LABEL_MAIN,
} from "./types";
export {
  isBBox,
  isComposition,
  isCompositionParams,
  isMaskThumbnailRef,
  isSegmentationDoneResponse,
  isSegmentationErrorResponse,
  isSegmentationModelRef,
  isSegmentationProgressResponse,
  isSegmentationStage,
  isSegmentationWorkerResponse,
  isSubject,
  isSubjectCandidate,
  isSubjectMask,
  isSubjectWithMask,
} from "./guards";
export type { MaskErrorCode, MaskPostProcessOptions, MaskPostProcessResult } from "./mask";
export {
  DEFAULT_MASK_POST_PROCESS,
  MaskError,
  computeMaskBBox,
  denoiseMask,
  featherMask,
  fillMaskHoles,
  postProcessMask,
  resolveMaskPostProcessOptions,
} from "./mask";
/** C6：完整链路阶段、任务状态与集成错误码。 */
export type {
  SubjectIntegrationErrorCode,
  SubjectPipelineStage,
  SubjectProgressEvent,
  SubjectTaskStatus,
} from "./protocol";
export {
  SUBJECT_PIPELINE_STAGE_LABELS,
  SUBJECT_TASK_STATUS_LABELS,
  SubjectIntegrationError,
  isSubjectIntegrationError,
  isSubjectIntegrationErrorCode,
  wrapSubjectIntegrationError,
} from "./protocol";
/** C6：detectSubjects 组装（分割 → 后处理 → 落库）。 */
export type {
  CandidatePostProcessReport,
  DetectSubjectsDeps,
  DetectSubjectsInput,
  DetectSubjectsResult,
  SegmentationRunner,
  SegmentationRunnerCallbacks,
} from "./detect";
export { detectSubjects } from "./detect";
/** C6：importImage 预检与 getSubjects 查询（第 8 章 API 的其余两个）。 */
export type { ImportImageInput, ImportImageResult } from "./import";
export { imageIdFromBytes, importImage, mimeTypeForFormat } from "./import";
/** C4：浏览器端分割的纯计算与模型清单。Worker 实现位于 `src/workers/segmentation/`。 */
export * from "./segmentation";
