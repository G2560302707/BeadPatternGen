/**
 * S11 · C2 蒙版后处理与有效边界框（纯函数，无 DOM 依赖）。
 *
 * 处理顺序固定：去噪 → 填孔 → 计算有效边界框 → 羽化。
 * 顺序是契约的一部分：
 * - 边界框在羽化**之前**计算，避免半透明羽化边缘把 bbox 撑大；
 * - 去噪先于填孔，避免把噪点围出的"假孔洞"一起填上。
 *
 * 连通性约定：
 * - 前景去噪用 **8 邻域**，细发丝、斜向细线不会被拆成小碎片而误删；
 * - 背景孔洞用 **4 邻域**，与常见图像形态学约定一致，斜缝不会被误判为封闭孔洞。
 *
 * 前景判定沿 C1 契约：`data[i] > threshold` 为主体像素。
 * 所有函数都不修改入参，返回新的 `SubjectMask`（`data` 为新数组）。
 */

import type { BBox, SubjectMask } from "./types";

export type MaskErrorCode = "INVALID_MASK" | "INVALID_OPTIONS";

export class MaskError extends Error {
  readonly code: MaskErrorCode;

  constructor(code: MaskErrorCode, message: string) {
    super(message);
    this.name = "MaskError";
    this.code = code;
  }
}

/**
 * 后处理参数。每个步骤都可单独开关，数值阈值同时表达"强度"。
 *
 * 默认值刻意保守（见 `DEFAULT_MASK_POST_PROCESS`）：只清除极小噪点和小孔洞，
 * 羽化半径 1，目标是保留发丝、纹理等细结构。
 */
export interface MaskPostProcessOptions {
  /** 开启去噪（清除小面积孤立前景连通块）。默认 `true`。 */
  smoothDenoise?: boolean;
  /**
   * 去噪面积阈值：前景连通块像素数 **小于** 该值时清除。
   * 默认 `8`；设为 `0` 等价于不删任何连通块。
   */
  denoiseMinArea?: number;
  /** 开启填孔（填充不与图像边界连通的背景孔洞）。默认 `true`。 */
  fillHoles?: boolean;
  /**
   * 填孔面积上限：封闭背景连通块像素数 **不超过** 该值时填充。
   * 默认 `16`；设为 `0` 等价于不填任何孔洞。
   */
  fillHolesMaxArea?: number;
  /** 开启边缘羽化。默认 `true`。 */
  feather?: boolean;
  /** 羽化半径（像素，整数）。默认 `1`；设为 `0` 关闭羽化。 */
  featherRadius?: number;
}

/** 保守的默认参数。 */
export const DEFAULT_MASK_POST_PROCESS: Readonly<Required<MaskPostProcessOptions>> = Object.freeze({
  smoothDenoise: true,
  denoiseMinArea: 8,
  fillHoles: true,
  fillHolesMaxArea: 16,
  feather: true,
  featherRadius: 1,
});

/** 后处理结果。`bbox` 为 `null` 表示处理后没有任何前景像素。 */
export interface MaskPostProcessResult {
  mask: SubjectMask;
  /** 有效边界框（原图坐标系）；已忽略被清除的孤立噪点。 */
  bbox: BBox | null;
  /** 被去噪清除的连通块数量（便于日志 / 诊断）。 */
  removedComponents: number;
  /** 被填孔补充的像素数量。 */
  filledPixels: number;
}

/** 8 邻域偏移，顺序固定（不影响结果，只影响遍历顺序）。 */
const NEIGHBORS_8: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** 4 邻域偏移，用于背景孔洞洪泛。 */
const NEIGHBORS_4: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

function invalidMask(message: string): MaskError {
  return new MaskError("INVALID_MASK", message);
}

function invalidOptions(message: string): MaskError {
  return new MaskError("INVALID_OPTIONS", message);
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw invalidOptions(`${label} must be a non-negative integer; got ${String(value)}`);
  }
}

