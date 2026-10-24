/**
 * S06 · 裁剪几何（纯函数，无 DOM）。
 * 所有 crop 坐标均为源图像素坐标，最终原样写入 BeadPattern.source.crop。
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropAspectMode = "free" | "locked" | "pattern";
export type FitMode = "fill" | "contain";

export const MIN_CROP_SIZE = 1;

function requireDimensions(imageWidth: number, imageHeight: number): void {
  if (
    !Number.isInteger(imageWidth) ||
    !Number.isInteger(imageHeight) ||
    imageWidth < 1 ||
    imageHeight < 1
  ) {
    throw new RangeError(
      `image dimensions must be positive integers; got ${imageWidth}×${imageHeight}`,
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 取整并强制裁剪矩形留在源图内，宽高至少 1px。 */
export function clampCrop(rect: CropRect, imageWidth: number, imageHeight: number): CropRect {
  requireDimensions(imageWidth, imageHeight);
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  ) {
    throw new RangeError("crop rect values must be finite numbers");
  }
  const width = clamp(Math.round(rect.width), MIN_CROP_SIZE, imageWidth);
  const height = clamp(Math.round(rect.height), MIN_CROP_SIZE, imageHeight);
  const x = clamp(Math.round(rect.x), 0, imageWidth - width);
  const y = clamp(Math.round(rect.y), 0, imageHeight - height);
  return { x, y, width, height };
}

/**
 * 按目标宽高比自动适配。
 * - fill：cover，居中裁掉多余边，铺满目标网格；
 * - contain：保留整张源图，由采样装配层居中留白。
 */
export function computeAutoCrop(
  imageWidth: number,
  imageHeight: number,
  ratio: number,
  fitMode: FitMode,
): CropRect {
  requireDimensions(imageWidth, imageHeight);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new RangeError(`ratio must be > 0; got ${String(ratio)}`);
  }
  if (fitMode === "contain") {
    return { x: 0, y: 0, width: imageWidth, height: imageHeight };
  }

  const imageRatio = imageWidth / imageHeight;
  if (imageRatio > ratio) {
    const width = clamp(Math.round(imageHeight * ratio), 1, imageWidth);
    return { x: Math.floor((imageWidth - width) / 2), y: 0, width, height: imageHeight };
  }
  const height = clamp(Math.round(imageWidth / ratio), 1, imageHeight);
  return { x: 0, y: Math.floor((imageHeight - height) / 2), width: imageWidth, height };
}

/** 在现有矩形内收缩到指定比例（保持中心），用于切换锁定比例。 */
export function fitRectToAspect(
  rect: CropRect,
  ratio: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new RangeError(`ratio must be > 0; got ${String(ratio)}`);
  }
  let width = rect.width;
  let height = width / ratio;
  if (height > rect.height) {
    height = rect.height;
    width = height * ratio;
  }
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return clampCrop(
    { x: centerX - width / 2, y: centerY - height / 2, width, height },
    imageWidth,
    imageHeight,
  );
}

export interface InnerGrid {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

/**
 * contain 模式的居中内网格：把 crop 的宽高比装进 gridW×gridH，剩余为留白格。
 * 结果保证 1 ≤ width ≤ gridW、1 ≤ height ≤ gridH。
 */
export function containInnerGrid(
  gridW: number,
  gridH: number,
  cropWidth: number,
  cropHeight: number,
): InnerGrid {
  if (
    !Number.isInteger(gridW) ||
    !Number.isInteger(gridH) ||
    gridW < 1 ||
    gridH < 1 ||
    !Number.isFinite(cropWidth) ||
    !Number.isFinite(cropHeight) ||
    cropWidth <= 0 ||
    cropHeight <= 0
  ) {
    throw new RangeError(
      `invalid contain inputs: grid ${gridW}×${gridH}, crop ${cropWidth}×${cropHeight}`,
    );
  }

  const targetRatio = gridW / gridH;
  const cropRatio = cropWidth / cropHeight;
  let width: number;
  let height: number;
  if (cropRatio >= targetRatio) {
    width = gridW;
    height = clamp(Math.round(gridW / cropRatio), 1, gridH);
  } else {
    height = gridH;
    width = clamp(Math.round(gridH * cropRatio), 1, gridW);
  }
  return {
    width,
    height,
    offsetX: Math.floor((gridW - width) / 2),
    offsetY: Math.floor((gridH - height) / 2),
  };
}
