/**
 * S11 · C3 合成模块（纯像素运算，无 DOM）。
 *
 * 输出为行优先 RGBA（直通 alpha），结构上兼容 `ImageData`，可直接交给
 * `src/core/pipeline` / `sampleToGrid` 作为输入图像，也可由上层画到 Canvas。
 *
 * 确定性保证：
 * - 不使用 `Math.random` / `Date` / 任何遍历顺序不稳定的容器；
 * - 采样固定为最近邻（`floor` 取整），不使用浏览器实现相关的图像缩放；
 * - 同输入 + 同 `COMPOSITION_ALGORITHM_VERSION` 输出逐字节一致。
 *
 * Alpha 语义：
 * - 蒙版置信度直接作为主体 alpha 权重（保留 C2 羽化产生的过渡），
 *   再与源图 alpha 相乘：`effective = mask * sourceAlpha / 255`；
 * - `transparent` 背景：背景像素输出 `(0, 0, 0, 0)`，**永远不会**输出不透明的黑色；
 * - `solid` / `image` 背景：画布输出不透明（alpha = 255），主体与背景做 source-over 合成；
 * - `image` 背景按 `cover`（等比铺满、居中裁切）映射；背景图自身带 alpha 时先合成到白色上。
 */

import { isSubjectMask } from "../subject";
import type { SubjectMask } from "../subject";
import { computeCompositionPlan } from "./geometry";
import { CompositionError } from "./types";
import type { ComposeInput, ComposeResult, RgbaImage } from "./types";

/** `cover` 缩放时，把画布坐标映射回源图坐标的查找表。 */
interface CoverAxisMap {
  /** 画布每个整数坐标对应的源图坐标（已 clamp 到源图范围）。 */
  indices: Int32Array;
}

function invalidImage(label: string, image: RgbaImage): void {
  if (!image || typeof image !== "object") {
    throw new CompositionError("E_SOURCE_INVALID", `${label} must be an object`);
  }
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height)) {
    throw new CompositionError(
      "E_SOURCE_INVALID",
      `${label} width/height must be integers; got ${String(image.width)}×${String(image.height)}`,
    );
  }
  if (image.width < 1 || image.height < 1) {
    throw new CompositionError(
      "E_SOURCE_INVALID",
      `${label} width/height must be positive; got ${image.width}×${image.height}`,
    );
  }
  if (!(image.data instanceof Uint8ClampedArray)) {
    throw new CompositionError("E_SOURCE_INVALID", `${label}.data must be a Uint8ClampedArray`);
  }
  const expected = image.width * image.height * 4;
  if (image.data.length !== expected) {
    throw new CompositionError(
      "E_SOURCE_INVALID",
      `${label}.data.length must be width*height*4=${expected}; got ${image.data.length}`,
    );
  }
}

function validateMask(mask: SubjectMask, source: RgbaImage): void {
  if (!isSubjectMask(mask)) {
    throw new CompositionError("E_MASK_INVALID", "mask does not satisfy the SubjectMask contract");
  }
  if (mask.width !== source.width || mask.height !== source.height) {
    throw new CompositionError(
      "E_MASK_SIZE_MISMATCH",
      `mask is ${mask.width}×${mask.height} but source is ${source.width}×${source.height}`,
    );
  }
}

