/**
 * C4 · 浏览器端主体分割 —— 纯类型与常量。
 *
 * 本文件属于 core 层：不引用 DOM、不引用 onnxruntime。
 * 真正接触 `ImageData` / `OffscreenCanvas` / Cache Storage 的代码在 `src/workers/segmentation/`。
 */

import type { SegmentationModelRef } from "../types";

/** 无 DOM 依赖的 RGBA 图像（`data` 为行优先、每像素 4 字节）。 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * 分割模型规格（来自 `model-manifest.json`，运行时由 `models.ts` 校验并冻结）。
 *
 * 预处理参数刻意写进清单：换模型 / 换量化版本时只改清单，不改算法。
 */
export interface SegmentationModelSpec {
  /** 模型 id，如 `"u2netp"`。 */
  id: string;
  /** 模型版本（对应上游发布时间 / 量化版本），用于结果复现。 */
  version: string;
  /** 许可证标识。 */
  license: string;
  /** 上游项目主页。 */
  upstream: string;
  /** 模型下载地址（构建时不打包，首次运行按需加载并缓存）。 */
  sourceUrl: string;
  /** 部署在 `public/models/` 下的文件名。 */
  fileName: string;
  /** 模型文件 SHA-256（小写十六进制），用于完整性校验。 */
  sha256: string;
  /** 模型文件字节数。 */
  byteLength: number;
  /** 输入张量名；为空时使用会话报告的第一个输入。 */
  inputName?: string;
  /** 模型输入宽（像素）。 */
  inputWidth: number;
  /** 模型输入高（像素）。 */
  inputHeight: number;
  /** RGB 归一化均值，顺序 R、G、B。 */
  mean: readonly [number, number, number];
  /** RGB 归一化标准差，顺序 R、G、B。 */
  std: readonly [number, number, number];
  /** 使用第几个输出张量。u2net 家族为 0（d1）。 */
  outputIndex: number;
}

/** 模型清单文件结构。 */
export interface SegmentationModelManifest {
  /** Cache Storage 的桶名；升级模型清单时一并递增。 */
  cacheName: string;
  /** 默认模型 id（必须存在于 models）；缺省取第一项。 */
  defaultModelId?: string;
  models: SegmentationModelSpec[];
}

/**
 * 推理会话的最小抽象。
 *
 * 生产实现由 `src/workers/segmentation/ort-session.ts` 提供（onnxruntime-web）；
 * 单元测试用假会话返回构造好的输出，从而在 Node / Vitest 中验证整条纯计算链路。
 */
export interface SegmentationSession {
  /** 实际使用的执行提供者，写入诊断与日志。 */
  readonly provider: "wasm" | "webgpu";
  /** 执行一次推理，输入为 CHW 布局的 float32。 */
  run(input: Float32Array): Promise<Float32Array>;
  /** 释放底层会话。 */
  dispose?(): Promise<void>;
}

/** 分割运行的进度回调阶段（与 C1 协议一致）。 */
export type SegmentationRunStage = "preprocess" | "inference" | "postprocess";

export interface SegmentationRunOptions {
  image: RgbaImage;
  sourceImageId: string;
  model: SegmentationModelSpec;
  session: SegmentationSession;
  /** 低于该前景占比视为没有主体（0–1）。默认 `DEFAULT_MIN_FOREGROUND_RATIO`。 */
  minForegroundRatio?: number;
  /** 前景置信度均值的下限（0–1）；低于它同样视为没有主体。默认 0。 */
  minConfidence?: number;
  /**
   * bbox 裁剪二次推理：主体 bbox 显著小于全图时，裁剪区重跑一次拿回边界分辨率。
   * 默认开启；测试或对照实验可传 false 关闭。
   */
  refineCrop?: boolean;
  /** 候选 id 生成器；测试可注入确定性实现。 */
  candidateId?: () => string;
  /** ISO 时间生成器；测试可注入固定时间。 */
  now?: () => string;
  onProgress?: (stage: SegmentationRunStage, done: number, total: number) => void;
  shouldCancel?: () => boolean;
}

/** 默认前景占比下限：0.05% 的像素。低于它基本是模型噪声。 */
export const DEFAULT_MIN_FOREGROUND_RATIO = 0.0005;

/** 模型元信息转成 C1 契约里的模型引用。 */
export function toModelRef(spec: SegmentationModelSpec): SegmentationModelRef {
  return { id: spec.id, version: spec.version, license: spec.license };
}
