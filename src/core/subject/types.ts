/**
 * S11 · 主体识别与智能构图 —— 数据契约（二期 C1）。
 *
 * 本文件是与 UI 协作方共享的唯一契约源：只放类型、常量与语义约定，不放算法。
 * 约定：
 * - 所有 id 为非空字符串，由调用方生成（推荐 `crypto.randomUUID()`）。
 * - 所有时间戳为 ISO 8601 字符串（`new Date().toISOString()`）。
 * - 坐标系：除特别说明外，蒙版与 bbox 都使用"原图像素坐标系"，原点在左上角。
 * - 本文件不得引入 DOM 类型（`ImageData` / `HTMLElement` 等）；像素一律用 typed array。
 */

/** 原图坐标系下的整数像素矩形。 */
export interface BBox {
  /** 左上角 x，原图像素，整数。 */
  x: number;
  /** 左上角 y，原图像素，整数。 */
  y: number;
  /** 宽度，像素，正整数。 */
  width: number;
  /** 高度，像素，正整数。 */
  height: number;
}

/**
 * 蒙版像素编码。
 *
 * 当前只有 `raw-alpha8`：每像素 1 字节，行优先，长度 = `width × height`。
 * 压缩编码（如 PNG-alpha8）属于后续扩展点，新增枚举值时需同步升级存储记录版本。
 */
export type SubjectMaskEncoding = "raw-alpha8";

/** 分割模型标识，用于结果复现、模型替换审计与许可证追溯。 */
export interface SegmentationModelRef {
  /** 模型 id，如 `"u2netp"`。 */
  id: string;
  /** 模型或量化版本，如 `"1.0-q8"`。 */
  version: string;
  /** 许可证标识，如 `"Apache-2.0"`。 */
  license?: string;
}

/**
 * 主体蒙版：与原图等宽的逐像素前景置信度。
 *
 * `data[i] > threshold` 视为前景（主体）；其余视为背景。
 * 后处理（C2）只读写本结构，不关心模型来源。
 */
export interface SubjectMask {
  /** 所属原图 id，用于防止蒙版与图片错配。 */
  sourceImageId: string;
  /** 蒙版宽度，必须等于原图宽度。 */
  width: number;
  /** 蒙版高度，必须等于原图高度。 */
  height: number;
  encoding: SubjectMaskEncoding;
  /** 前景置信度：0 = 背景，255 = 确定前景；长度必须为 `width × height`。 */
  data: Uint8ClampedArray;
  /** 前景判定阈值（0–255），默认 128。 */
  threshold: number;
  /** 产出该蒙版的模型；手动编辑产生的蒙版沿用原模型并可在 label 中说明。 */
  model: SegmentationModelRef;
  createdAt: string;
}

/** 蒙版缩略图的存储引用（UI 叠层预览用，避免反复读取全尺寸蒙版）。 */
export interface MaskThumbnailRef {
  /** 存储层键；由 `subjectRepository` 读写。 */
  id: string;
  width: number;
  height: number;
}

/** 主体标签常量；二期只做单主体，语义标签固定。 */
export const SUBJECT_LABEL_MAIN = "main-subject";

/** 蒙版默认前景阈值。 */
export const DEFAULT_MASK_THRESHOLD = 128;

/**
 * 已落库的主体元数据。
 *
 * 刻意不携带 `data`：完整蒙版以 Blob 形式存于 IndexedDB，通过 `maskId` 取回，
 * 避免列表 / 状态层持有大数组。需要蒙版时用 `SubjectWithMask`。
 */
export interface Subject {
  id: string;
  /** 来源图片 id（一期的 image id / project source id）。 */
  sourceImageId: string;
  /** 蒙版存储键；用 `subjectRepository.loadMask(maskId)` 取回像素。 */
  maskId: string;
  /** 主体有效边界框（已忽略孤立噪点，原图坐标系）。 */
  bbox: BBox;
  /** 模型置信度，0–1。 */
  confidence: number;
  /** 语义标签，二期固定为 `SUBJECT_LABEL_MAIN`。 */
  label: string;
  createdAt: string;
}

/** 主体元数据 + 完整蒙版，供检测结果与构图引擎直接消费。 */
export interface SubjectWithMask extends Subject {
  mask: SubjectMask;
}

/**
 * 分割模型的单次候选输出（尚未落库）。
 *
 * 与 `Subject` 的区别：候选携带完整蒙版，用于 UI 立即叠加预览；
 * 用户确认后由服务层保存为 `Subject`（蒙版转 Blob，生成 `maskId`）。
 */
export interface SubjectCandidate {
  id: string;
  sourceImageId: string;
  /** 模型输出的原始蒙版，原图坐标系。 */
  mask: SubjectMask;
  /** 可选缩略蒙版引用；UI 可先画缩略图，交互稳定后再读全尺寸。 */
  thumbnail?: MaskThumbnailRef;
  /** 候选主体的有效边界框。 */
  bbox: BBox;
  /** 模型置信度，0–1。 */
  confidence: number;
  /** 语义标签，二期固定为 `SUBJECT_LABEL_MAIN`。 */
  label: string;
  createdAt: string;
}

/** 背景类型：透明 / 纯色 / 自定义图片（image 为 P1 预留）。 */
export type CompositionBackgroundType = "transparent" | "solid" | "image";

