/**
 * S06 · 从 ImageBitmap 取像素并调用纯函数 sampleToGrid。
 *
 * 这里是 DOM 与 core/sampling 的唯一接缝：
 * - 裁剪区域按源图像素 1:1 画到离屏 canvas，再 getImageData；
 * - fill：直接采样到 gridW×gridH；
 * - contain：先按内容比例采样到内网格，再在周围补空格 / 背景色格。
 *
 * 色卡匹配不在此处发生（S07+）。
 */

import { hexToRgb } from "../../core/color";
import { sampleToGrid } from "../../core/sampling";
import type { AlphaPolicy, CropRect } from "../../core/sampling";
import { containInnerGrid } from "../image-crop/crop-math";
import type { FitMode, InnerGrid } from "../image-crop/crop-math";

export interface SampleBitmapInput {
  bitmap: ImageBitmap;
  crop: CropRect;
  gridW: number;
  gridH: number;
  fitMode: FitMode;
  alphaPolicy: AlphaPolicy;
  backgroundHex?: string;
}

export interface SampledGridResult {
  rgb: Uint8ClampedArray;
  alpha: Uint8Array;
  width: number;
  height: number;
  innerGrid: InnerGrid | null;
  /** 预览必须结合策略判断“是否空格”；background 下 alpha=0 也不是空格。 */
  alphaPolicy: AlphaPolicy;
  emptyCount: number;
}

function createCropImageData(bitmap: ImageBitmap, crop: CropRect): ImageData {
  const width = Math.max(1, Math.round(crop.width));
  const height = Math.max(1, Math.round(crop.height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("浏览器无法创建 2D 画布，采样失败。请换用支持 Canvas 2D 的浏览器。");
  }
  context.drawImage(bitmap, crop.x, crop.y, width, height, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function countEmpty(alpha: Uint8Array): number {
  let empty = 0;
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] === 0) empty += 1;
  }
  return empty;
}

export function sampleBitmapToGrid(input: SampleBitmapInput): SampledGridResult {
  const { bitmap, crop, gridW, gridH, fitMode, alphaPolicy, backgroundHex } = input;
  const imageData = createCropImageData(bitmap, crop);
  const wholeCrop: CropRect = {
    x: 0,
    y: 0,
    width: imageData.width,
    height: imageData.height,
  };

  if (fitMode === "fill") {
    const sampled = sampleToGrid(imageData, gridW, gridH, wholeCrop, alphaPolicy, backgroundHex);
    return {
      rgb: sampled.rgb,
      alpha: sampled.alpha,
      width: gridW,
      height: gridH,
      innerGrid: null,
      alphaPolicy,
      emptyCount: alphaPolicy === "background" ? 0 : countEmpty(sampled.alpha),
    };
  }

  const inner = containInnerGrid(gridW, gridH, imageData.width, imageData.height);
  const sampled = sampleToGrid(
    imageData,
    inner.width,
    inner.height,
    wholeCrop,
    alphaPolicy,
    backgroundHex,
  );

  const paddedRgb = new Uint8ClampedArray(gridW * gridH * 3);
  const paddedAlpha = new Uint8Array(gridW * gridH);

  if (alphaPolicy === "background") {
    const background = hexToRgb(backgroundHex ?? "#FFFFFF");
    for (let index = 0; index < gridW * gridH; index += 1) {
      paddedRgb[index * 3] = background.r;
      paddedRgb[index * 3 + 1] = background.g;
      paddedRgb[index * 3 + 2] = background.b;
      paddedAlpha[index] = 255;
    }
  }

  for (let y = 0; y < inner.height; y += 1) {
    for (let x = 0; x < inner.width; x += 1) {
      const sourceCell = y * inner.width + x;
      const targetCell = (inner.offsetY + y) * gridW + (inner.offsetX + x);
      paddedRgb[targetCell * 3] = sampled.rgb[sourceCell * 3] ?? 0;
      paddedRgb[targetCell * 3 + 1] = sampled.rgb[sourceCell * 3 + 1] ?? 0;
      paddedRgb[targetCell * 3 + 2] = sampled.rgb[sourceCell * 3 + 2] ?? 0;
      paddedAlpha[targetCell] = sampled.alpha[sourceCell] ?? 0;
    }
  }

  return {
    rgb: paddedRgb,
    alpha: paddedAlpha,
    width: gridW,
    height: gridH,
    innerGrid: inner,
    alphaPolicy,
    emptyCount: alphaPolicy === "background" ? 0 : countEmpty(paddedAlpha),
  };
}