function validateMask(mask: SubjectMask): void {
  if (!mask || typeof mask !== "object") {
    throw invalidMask("mask must be an object");
  }
  if (!Number.isInteger(mask.width) || !Number.isInteger(mask.height)) {
    throw invalidMask(
      `mask width/height must be integers; got ${String(mask.width)}×${String(mask.height)}`,
    );
  }
  if (mask.width < 1 || mask.height < 1) {
    throw invalidMask(`mask width/height must be positive; got ${mask.width}×${mask.height}`);
  }
  if (mask.encoding !== "raw-alpha8") {
    throw invalidMask(`unsupported mask encoding ${JSON.stringify(mask.encoding)}`);
  }
  if (!(mask.data instanceof Uint8ClampedArray)) {
    throw invalidMask("mask.data must be a Uint8ClampedArray");
  }
  const expected = mask.width * mask.height;
  if (mask.data.length !== expected) {
    throw invalidMask(
      `mask.data.length must be width*height=${expected}; got ${String(mask.data.length)}`,
    );
  }
  if (!Number.isFinite(mask.threshold) || mask.threshold < 0 || mask.threshold > 255) {
    throw invalidMask(`mask.threshold must be within [0, 255]; got ${String(mask.threshold)}`);
  }
}

function validateThreshold(threshold: number): void {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
    throw invalidMask(`threshold must be within [0, 255]; got ${String(threshold)}`);
  }
}

function cloneMask(mask: SubjectMask): SubjectMask {
  return { ...mask, data: new Uint8ClampedArray(mask.data) };
}

function isForeground(data: Uint8ClampedArray, index: number, threshold: number): boolean {
  return (data[index] ?? 0) > threshold;
}

/**
 * 解析并校验后处理参数。缺省字段使用保守默认值。
 *
 * 导出以便 UI 侧在真正执行前展示"实际生效的参数"。
 */
export function resolveMaskPostProcessOptions(
  options: MaskPostProcessOptions = {},
): Required<MaskPostProcessOptions> {
  const resolved: Required<MaskPostProcessOptions> = {
    smoothDenoise: options.smoothDenoise ?? DEFAULT_MASK_POST_PROCESS.smoothDenoise,
    denoiseMinArea: options.denoiseMinArea ?? DEFAULT_MASK_POST_PROCESS.denoiseMinArea,
    fillHoles: options.fillHoles ?? DEFAULT_MASK_POST_PROCESS.fillHoles,
    fillHolesMaxArea: options.fillHolesMaxArea ?? DEFAULT_MASK_POST_PROCESS.fillHolesMaxArea,
    feather: options.feather ?? DEFAULT_MASK_POST_PROCESS.feather,
    featherRadius: options.featherRadius ?? DEFAULT_MASK_POST_PROCESS.featherRadius,
  };
  for (const key of ["smoothDenoise", "fillHoles", "feather"] as const) {
    if (typeof resolved[key] !== "boolean") {
      throw invalidOptions(`${key} must be a boolean; got ${String(resolved[key])}`);
    }
  }
  assertNonNegativeInteger(resolved.denoiseMinArea, "denoiseMinArea");
  assertNonNegativeInteger(resolved.fillHolesMaxArea, "fillHolesMaxArea");
  assertNonNegativeInteger(resolved.featherRadius, "featherRadius");
  return resolved;
}

interface ComponentScanResult {
  mask: SubjectMask;
  componentCount: number;
}

/** 8 邻域扫描前景连通块，把面积小于阈值的块清零。 */
function applyDenoise(mask: SubjectMask, minArea: number): ComponentScanResult {
  const out = cloneMask(mask);
  if (minArea <= 1) return { mask: out, componentCount: 0 };

  const { width, height, threshold } = out;
  const data = out.data;
  const count = width * height;
  const visited = new Uint8Array(count);
  const stack = new Int32Array(count);
  const component = new Int32Array(count);
  let removed = 0;

  for (let start = 0; start < count; start += 1) {
    if ((visited[start] ?? 0) !== 0 || !isForeground(data, start, threshold)) continue;

    let top = 0;
    stack[top] = start;
    top += 1;
    visited[start] = 1;
    let size = 0;

    while (top > 0) {
      top -= 1;
      const index = stack[top] ?? 0;
      component[size] = index;
      size += 1;

      const x = index % width;
      const y = (index - x) / width;
      for (const [dx, dy] of NEIGHBORS_8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if ((visited[neighbor] ?? 0) !== 0) continue;
        if (!isForeground(data, neighbor, threshold)) continue;
        visited[neighbor] = 1;
        stack[top] = neighbor;
        top += 1;
      }
    }

    if (size < minArea) {
      for (let i = 0; i < size; i += 1) {
        data[component[i] ?? 0] = 0;
      }
      removed += 1;
    }
  }

  return { mask: out, componentCount: removed };
}

