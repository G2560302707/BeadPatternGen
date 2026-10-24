/**
 * S3b · 区域重识别：用户框一个矩形，把该裁剪区送回分割模型
 * 重新推理，再把返回的裁剪区蒙版合并回当前候选蒙版。
 *
 * 动机：显著性模型对"主体与背景边界不明显"的区域经常整团出错。
 * 全图重推理改不了分辨率（320 输入），而裁剪区重推理相当于把
 * 模型输入像素全部花在用户关心的区域——这是手动修正的高效兜底。
 *
 * 裁剪在主线程用 canvas 完成（原图 bitmap 已在内存），导出无损 PNG
 * 字节交给现有 Worker（协议不变，模型按需加载）。
 */

import { mergeMaskRegion } from "../../core/subject/segmentation/refine";
import type { BBox, SubjectCandidate } from "../../core/subject";
import { commitMaskEdit, type BrushMode } from "./brush";
import type { ImageSession } from "../../state/workspace-store";

export type { BrushMode };

/** 把用户拖的框变成合法裁剪矩形（图内整数坐标，至少 8px）。 */
export function clampRegionBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number,
): BBox | null {
  const x = Math.max(0, Math.floor(Math.min(x0, x1)));
  const y = Math.max(0, Math.floor(Math.min(y0, y1)));
  const right = Math.min(width, Math.ceil(Math.max(x0, x1)));
  const bottom = Math.min(height, Math.ceil(Math.max(y0, y1)));
  const w = right - x;
  const h = bottom - y;
  if (w < 8 || h < 8) return null;
  return { x, y, width: w, height: h };
}

/** 从 ImageSession 的位图裁出 PNG 字节（无损，避免二次 JPEG 压缩扰动边界）。 */
export async function cropToPngBytes(image: ImageSession, crop: BBox): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法创建 2D 画布，区域重识别失败。");
  ctx.drawImage(image.bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("区域裁剪导出失败。");
  return new Uint8Array(await blob.arrayBuffer());
}

export interface ResegmentRegionInput {
  image: ImageSession;
  candidate: SubjectCandidate;
  /** 用户拖出的框（原图坐标，可为任意对角）。 */
  box: { x0: number; y0: number; x1: number; y1: number };
  modelId?: string;
  /** 分割实现；缺省由调用方注入浏览器客户端。 */
  segment: (input: {
    sourceImageId: string;
    imageBytes: Uint8Array;
    mimeType: string;
    modelId?: string;
  }) => Promise<SubjectCandidate[]>;
}

export interface ResegmentRegionResult {
  next: SubjectCandidate;
  crop: BBox;
}

/**
 * 执行区域重识别。裁剪区模型输出尺寸 = 裁剪区像素尺寸，
 * `mergeMaskRegion` 把它写回全图蒙版的对应区域，其余保持不变。
 */
export async function resegmentRegion(input: ResegmentRegionInput): Promise<ResegmentRegionResult> {
  const { image, candidate, box, modelId, segment } = input;
  const crop = clampRegionBox(box.x0, box.y0, box.x1, box.y1, image.width, image.height);
  if (!crop) throw new Error("区域太小：至少 8×8 像素。");

  const bytes = await cropToPngBytes(image, crop);
  const candidates = await segment({
    sourceImageId: `${candidate.sourceImageId}#region`,
    imageBytes: bytes,
    mimeType: "image/png",
    ...(modelId === undefined ? {} : { modelId }),
  });
  const regionCandidate = candidates[0];
  if (!regionCandidate) throw new Error("区域重识别没有返回结果。");

  const regionMask = regionCandidate.mask;
  if (regionMask.width !== crop.width || regionMask.height !== crop.height) {
    throw new Error("区域蒙版尺寸与裁剪区不一致。");
  }

  const merged = mergeMaskRegion(candidate.mask.data, regionMask.data, candidate.mask.width, crop);
  const next = commitMaskEdit(candidate, merged);
  return { next, crop };
}
