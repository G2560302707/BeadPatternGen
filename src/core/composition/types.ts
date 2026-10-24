/**
 * S11 · C3 构图引擎 —— 公共类型。
 *
 * core 层不依赖 DOM：不引用 `ImageData` / `OffscreenCanvas`，
 * 而是用结构兼容的 `RgbaImage`。上层（Worker / render）可直接把 `ImageData`
 * 传给本模块，也可把结果直接交给 `sampleToGrid`。
 */

import type { BBox, CompositionParams, SubjectMask } from "../subject";

/**
 * 行优先 RGBA 像素缓冲。
 *
 * 显式标注 `ArrayBuffer` 而不是默认的 `ArrayBufferLike`：浏览器 `ImageData`
 * 构造函数只接受 `Uint8ClampedArray<ArrayBuffer>`，这样 UI 侧可以直接
 * `new ImageData(image.data, image.width, image.height)`，无需类型断言。
 */
export type RgbaData = Uint8ClampedArray<ArrayBuffer>;

/** 行优先 RGBA 图像；`data.length === width × height × 4`。 */
export interface RgbaImage {
  width: number;
  height: number;
  /** 直通 alpha（非预乘），0–255。 */
  data: RgbaData;
}

/** 画布 / 源图上的像素矩形，允许浮点坐标（构图定位阶段使用）。 */
export interface CompositionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 超界量（像素）；0 表示该方向没有溢出。 */
export interface CompositionOverflow {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 可修正建议：一组能让主体完全落在画布（含 margin）内的归一化偏移。 */
export interface CompositionSuggestion {
  offsetX: number;
  offsetY: number;
}

/**
 * 构图几何计划。纯数据，可直接序列化给 UI 绘制辅助线。
 *
 * - `crop`：从源图裁出的区域，等于主体 bbox（原图坐标系）；
 * - `subjectRect`：主体最终在画布上的矩形（已夹紧，保证不越界）；
 * - `desiredRect`：按 offset 计算出的期望矩形（未夹紧），用于判断吸附；
 * - `scale`：画布像素 / 源图像素的统一缩放比；
 * - `adjusted`：`subjectRect` 是否与 `desiredRect` 不同（被自动边距 / 画布边界修正）；
 * - `suggestion`：把 `offsetX/offsetY` 改成这组值时，期望矩形就会落在允许区域内。
 */
export interface CompositionPlan {
  /** 构图算法版本；同输入 + 同版本输出确定。 */
  algorithmVersion: string;
  canvasWidth: number;
  canvasHeight: number;
  /** 画布内容区：画布四边各内缩 `margin` 后的区域。 */
  contentRect: CompositionRect;
  crop: CompositionRect;
  desiredRect: CompositionRect;
  subjectRect: CompositionRect;
  scale: number;
  adjusted: boolean;
  suggestion: CompositionSuggestion;
  overflow: CompositionOverflow;
}

/** 合成输入。`mask` 必须与 `source` 同尺寸；`bbox` 必须落在源图内。 */
export interface ComposeInput {
  source: RgbaImage;
  /** 主体蒙版（原图坐标系），前景判定沿 `threshold`。 */
  mask: SubjectMask;
  /** 主体有效边界框（原图坐标系）。 */
  bbox: BBox;
  params: CompositionParams;
  /**
   * 自定义背景图；仅当 `params.backgroundType === "image"` 时需要。
   * 背景按 `cover`（等比铺满、居中裁切）映射到画布。
   */
  backgroundImage?: RgbaImage;
}

/** 合成结果。`image` 可直接作为现有 pipeline 的输入图像。 */
export interface ComposeResult {
  image: RgbaImage;
  plan: CompositionPlan;
}

export type CompositionErrorCode =
  | "E_SOURCE_INVALID"
  | "E_MASK_INVALID"
  | "E_MASK_SIZE_MISMATCH"
  | "E_BBOX_INVALID"
  | "E_PARAMS_INVALID"
  | "E_MARGIN_TOO_LARGE"
  | "E_BACKGROUND_REQUIRED"
  | "E_BACKGROUND_INVALID";

/** 归一化定位偏移。 */
export interface CompositionPositionOffset {
  offsetX: number;
  offsetY: number;
}

/**
 * 常用定位预设。
 *
 * 预设故意使用极端 offset（±1），由 `computeCompositionPlan` 夹紧到内容区：
 * 这样无论主体多大、margin 多少，都能精确贴到对应边，而不用 UI 自己算尺寸。
 * "自由定位"直接调 `CompositionParams.offsetX / offsetY`。
 */
export const COMPOSITION_POSITION_PRESETS = Object.freeze({
  center: Object.freeze({ offsetX: 0, offsetY: 0 }),
  top: Object.freeze({ offsetX: 0, offsetY: -1 }),
  bottom: Object.freeze({ offsetX: 0, offsetY: 1 }),
  left: Object.freeze({ offsetX: -1, offsetY: 0 }),
  right: Object.freeze({ offsetX: 1, offsetY: 0 }),
}) satisfies Record<string, CompositionPositionOffset>;

/** 构图算法版本。修改像素运算或几何语义时必须同步递增。 */
export const COMPOSITION_ALGORITHM_VERSION = "1.0";

export class CompositionError extends Error {
  readonly code: CompositionErrorCode;

  constructor(code: CompositionErrorCode, message: string) {
    super(message);
    this.name = "CompositionError";
    this.code = code;
  }
}
