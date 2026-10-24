import type { BeadPattern } from "../../core/pattern";
import { sampleBitmapToGrid } from "../image-import/sample-bitmap";
import type { SampledGridResult } from "../image-import/sample-bitmap";
import { clampCrop } from "../image-crop/crop-math";
import type { CropRect, FitMode } from "../image-crop/crop-math";

export interface RegenSampleInput {
  pattern: BeadPattern;
  bitmap: ImageBitmap;
  /** 工作区当前裁剪；pattern.source.crop 缺失时兜底。 */
  crop: CropRect | null;
  fitMode: FitMode;
  backgroundHex: string;
}

/**
 * R3 · 打开已保存项目后没有 sample 缓冲时，用工作区里的原图重新
 * 采样一次，交给现有 regenSelection。透明策略 / 背景色以图纸
 * settings 为准。返回 null 表示无法可靠采样，调用方保持按钮禁用
 * 并给出「需要原图才能局部再生成」的文案，不得静默失败。
 */
export function deriveRegenSample(input: RegenSampleInput): SampledGridResult | null {
  const { pattern, bitmap, crop, fitMode, backgroundHex } = input;
  const cropRect = resolveRegenCrop(pattern, crop, bitmap.width, bitmap.height);
  if (!cropRect) return null;
  return sampleBitmapToGrid({
    bitmap,
    crop: cropRect,
    gridW: pattern.width,
    gridH: pattern.height,
    fitMode,
    alphaPolicy: pattern.settings.transparentPolicy,
    backgroundHex: pattern.settings.backgroundHex ?? backgroundHex,
  });
}

/**
 * 优先用图纸自带的 source.crop（与生成时一致），工作区裁剪只作兜底；
 * 对位图边界夹紧，取不到有效区域返回 null。
 */
export function resolveRegenCrop(
  pattern: BeadPattern,
  workspaceCrop: CropRect | null,
  bitmapWidth: number,
  bitmapHeight: number,
): CropRect | null {
  const raw = pattern.source.crop ?? workspaceCrop;
  if (!raw || raw.width <= 0 || raw.height <= 0) return null;
  if (bitmapWidth <= 0 || bitmapHeight <= 0) return null;
  const clamped = clampCrop(
    {
      x: Math.round(raw.x),
      y: Math.round(raw.y),
      width: Math.round(raw.width),
      height: Math.round(raw.height),
    },
    bitmapWidth,
    bitmapHeight,
  );
  if (clamped.width <= 0 || clamped.height <= 0) return null;
  return clamped;
}
