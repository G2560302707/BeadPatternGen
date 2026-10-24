/**
 * S11 · 主体 / 构图契约的运行时类型守卫。
 *
 * 用途：读取 IndexedDB、接收 Worker 消息、导入 JSON 时，把 `unknown` 收窄为契约类型，
 * 避免"字段缺失但类型断言通过"导致的运行时崩溃。守卫只做结构与值域校验，不做图像运算。
 */

import type {
  BBox,
  Composition,
  CompositionParams,
  MaskThumbnailRef,
  SegmentationDoneResponse,
  SegmentationErrorResponse,
  SegmentationModelRef,
  SegmentationProgressResponse,
  SegmentationStage,
  SegmentationWorkerResponse,
  Subject,
  SubjectCandidate,
  SubjectMask,
  SubjectWithMask,
} from "./types";
import { SUBJECT_LABEL_MAIN } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function isSegmentationModelRef(value: unknown): value is SegmentationModelRef {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.version)) return false;
  return value.license === undefined || isNonEmptyString(value.license);
}

/** 边界框必须是原图坐标系内的非负整数像素矩形。 */
export function isBBox(value: unknown): value is BBox {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeInteger(value.x) &&
    isNonNegativeInteger(value.y) &&
    isPositiveInteger(value.width) &&
    isPositiveInteger(value.height)
  );
}

/** 校验蒙版结构、尺寸自洽（`data.length === width × height`）与值域。 */
export function isSubjectMask(value: unknown): value is SubjectMask {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.sourceImageId)) return false;
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) return false;
  if (value.encoding !== "raw-alpha8") return false;
  if (!(value.data instanceof Uint8ClampedArray)) return false;
  if (value.data.length !== value.width * value.height) return false;
  if (!isFiniteNumber(value.threshold) || value.threshold < 0 || value.threshold > 255)
    return false;
  if (!isSegmentationModelRef(value.model)) return false;
  return isIsoTimestamp(value.createdAt);
}

export function isMaskThumbnailRef(value: unknown): value is MaskThumbnailRef {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) && isPositiveInteger(value.width) && isPositiveInteger(value.height)
  );
}

/** 校验已落库的主体元数据。 */
export function isSubject(value: unknown): value is Subject {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.sourceImageId) &&
    isNonEmptyString(value.maskId) &&
    isBBox(value.bbox) &&
    isFiniteNumber(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    isNonEmptyString(value.label) &&
    isIsoTimestamp(value.createdAt)
  );
}

export function isSubjectWithMask(value: unknown): value is SubjectWithMask {
  if (!isSubject(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  if (!isSubjectMask(record.mask)) return false;
  return (record.mask as SubjectMask).sourceImageId === value.sourceImageId;
}

export function isSubjectCandidate(value: unknown): value is SubjectCandidate {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.sourceImageId)) return false;
  if (!isSubjectMask(value.mask)) return false;
  if (value.mask.sourceImageId !== value.sourceImageId) return false;
  if (value.thumbnail !== undefined && !isMaskThumbnailRef(value.thumbnail)) return false;
  if (!isBBox(value.bbox)) return false;
  if (!isFiniteNumber(value.confidence) || value.confidence < 0 || value.confidence > 1)
    return false;
  if (!isNonEmptyString(value.label)) return false;
  return isIsoTimestamp(value.createdAt);
}

/**
 * 校验构图参数，包括 `backgroundType` 与 `backgroundValue` 的联动规则：
 * transparent → null；solid → `#RRGGBB`；image → 非空资源 id。
 */
export function isCompositionParams(value: unknown): value is CompositionParams {
  if (!isRecord(value)) return false;
  if (!isPositiveInteger(value.canvasWidth) || !isPositiveInteger(value.canvasHeight)) return false;
  if (!isFiniteNumber(value.subjectScale) || value.subjectScale <= 0 || value.subjectScale > 1) {
    return false;
  }
  if (!isFiniteNumber(value.offsetX) || Math.abs(value.offsetX) > 1) return false;
  if (!isFiniteNumber(value.offsetY) || Math.abs(value.offsetY) > 1) return false;
  if (!isFiniteNumber(value.margin) || value.margin < 0 || value.margin > 0.5) return false;
  if (typeof value.subjectLocked !== "boolean") return false;

  if (value.backgroundType === "transparent") {
    return value.backgroundValue === null;
  }
  if (value.backgroundType === "solid") {
    return isHexColor(value.backgroundValue);
  }
  if (value.backgroundType === "image") {
    return isNonEmptyString(value.backgroundValue);
  }
  return false;
}

export function isComposition(value: unknown): value is Composition {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === "1.0" &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.subjectId) &&
    isNonEmptyString(value.sourceImageId) &&
    isCompositionParams(value.params) &&
    isIsoTimestamp(value.createdAt) &&
    isIsoTimestamp(value.updatedAt)
  );
}

const SEGMENTATION_STAGES: readonly SegmentationStage[] = [
  "load-model",
  "preprocess",
  "inference",
  "postprocess",
];

export function isSegmentationStage(value: unknown): value is SegmentationStage {
  return typeof value === "string" && (SEGMENTATION_STAGES as readonly string[]).includes(value);
}

export function isSegmentationProgressResponse(
  value: unknown,
): value is SegmentationProgressResponse {
  if (!isRecord(value)) return false;
  return (
    value.type === "progress" &&
    isNonNegativeInteger(value.taskId) &&
    isSegmentationStage(value.stage) &&
    isFiniteNumber(value.done) &&
    value.done >= 0 &&
    isFiniteNumber(value.total) &&
    value.total >= 0
  );
}

export function isSegmentationDoneResponse(value: unknown): value is SegmentationDoneResponse {
  if (!isRecord(value)) return false;
  return (
    value.type === "done" &&
    isNonNegativeInteger(value.taskId) &&
    isNonEmptyString(value.sourceImageId) &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isSubjectCandidate)
  );
}

export function isSegmentationErrorResponse(value: unknown): value is SegmentationErrorResponse {
  if (!isRecord(value)) return false;
  return (
    value.type === "error" &&
    isNonNegativeInteger(value.taskId) &&
    isNonEmptyString(value.code) &&
    typeof value.message === "string" &&
    typeof value.recoverable === "boolean"
  );
}

/** Worker 响应统一入口：UI 在写入 state 前先过此守卫（并自行比对 taskId）。 */
export function isSegmentationWorkerResponse(value: unknown): value is SegmentationWorkerResponse {
  return (
    isSegmentationProgressResponse(value) ||
    isSegmentationDoneResponse(value) ||
    isSegmentationErrorResponse(value)
  );
}

/** 便捷常量：单主体场景的默认标签，避免 UI 侧硬编码字符串。 */
export { SUBJECT_LABEL_MAIN };
