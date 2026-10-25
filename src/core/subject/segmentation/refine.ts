/**
 * S1c · bbox 裁剪二次推理（纯函数）。
 *
 * 思路：第一遍全图推理 → 主体 bbox → 把原图裁到 bbox 外扩一圈后用同一模型
 * 输入尺寸再推理一次。主体只占画面一部分时，第二遍的等效分辨率按
 * `min(原图短边, bbox 短边) / 模型输入边长` 提升，边界细节从原图回来。
 *
 * 全部确定性：无随机、无时间依赖。
 */

import type { BBox } from "../types";
import type { RgbaImage } from "./types";

/** 裁剪外扩比例（相对 bbox 各边长）。 */
export const REFINE_CROP_MARGIN_RATIO = 0.12;

/** bbox 面积超过全图该比例时不再二次推理（裁剪增益太小，不值一次推理）。 */
export const REFINE_MAX_BBOX_AREA_RATIO = 0.72;

/** 二次推理要求的最小分辨率增益（倍）。 */
export const REFINE_MIN_RESOLUTION_GAIN = 1.25;

export interface RefinePlan {
  crop: BBox;
  /** 相对全图短边的等效分辨率增益（≥ REFINE_MIN_RESOLUTION_GAIN）。 */
  gain: number;
}

/** 计算第二遍裁剪区；不满足增益条件时返回 null（调用方跳过精修）。
 *  增益 = 全图短边 / 裁剪短边：模型输入固定时，裁剪越小每个源像素获得的输入占比越高。 */
export function planRefineCrop(
  bbox: BBox,
  imageWidth: number,
  imageHeight: number,
): RefinePlan | null {
  if (imageWidth <= 0 || imageHeight <= 0) return null;
  if (bbox.width <= 0 || bbox.height <= 0) return null;

  const marginX = Math.round(bbox.width * REFINE_CROP_MARGIN_RATIO);
  const marginY = Math.round(bbox.height * REFINE_CROP_MARGIN_RATIO);
  const x = Math.max(0, bbox.x - marginX);
  const y = Math.max(0, bbox.y - marginY);
  const width = Math.min(imageWidth - x, bbox.width + 2 * marginX);
  const height = Math.min(imageHeight - y, bbox.height + 2 * marginY);
  if (width <= 0 || height <= 0) return null;

  const areaRatio = (width * height) / (imageWidth * imageHeight);
  if (areaRatio > REFINE_MAX_BBOX_AREA_RATIO) return null;

  // 等效分辨率增益：全图短边 / 裁剪短边（模型输入固定时，裁剪越小每像素信息越多）。
  const imageShort = Math.min(imageWidth, imageHeight);
  const cropShort = Math.min(width, height);
  const gain = cropShort > 0 ? imageShort / cropShort : 1;
  if (gain < REFINE_MIN_RESOLUTION_GAIN) return null;

  return { crop: { x, y, width, height }, gain };
}

/** 裁剪 RGBA 图像（行优先拷贝，不共享底层缓冲）。 */
export function cropRgbaImage(image: RgbaImage, crop: BBox): RgbaImage {
  if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0) {
    throw new Error("crop 越界或尺寸非法");
  }
  if (crop.x + crop.width > image.width || crop.y + crop.height > image.height) {
    throw new Error("crop 超出图像范围");
  }
  const data = new Uint8ClampedArray(crop.width * crop.height * 4);
  for (let row = 0; row < crop.height; row += 1) {
    const sourceStart = ((crop.y + row) * image.width + crop.x) * 4;
    const targetStart = row * crop.width * 4;
    data.set(image.data.subarray(sourceStart, sourceStart + crop.width * 4), targetStart);
  }
  return { width: crop.width, height: crop.height, data };
}

/**
 * 把裁剪区二次推理得到的置信度写回全图蒙版：
 * - 裁剪区内：直接用第二遍的值（模型在更高分辨率下的判断）；
 * - 裁剪区外：保留第一遍的值。
 * 返回新数组，不改入参。
 */
export function mergeMaskRegion(
  baseMask: Uint8ClampedArray,
  regionMask: Uint8ClampedArray,
  maskWidth: number,
  crop: BBox,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(baseMask.length);
  out.set(baseMask);
  for (let row = 0; row < crop.height; row += 1) {
    const y = crop.y + row;
    for (let col = 0; col < crop.width; col += 1) {
      const x = crop.x + col;
      out[y * maskWidth + x] = regionMask[row * crop.width + col] ?? 0;
    }
  }
  return out;
}

/**
 * 带阈值谐波的裁剪区合并。
 *
 * 为什么不能直接合并两份归一化数据：第一遍与第二遍的 0–255 各自独立归一化
 * （分位锚点来自各自的输出），同一数值在两份尺度里含义不同。旧实现把两份
 * 原始值拼在一起再算一个 Otsu，阈值一旦落在第二遍尺度的主体区间里，
 * 就会把二次推理刚找回来的边界整块切掉——「越精修越残缺」。
 *
 * 谐波映射：把裁剪区的值按它自己的 Otsu 阈值锚定到全图尺度——
 * - `v ≥ cropThreshold`：[cropThreshold, 255] 线性映射到 [baseThreshold, 255]；
 * - `v < cropThreshold`：[0, cropThreshold] 线性映射到 [0, baseThreshold]。
 * 之后逐像素取 `max(base, harmonized)`（并集偏置：精修只增不删），合并后
 * 的阈值就是 baseThreshold，前景判定与两遍各自的判定完全一致。
 *
 * 两侧阈值都来自 `adaptiveMaskThreshold`（夹在 [48, 200]），不会出现 0/255 退化。
 */
export function mergeRefinedMask(input: {
  baseMask: Uint8ClampedArray;
  baseThreshold: number;
  regionMask: Uint8ClampedArray;
  regionThreshold: number;
  maskWidth: number;
  crop: BBox;
}): { data: Uint8ClampedArray; threshold: number } {
  const { baseMask, baseThreshold, regionMask, regionThreshold, maskWidth, crop } = input;
  const out = new Uint8ClampedArray(baseMask.length);
  out.set(baseMask);

  const safeCropThreshold = Math.min(254, Math.max(1, regionThreshold));
  const upperScale = (255 - baseThreshold) / (255 - safeCropThreshold);
  const lowerScale = baseThreshold / safeCropThreshold;

  for (let row = 0; row < crop.height; row += 1) {
    const y = crop.y + row;
    for (let col = 0; col < crop.width; col += 1) {
      const x = crop.x + col;
      const value = regionMask[row * crop.width + col] ?? 0;
      const harmonized =
        value >= safeCropThreshold
          ? baseThreshold + (value - safeCropThreshold) * upperScale
          : value * lowerScale;
      const index = y * maskWidth + x;
      out[index] = Math.max(out[index] ?? 0, Math.round(harmonized));
    }
  }
  return { data: out, threshold: baseThreshold };
}