interface FillResult {
  mask: SubjectMask;
  filledPixels: number;
}

/**
 * 4 邻域洪泛：从图像边界出发标记所有"外部背景"，未被标记的背景连通块即为封闭孔洞。
 * 面积不超过 `maxArea` 的孔洞填充为 255。
 */
function applyFillHoles(mask: SubjectMask, maxArea: number): FillResult {
  const out = cloneMask(mask);
  if (maxArea <= 0) return { mask: out, filledPixels: 0 };

  const { width, height, threshold } = out;
  const data = out.data;
  const count = width * height;
  const visited = new Uint8Array(count);
  const stack = new Int32Array(count);
  const component = new Int32Array(count);

  const isBackground = (index: number): boolean => !isForeground(data, index, threshold);

  const flood = (start: number): number => {
    let top = 0;
    stack[top] = start;
    top += 1;
    visited[start] = 1;
    let size = 0;

    while (top > 0) {
      top -= 1;
      const index = stack[top] ?? 0;
      component[size] = index;
      size += 1;

      const x = index % width;
      const y = (index - x) / width;
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if ((visited[neighbor] ?? 0) !== 0) continue;
        if (!isBackground(neighbor)) continue;
        visited[neighbor] = 1;
        stack[top] = neighbor;
        top += 1;
      }
    }

    return size;
  };

  // 1) 从四条边把所有与外部连通的背景标记为已访问。
  for (let x = 0; x < width; x += 1) {
    const topIndex = x;
    if (isBackground(topIndex) && (visited[topIndex] ?? 0) === 0) flood(topIndex);
    if (height > 1) {
      const bottomIndex = (height - 1) * width + x;
      if (isBackground(bottomIndex) && (visited[bottomIndex] ?? 0) === 0) flood(bottomIndex);
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    const leftIndex = y * width;
    if (isBackground(leftIndex) && (visited[leftIndex] ?? 0) === 0) flood(leftIndex);
    if (width > 1) {
      const rightIndex = leftIndex + width - 1;
      if (isBackground(rightIndex) && (visited[rightIndex] ?? 0) === 0) flood(rightIndex);
    }
  }

  // 2) 剩余未访问的背景连通块都是封闭孔洞。
  let filledPixels = 0;
  for (let start = 0; start < count; start += 1) {
    if ((visited[start] ?? 0) !== 0 || !isBackground(start)) continue;
    const size = flood(start);
    if (size <= maxArea) {
      for (let i = 0; i < size; i += 1) {
        data[component[i] ?? 0] = 255;
      }
      filledPixels += size;
    }
  }

  return { mask: out, filledPixels };
}

/**
 * 可分离的归一化盒式滤波（边界窗口按实际覆盖像素数归一化）。
 *
 * 为什么不用高斯：盒式滤波核更小、结果可用整数前缀和精确复现，
 * 在"轻度羽化"这个量级上视觉差异可以忽略，且更容易做确定性测试。
 */
function boxBlur(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  const count = width * height;
  const temp = new Float64Array(count);
  const prefix = new Float64Array(Math.max(width, height) + 1);
  const out = new Uint8ClampedArray(count);

  // 横向
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    prefix[0] = 0;
    for (let x = 0; x < width; x += 1) {
      prefix[x + 1] = (prefix[x] ?? 0) + (data[row + x] ?? 0);
    }
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const sum = (prefix[right + 1] ?? 0) - (prefix[left] ?? 0);
      temp[row + x] = sum / (right - left + 1);
    }
  }

  // 纵向
  for (let x = 0; x < width; x += 1) {
    prefix[0] = 0;
    for (let y = 0; y < height; y += 1) {
      prefix[y + 1] = (prefix[y] ?? 0) + (temp[y * width + x] ?? 0);
    }
    for (let y = 0; y < height; y += 1) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      const sum = (prefix[bottom + 1] ?? 0) - (prefix[top] ?? 0);
      out[y * width + x] = sum / (bottom - top + 1);
    }
  }

  return out;
}

