/**
 * C4 · 推理结果后处理（纯计算，无 DOM）。
 *
 * 模型输出是 320×320 的显著性图（float32）。处理分三步：
 * 1. 全图 min-max 归一化到 0–255（与 rembg 的做法一致，避免不同模型的输出值域差异）；
 * 2. 双线性上采样回原图尺寸，得到 C1 的 `raw-alpha8` 蒙版；
 * 3. 统计前景占比与置信度，并计算有效 bbox。
 *
 * 这里**不做**去噪 / 填孔 / 羽化：那是 C2 的职责（`postProcessMask`），
 * C6 会把两者串起来，保持"模型输出"与"后处理"可分别回归测试。
 */

import { computeMaskBBox } from "../mask";
import { DEFAULT_MASK_THRESHOLD } from "../types";
import type { BBox, SubjectMask } from "../types";
import { SegmentationError } from "./errors";
import { toModelRef } from "./types";
import type { SegmentationModelSpec } from "./types";

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} 必须是正整数，实际为 ${String(value)}`);
  }
}

/**
 * 把模型显著性图归一化到 0–255。
 *
 * - 所有值相同（含空输出）时返回全 0，交由上层判定 `E_NO_SUBJECT`；
 * - 出现 NaN / Infinity 视为推理失败，不做静默修补。
 */
export function normalizeModelOutput(output: Float32Array): Uint8ClampedArray {
  if (!(output instanceof Float32Array)) {
    throw new Error("模型输出必须是 Float32Array");
  }
  if (output.length === 0) throw new Error("模型输出为空");

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < output.length; i += 1) {
    const value = output[i] as number;
    if (!Number.isFinite(value)) {
      throw new Error("模型输出包含非有限值（NaN / Infinity）");
    }
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const result = new Uint8ClampedArray(output.length);
  const range = max - min;
  if (range < 1e-6) return result;

  const scale = 255 / range;
  for (let i = 0; i < output.length; i += 1) {
    result[i] = Math.round(((output[i] as number) - min) * scale);
  }
  return result;
}

interface AxisSample {
  lower: number;
  upper: number;
  weight: number;
}

function axisSamples(sourceSize: number, targetSize: number): AxisSample[] {
  const samples: AxisSample[] = new Array(targetSize);
  const ratio = sourceSize / targetSize;
  for (let i = 0; i < targetSize; i += 1) {
    const position = (i + 0.5) * ratio - 0.5;
    const floored = Math.floor(position);
    samples[i] = {
      lower: Math.min(Math.max(floored, 0), sourceSize - 1),
      upper: Math.min(Math.max(floored + 1, 0), sourceSize - 1),
      weight: Math.min(Math.max(position - floored, 0), 1),
    };
  }
  return samples;
}

/** 单通道双线性缩放（输入值域 0–255，输出仍为 0–255）。 */
export function resizeGrayBilinear(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8ClampedArray {
  assertPositiveInteger(sourceWidth, "sourceWidth");
  assertPositiveInteger(sourceHeight, "sourceHeight");
  assertPositiveInteger(targetWidth, "targetWidth");
  assertPositiveInteger(targetHeight, "targetHeight");
  if (source.length !== sourceWidth * sourceHeight) {
    throw new Error(`source.length 必须是 ${sourceWidth * sourceHeight}，实际为 ${source.length}`);
  }
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return new Uint8ClampedArray(source);
  }

  const xs = axisSamples(sourceWidth, targetWidth);
  const ys = axisSamples(sourceHeight, targetHeight);
  const out = new Uint8ClampedArray(targetWidth * targetHeight);

  for (let y = 0; y < targetHeight; y += 1) {
    const row = ys[y] as AxisSample;
    const y0 = row.lower;
    const y1 = row.upper;
    const wy = row.weight;
    for (let x = 0; x < targetWidth; x += 1) {
      const col = xs[x] as AxisSample;
      const x0 = col.lower;
      const x1 = col.upper;
      const wx = col.weight;
      const top =
        (source[y0 * sourceWidth + x0] as number) * (1 - wx) +
        (source[y0 * sourceWidth + x1] as number) * wx;
      const bottom =
        (source[y1 * sourceWidth + x0] as number) * (1 - wx) +
        (source[y1 * sourceWidth + x1] as number) * wx;
      out[y * targetWidth + x] = top * (1 - wy) + bottom * wy;
    }
  }

  return out;
}

export interface MaskFromOutputInput {
  /** 模型原始输出（长度为 `outputWidth × outputHeight`）。 */
  output: Float32Array;
  outputWidth: number;
  outputHeight: number;
  /** 目标原图尺寸。 */
  imageWidth: number;
  imageHeight: number;
  sourceImageId: string;
  model: SegmentationModelSpec;
  /** 前景阈值，默认 `DEFAULT_MASK_THRESHOLD`。 */
  threshold?: number;
  /** ISO 时间，由调用方注入以便测试确定性。 */
  createdAt: string;
}

export interface MaskFromOutputResult {
  mask: SubjectMask;
  bbox: BBox;
  /** 前景像素置信度均值（0–1）。 */
  confidence: number;
  /** 前景像素占比（0–1）。 */
  foregroundRatio: number;
}

/**
 * 模型输出 → 原图坐标系蒙版。
 *
 * bbox 使用阈值后的有效范围；没有任何前景时抛错，由上层转成 `E_NO_SUBJECT`。
 */
export function maskFromModelOutput(input: MaskFromOutputInput): MaskFromOutputResult {
  const { output, outputWidth, outputHeight, imageWidth, imageHeight } = input;
  assertPositiveInteger(outputWidth, "outputWidth");
  assertPositiveInteger(outputHeight, "outputHeight");
  assertPositiveInteger(imageWidth, "imageWidth");
  assertPositiveInteger(imageHeight, "imageHeight");
  if (output.length !== outputWidth * outputHeight) {
    throw new Error(`模型输出长度必须是 ${outputWidth * outputHeight}，实际为 ${output.length}`);
  }

  const threshold = input.threshold ?? DEFAULT_MASK_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
    throw new Error(`threshold 必须在 0–255 之间，实际为 ${String(threshold)}`);
  }

  const normalized = normalizeModelOutput(output);
  const data = resizeGrayBilinear(normalized, outputWidth, outputHeight, imageWidth, imageHeight);

  let foregroundPixels = 0;
  let confidenceSum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i] as number;
    if (value > threshold) {
      foregroundPixels += 1;
      confidenceSum += value;
    }
  }

  const mask: SubjectMask = {
    sourceImageId: input.sourceImageId,
    width: imageWidth,
    height: imageHeight,
    encoding: "raw-alpha8",
    data,
    threshold,
    model: toModelRef(input.model),
    createdAt: input.createdAt,
  };

  const bbox = computeMaskBBox(mask);
  if (bbox === null) {
    throw new SegmentationError("E_NO_SUBJECT", "模型没有输出任何前景像素", true);
  }

  return {
    mask,
    bbox,
    confidence: foregroundPixels === 0 ? 0 : confidenceSum / foregroundPixels / 255,
    foregroundRatio: foregroundPixels / data.length,
  };
}