/**
 * 构图参数（纯数据，可序列化）。
 *
 * 单位约定（全部与具体像素解耦，便于 UI 在不同缩放下拖动）：
 * - `subjectScale`：主体最长边占"画布内容区"（画布减去 margin）的比例，可选 0.3–1；
 *   1 + 0 边距 = 主体顶满画板（画板比例与主体一致时铺满）。
 * - `offsetX` / `offsetY`：主体中心相对画布中心的偏移，单位为画布宽 / 高，
 *   取值范围 [-1, 1]；0 = 居中，正值分别向右 / 向下。
 * - `margin`：主体与画布边缘的最小留白，单位为 `min(canvasWidth, canvasHeight)` 的比例，
 *   取值范围 [0, 0.5]。
 */
export interface CompositionParams {
  /** 画布宽度，像素，正整数。 */
  canvasWidth: number;
  /** 画布高度，像素，正整数。 */
  canvasHeight: number;
  /** 主体占比，0.3–1（1 = 顶满内容区）。 */
  subjectScale: number;
  /** 水平偏移，单位 = 画布宽度，0 = 居中。 */
  offsetX: number;
  /** 垂直偏移，单位 = 画布高度，0 = 居中。 */
  offsetY: number;
  backgroundType: CompositionBackgroundType;
  /**
   * 背景取值，与 `backgroundType` 联动：
   * - transparent → 必须为 `null`
   * - solid → `#RRGGBB` 十六进制颜色
   * - image → 背景图资源 id（非空字符串）
   */
  backgroundValue: string | null;
  /** 主体最小边距，单位 = min(画布宽, 高) 的比例，0–0.5。 */
  margin: number;
  /** 锁定主体：true 时 UI 禁止拖动 / 缩放，只允许改参数面板。 */
  subjectLocked: boolean;
}

/** 构图默认值：1:1 画布、透明背景、主体占 90%、锁定。 */
export const DEFAULT_COMPOSITION_PARAMS: Readonly<CompositionParams> = Object.freeze({
  canvasWidth: 1024,
  canvasHeight: 1024,
  subjectScale: 0.9,
  offsetX: 0,
  offsetY: 0,
  backgroundType: "transparent",
  backgroundValue: null,
  margin: 0.05,
  subjectLocked: true,
});

/**
 * 构图结果配置（可序列化、可持久化）。
 *
 * `params` 为完整构图参数；合成像素不落库，需要时由 C3 构图引擎按参数重算，
 * 保证同一输入 + 同一算法版本结果确定。
 */
export interface Composition {
  schemaVersion: "1.0";
  id: string;
  /** 关联的主体 id。 */
  subjectId: string;
  /** 冗余保存来源图片 id，便于按图检索与跨项目复用。 */
  sourceImageId: string;
  params: CompositionParams;
  createdAt: string;
  updatedAt: string;
}

/** 分割任务阶段，沿用 `core/pipeline/protocol.ts` 的阶段 + 进度模式。 */
export type SegmentationStage = "load-model" | "preprocess" | "inference" | "postprocess";

/** 阶段中文标签（UI 直接用）。 */
export const SEGMENTATION_STAGE_LABELS: Record<SegmentationStage, string> = {
  "load-model": "加载模型",
  preprocess: "预处理",
  inference: "推理",
  postprocess: "后处理",
};

/** 分割 Worker 请求负载。 */
export interface SegmentationInput {
  sourceImageId: string;
  /** 原图原始编码字节（PNG / JPEG 等）；Worker 内负责解码，可作为 Transferable 转移。 */
  imageBytes: Uint8Array;
  mimeType: string;
  /** 候选数量上限；二期只做单主体，默认 1。 */
  maxCandidates?: number;
  /** 指定模型 id；缺省用默认模型。 */
  modelId?: string;
}

export interface SegmentWorkerRequest {
  type: "segment-subject";
  taskId: number;
  payload: SegmentationInput;
}

export interface CancelSegmentWorkerRequest {
  type: "cancel";
  taskId: number;
}

export type SegmentationWorkerRequest = SegmentWorkerRequest | CancelSegmentWorkerRequest;

export interface SegmentationProgressResponse {
  type: "progress";
  taskId: number;
  stage: SegmentationStage;
  /** 已完成量；`load-model` 以字节为分母，其余阶段可按像素或 0/1 上报。 */
  done: number;
  total: number;
}

export interface SegmentationDoneResponse {
  type: "done";
  taskId: number;
  sourceImageId: string;
  /** 候选主体；蒙版像素以内联 typed array 返回，由主线程决定何时落库。 */
  candidates: SubjectCandidate[];
}

export type SegmentationErrorCode =
  | "E_MODEL_LOAD_FAILED"
  | "E_MODEL_UNSUPPORTED"
  | "E_INFERENCE_FAILED"
  | "E_NO_SUBJECT"
  | "E_INPUT_INVALID"
  | "E_CANCELLED";

export interface SegmentationErrorResponse {
  type: "error";
  taskId: number;
  code: SegmentationErrorCode;
  message: string;
  /** 是否可重试：模型下载失败可重试，输入非法不可重试。 */
  recoverable: boolean;
}

export type SegmentationWorkerResponse =
  SegmentationProgressResponse | SegmentationDoneResponse | SegmentationErrorResponse;