function parseSolidColor(value: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (!match?.[1]) {
    // isCompositionParams 已校验格式，此处仅防御。
    throw new CompositionError(
      "E_PARAMS_INVALID",
      `invalid solid background ${JSON.stringify(value)}`,
    );
  }
  const body = match[1];
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

function buildCoverAxis(destLength: number, sourceLength: number, scale: number): CoverAxisMap {
  const offset = (destLength - sourceLength * scale) / 2;
  const indices = new Int32Array(destLength);
  for (let index = 0; index < destLength; index += 1) {
    const source = Math.floor((index + 0.5 - offset) / scale);
    indices[index] = Math.min(sourceLength - 1, Math.max(0, source));
  }
  return { indices };
}

/**
 * 把背景图按 cover 填充到输出画布。
 * 背景图 alpha 先与白色合成，保证画布不透明且颜色可预期。
 */
function fillImageBackground(
  output: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  background: RgbaImage,
): void {
  const scale = Math.max(canvasWidth / background.width, canvasHeight / background.height);
  const xMap = buildCoverAxis(canvasWidth, background.width, scale);
  const yMap = buildCoverAxis(canvasHeight, background.height, scale);

  for (let y = 0; y < canvasHeight; y += 1) {
    const sourceY = yMap.indices[y] ?? 0;
    for (let x = 0; x < canvasWidth; x += 1) {
      const sourceX = xMap.indices[x] ?? 0;
      const sourceOffset = (sourceY * background.width + sourceX) * 4;
      const alpha = (background.data[sourceOffset + 3] ?? 255) / 255;
      const out = (y * canvasWidth + x) * 4;
      output[out] = (background.data[sourceOffset] ?? 0) * alpha + 255 * (1 - alpha);
      output[out + 1] = (background.data[sourceOffset + 1] ?? 0) * alpha + 255 * (1 - alpha);
      output[out + 2] = (background.data[sourceOffset + 2] ?? 0) * alpha + 255 * (1 - alpha);
      output[out + 3] = 255;
    }
  }
}

/**
 * 按构图参数合成一张 RGBA 画布。
 *
 * 几何由 `computeCompositionPlan` 负责：主体矩形已被夹紧到内容区，
 * 因此本函数不会输出越界主体；若用户 offset 过大，`result.plan.suggestion` 给出修正值。
 */
export function composeImage(input: ComposeInput): ComposeResult {
  const { source, mask, bbox, params, backgroundImage } = input;

  invalidImage("source", source);
  validateMask(mask, source);

  // 这里同时校验 bbox 与 params，错误 code 分别落在 E_BBOX_INVALID / E_PARAMS_INVALID。
  const plan = computeCompositionPlan(source.width, source.height, bbox, params);

  const canvasWidth = params.canvasWidth;
  const canvasHeight = params.canvasHeight;
  const pixelCount = canvasWidth * canvasHeight;
  const output = new Uint8ClampedArray(pixelCount * 4);

  const opaqueBackground = params.backgroundType !== "transparent";
  if (params.backgroundType === "solid") {
    const color = parseSolidColor(params.backgroundValue ?? "");
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      output[offset] = color.r;
      output[offset + 1] = color.g;
      output[offset + 2] = color.b;
      output[offset + 3] = 255;
    }
  } else if (params.backgroundType === "image") {
    if (!backgroundImage) {
      throw new CompositionError(
        "E_BACKGROUND_REQUIRED",
        'backgroundType is "image" but backgroundImage was not provided',
      );
    }
    invalidImage("backgroundImage", backgroundImage);
    fillImageBackground(output, canvasWidth, canvasHeight, backgroundImage);
  }
  // transparent：保持全 0，特别是 alpha = 0，后续采样会识别为空格而不是黑色。

  const rect = plan.subjectRect;
  const xStart = Math.max(0, Math.floor(rect.x));
  const xEnd = Math.min(canvasWidth, Math.ceil(rect.x + rect.width));
  const yStart = Math.max(0, Math.floor(rect.y));
  const yEnd = Math.min(canvasHeight, Math.ceil(rect.y + rect.height));

  const sourceData = source.data;
  const maskData = mask.data;
  const sourceWidth = source.width;
  const maskWidth = mask.width;

  for (let y = yStart; y < yEnd; y += 1) {
    const v = (y + 0.5 - rect.y) / rect.height;
    if (v < 0 || v >= 1) continue;
    const sourceY = bbox.y + Math.min(bbox.height - 1, Math.floor(v * bbox.height));

    for (let x = xStart; x < xEnd; x += 1) {
      const u = (x + 0.5 - rect.x) / rect.width;
      if (u < 0 || u >= 1) continue;
      const sourceX = bbox.x + Math.min(bbox.width - 1, Math.floor(u * bbox.width));

      const maskIndex = sourceY * maskWidth + sourceX;
      const maskAlpha = maskData[maskIndex] ?? 0;
      if (maskAlpha === 0) continue;

      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const sourceAlpha = sourceData[sourceOffset + 3] ?? 0;
      const effectiveAlpha = (maskAlpha * sourceAlpha) / 255;
      if (effectiveAlpha <= 0) continue;

      const outOffset = (y * canvasWidth + x) * 4;
      const ratio = effectiveAlpha / 255;

      if (opaqueBackground) {
        const backgroundR = output[outOffset] ?? 0;
        const backgroundG = output[outOffset + 1] ?? 0;
        const backgroundB = output[outOffset + 2] ?? 0;
        output[outOffset] = (sourceData[sourceOffset] ?? 0) * ratio + backgroundR * (1 - ratio);
        output[outOffset + 1] =
          (sourceData[sourceOffset + 1] ?? 0) * ratio + backgroundG * (1 - ratio);
        output[outOffset + 2] =
          (sourceData[sourceOffset + 2] ?? 0) * ratio + backgroundB * (1 - ratio);
        output[outOffset + 3] = 255;
      } else {
        // 直通 alpha：保留源颜色，透明度由 alpha 表达；不向透明区域混入背景色。
        output[outOffset] = sourceData[sourceOffset] ?? 0;
        output[outOffset + 1] = sourceData[sourceOffset + 1] ?? 0;
        output[outOffset + 2] = sourceData[sourceOffset + 2] ?? 0;
        output[outOffset + 3] = effectiveAlpha;
      }
    }
  }

  return {
    image: { width: canvasWidth, height: canvasHeight, data: output },
    plan,
  };
}