/** 单独执行去噪（清除面积小于 `minArea` 的前景连通块）。 */
export function denoiseMask(mask: SubjectMask, minArea: number): SubjectMask {
  validateMask(mask);
  assertNonNegativeInteger(minArea, "minArea");
  return applyDenoise(mask, minArea).mask;
}

/** 单独执行填孔（填充面积不超过 `maxArea` 的封闭背景孔洞）。 */
export function fillMaskHoles(mask: SubjectMask, maxArea: number): SubjectMask {
  validateMask(mask);
  assertNonNegativeInteger(maxArea, "maxArea");
  return applyFillHoles(mask, maxArea).mask;
}

/**
 * 羽化时前景像素向模糊结果靠拢的比例。
 *
 * 刻意取一个很小的值：羽化的目标是"边缘更顺"，而不是把主体整体调淡。
 * 配合下面的保细节规则，1 像素宽的发丝 / 细线不会被降到前景阈值以下。
 */
const FEATHER_STRENGTH = 0.25;

/**
 * 单独执行边缘羽化（归一化盒式滤波 + 保细节规则）。
 *
 * 保细节规则（这是 C2 的重要契约，防止"越处理越少"）：
 * - 原本就是前景的像素：只向模糊结果混合 25%，且结果不低于 `threshold + 1`，
 *   因此细线、发丝、尖角不会因为邻域平均而整段消失；
 * - 原本是背景的像素：模糊结果封顶到 `threshold`，只在主体外侧产生半透明过渡，
 *   不会因为羽化凭空扩大前景判定范围。
 */
export function featherMask(mask: SubjectMask, radius: number): SubjectMask {
  validateMask(mask);
  assertNonNegativeInteger(radius, "radius");
  const out = cloneMask(mask);
  if (radius === 0) return out;

  const blurred = boxBlur(out.data, out.width, out.height, radius);
  const threshold = mask.threshold;
  const foregroundFloor = Math.min(255, threshold + 1);
  const source = out.data;

  for (let index = 0; index < source.length; index += 1) {
    const original = source[index] ?? 0;
    const smooth = blurred[index] ?? 0;
    if (original > threshold) {
      const blended = original * (1 - FEATHER_STRENGTH) + smooth * FEATHER_STRENGTH;
      out.data[index] = Math.max(foregroundFloor, Math.round(blended));
    } else {
      out.data[index] = Math.min(threshold, Math.round(smooth));
    }
  }

  return out;
}

/**
 * 计算蒙版有效边界框（原图坐标系）。没有任何前景像素时返回 `null`。
 *
 * 注意：本函数只看像素阈值，不做去噪；需要"忽略孤立噪点"的 bbox 时，
 * 应使用 `postProcessMask` 的返回值，或先调用 `denoiseMask`。
 */
export function computeMaskBBox(
  mask: SubjectMask,
  threshold: number = mask.threshold,
): BBox | null {
  validateMask(mask);
  validateThreshold(threshold);

  const { width, height, data } = mask;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (!isForeground(data, row + x, threshold)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * 完整后处理管线：去噪 → 填孔 → 有效边界框 → 羽化。
 *
 * 返回的 `bbox` 在羽化前计算，因此不会因羽化扩散而变大；
 * 若需要"羽化后的像素范围"，请对返回的 `mask` 再调用 `computeMaskBBox`。
 */
export function postProcessMask(
  mask: SubjectMask,
  options: MaskPostProcessOptions = {},
): MaskPostProcessResult {
  validateMask(mask);
  const resolved = resolveMaskPostProcessOptions(options);

  let current = mask;
  let removedComponents = 0;
  let filledPixels = 0;

  if (resolved.smoothDenoise) {
    const result = applyDenoise(current, resolved.denoiseMinArea);
    current = result.mask;
    removedComponents = result.componentCount;
  }

  if (resolved.fillHoles) {
    const result = applyFillHoles(current, resolved.fillHolesMaxArea);
    current = result.mask;
    filledPixels = result.filledPixels;
  }

  const bbox = computeMaskBBox(current);

  if (resolved.feather && resolved.featherRadius > 0) {
    current = featherMask(current, resolved.featherRadius);
  }

  return { mask: current, bbox, removedComponents, filledPixels };
}
