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
 * - 先取 0.5% / 99.5% 分位作为 0 / 255 锚点（合计裁掉 1% 质量，抗离群点：
 *   一小块极端响应不再拉扁全图值域）；分位区间退化时回退全图 min-max；
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

  // 4096 桶直方图求分位锚点。
  const bins = new Uint32Array(4096);
  const binScale = bins.length / range;
  for (let i = 0; i < output.length; i += 1) {
    const bin = Math.min(bins.length - 1, Math.floor(((output[i] as number) - min) * binScale));
    bins[bin] = (bins[bin] ?? 0) + 1;
  }
  const lowTarget = output.length * 0.005;
  const highTarget = output.length * 0.995;
  let low = min;
  let high = max;
  let cumulative = 0;
  let lowBin = -1;
  for (let bin = 0; bin < bins.length; bin += 1) {
    cumulative += bins[bin] as number;
    if (lowBin === -1 && cumulative >= lowTarget) {
      lowBin = bin;
      low = min + bin / binScale;
    }
    if (cumulative >= highTarget) {
      high = min + (bin + 1) / binScale;
      break;
    }
  }
  const span = high - low;
  const mapped = span > 1e-9 ? 255 / span : 255 / range;
  for (let i = 0; i < output.length; i += 1) {
    result[i] = Math.round(((output[i] as number) - low) * mapped);
  }
  return result;
}

/**
 * Otsu 自适应阈值：最大化前景 / 背景类间方差。
 * 返回 0–255 的整数阈值；直方图退化（单一值）时返回 -1，由调用方回退固定阈值。
 */
export function otsuThreshold(data: Uint8ClampedArray): number {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 1) {
    const level = data[i] as number;
    histogram[level] = (histogram[level] ?? 0) + 1;
  }
  const total = data.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t += 1) sumAll += t * (histogram[t] as number);

  let weightBackground = 0;
  let sumBackground = 0;
  let bestVariance = 0;
  let bestThreshold = -1;
  for (let t = 0; t < 256; t += 1) {
    weightBackground += histogram[t] as number;
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += t * (histogram[t] as number);
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = t;
    }
  }
  return bestThreshold;
}

/** 自适应阈值的最终决策：Otsu 结果夹在 [48, 200]，退化时回退默认 128。 */
export function adaptiveMaskThreshold(
  data: Uint8ClampedArray,
  fallback: number = DEFAULT_MASK_THRESHOLD,
): number {
  const otsu = otsuThreshold(data);
  return otsu >= 0 ? Math.min(200, Math.max(48, otsu)) : fallback;
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
  /**
   * 前景阈值：传数字时固定使用；缺省走自适应（Otsu），
   * 结果夹在 [48, 200]，直方图退化时回退 `DEFAULT_MASK_THRESHOLD`。
   */
  threshold?: number;
  /** 关闭自适应阈值（仅当 `threshold` 未传时生效），显式传数字同样固定。 */
  adaptiveThreshold?: boolean;
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

  const normalized = normalizeModelOutput(output);
  const data = resizeGrayBilinear(normalized, outputWidth, outputHeight, imageWidth, imageHeight);

  let threshold: number;
  if (input.threshold !== undefined) {
    threshold = input.threshold;
  } else if (input.adaptiveThreshold === false) {
    threshold = DEFAULT_MASK_THRESHOLD;
  } else {
    threshold = adaptiveMaskThreshold(data);
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
    throw new Error(`threshold 必须在 0–255 之间，实际为 ${String(threshold)}`);
  }

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
