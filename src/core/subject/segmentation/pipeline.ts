/**
 * C4 · 分割纯计算流水线。
 *
 * `runSegmentation` 只依赖一个 `SegmentationSession` 抽象：
 * 生产环境由 onnxruntime-web 适配器实现，测试用假会话返回构造输出。
 * 这样模型推理之外的所有逻辑（预处理 / 上采样 / 置信度 / 取消 / 错误码）
 * 都能在 Node 中做确定性回归。
 */

import { SUBJECT_LABEL_MAIN } from "../types";
import type { SubjectCandidate, SubjectMask } from "../types";
import { computeMaskBBox } from "../mask";
import { SegmentationError, cancelledError, wrapSegmentationError } from "./errors";
import { maskFromModelOutput } from "./postprocess";
import { preprocessForModel, validateRgbaImage } from "./preprocess";
import { cropRgbaImage, mergeRefinedMask, planRefineCrop } from "./refine";
import { DEFAULT_MIN_FOREGROUND_RATIO } from "./types";
import type { SegmentationRunOptions } from "./types";

/** 算法版本：预处理 / 后处理语义变化时递增，便于结果复现与缓存失效。
 * 1.1：分位归一化 + Otsu 自适应阈值 + bbox 裁剪二次推理。
 * 1.2：滞后阈值抢救弱响应带、清理面积按图像比例、不透明度归一化、
 *      二次推理合并带阈值谐波（修复「越精修越残缺」）。 */
export const SEGMENTATION_ALGORITHM_VERSION = "1.2";

function defaultCandidateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `subject-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureNotCancelled(options: SegmentationRunOptions): void {
  if (options.shouldCancel?.() === true) throw cancelledError();
}

function emit(
  options: SegmentationRunOptions,
  stage: "preprocess" | "inference" | "postprocess",
  done: number,
  total: number,
): void {
  options.onProgress?.(stage, done, total);
}

/**
 * 执行一次单主体分割。
 *
 * @returns 未落库的候选主体（完整蒙版 + bbox + 置信度）。
 * @throws {SegmentationError} E_INPUT_INVALID / E_INFERENCE_FAILED / E_NO_SUBJECT / E_CANCELLED
 */
export async function runSegmentation(options: SegmentationRunOptions): Promise<SubjectCandidate> {
  const { image, model, session, sourceImageId } = options;

  try {
    validateRgbaImage(image);
  } catch (error) {
    throw new SegmentationError(
      "E_INPUT_INVALID",
      error instanceof Error ? error.message : String(error),
      false,
    );
  }
  if (typeof sourceImageId !== "string" || sourceImageId.length === 0) {
    throw new SegmentationError("E_INPUT_INVALID", "sourceImageId 不能为空", false);
  }
  if (model.inputWidth <= 0 || model.inputHeight <= 0) {
    throw new SegmentationError("E_MODEL_UNSUPPORTED", "模型输入尺寸非法", false);
  }

  const createdAt = (options.now ?? (() => new Date().toISOString()))();
  const candidateId = (options.candidateId ?? defaultCandidateId)();
  const minForegroundRatio = options.minForegroundRatio ?? DEFAULT_MIN_FOREGROUND_RATIO;
  const minConfidence = options.minConfidence ?? 0;

  ensureNotCancelled(options);
  emit(options, "preprocess", 0, 1);
  const input = preprocessForModel(image, model);
  ensureNotCancelled(options);
  emit(options, "preprocess", 1, 1);

  const refineEnabled = options.refineCrop !== false;
  emit(options, "inference", 0, refineEnabled ? 2 : 1);
  let output: Float32Array;
  try {
    output = await session.run(input);
  } catch (error) {
    if (error instanceof SegmentationError) throw error;
    throw wrapSegmentationError(error);
  }
  ensureNotCancelled(options);
  emit(options, "inference", 1, refineEnabled ? 2 : 1);

  emit(options, "postprocess", 0, 1);
  let result;
  try {
    result = maskFromModelOutput({
      output,
      outputWidth: model.inputWidth,
      outputHeight: model.inputHeight,
      imageWidth: image.width,
      imageHeight: image.height,
      sourceImageId,
      model,
      createdAt,
    });
  } catch (error) {
    if (error instanceof SegmentationError) throw error;
    throw new SegmentationError(
      "E_INFERENCE_FAILED",
      `模型输出无法解析：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
  ensureNotCancelled(options);

  // bbox 裁剪二次推理：主体只占画面一部分时，裁剪区重跑一次拿回边界分辨率。
  if (refineEnabled) {
    const plan = planRefineCrop(result.bbox, image.width, image.height);
    if (plan) {
      const cropImage = cropRgbaImage(image, plan.crop);
      const cropInput = preprocessForModel(cropImage, model);
      let cropOutput: Float32Array;
      try {
        cropOutput = await session.run(cropInput);
      } catch (error) {
        if (error instanceof SegmentationError) throw error;
        throw wrapSegmentationError(error);
      }
      ensureNotCancelled(options);
      try {
        const cropResult = maskFromModelOutput({
          output: cropOutput,
          outputWidth: model.inputWidth,
          outputHeight: model.inputHeight,
          imageWidth: plan.crop.width,
          imageHeight: plan.crop.height,
          sourceImageId,
          model,
          createdAt,
        });
        const merged = mergeRefinedMask({
          baseMask: result.mask.data,
          baseThreshold: result.mask.threshold,
          regionMask: cropResult.mask.data,
          regionThreshold: cropResult.mask.threshold,
          maskWidth: image.width,
          crop: plan.crop,
        });
        const mergedMask: SubjectMask = {
          ...result.mask,
          data: merged.data,
          threshold: merged.threshold,
        };
        const mergedBBox = computeMaskBBox(mergedMask) ?? result.bbox;
        let foregroundPixels = 0;
        let confidenceSum = 0;
        for (let i = 0; i < merged.data.length; i += 1) {
          const value = merged.data[i] as number;
          if (value > merged.threshold) {
            foregroundPixels += 1;
            confidenceSum += value;
          }
        }
        result = {
          mask: mergedMask,
          bbox: mergedBBox,
          confidence: foregroundPixels === 0 ? 0 : confidenceSum / foregroundPixels / 255,
          foregroundRatio: foregroundPixels / merged.data.length,
        };
      } catch (error) {
        // 二次推理在裁剪区找不到主体属于精修失败：保留第一遍粗蒙版，
        // 不让它毁掉整次识别；其它错误（推理崩溃等）照常上抛。
        if (!(error instanceof SegmentationError) || error.code !== "E_NO_SUBJECT") throw error;
      }
    }
  }
  if (refineEnabled) emit(options, "inference", 2, 2);
  emit(options, "postprocess", 1, 1);

  if (result.foregroundRatio < minForegroundRatio) {
    throw new SegmentationError(
      "E_NO_SUBJECT",
      `没有找到主体（前景占比 ${(result.foregroundRatio * 100).toFixed(3)}%，低于阈值 ${(minForegroundRatio * 100).toFixed(3)}%）`,
      true,
    );
  }
  if (result.confidence < minConfidence) {
    throw new SegmentationError(
      "E_NO_SUBJECT",
      `主体置信度过低（${result.confidence.toFixed(3)}）`,
      true,
    );
  }

  return {
    id: candidateId,
    sourceImageId,
    mask: result.mask,
    bbox: result.bbox,
    confidence: result.confidence,
    label: SUBJECT_LABEL_MAIN,
    createdAt,
  };
}
