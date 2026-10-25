/**
 * S11 · C2 蒙版后处理与有效边界框（纯函数，无 DOM 依赖）。
 *
 * 处理顺序固定：滞后阈值 → 去噪 → 填孔 → 计算有效边界框 → 羽化 → 不透明度归一化。
 * 顺序是契约的一部分：
 * - 边界框在羽化**之前**计算，避免半透明羽化边缘把 bbox 撑大；
 * - 去噪先于填孔，避免把噪点围出的"假孔洞"一起填上；
 * - 滞后阈值先于去噪：先把与强前景连通的弱响应带抢救回来，再去判断哪些块是噪点，
 *   否则同一撮头发会被当成孤立小块删掉；
 * - 不透明度归一化最后做：它只拉伸数值，不改变前景判定，放在收尾保证
 *   输出的蒙版数据可以直接被 C3 当作可见 alpha 使用。
 *
 * 连通性约定：
 * - 前景去噪用 **8 邻域**，细发丝、斜向细线不会被拆成小碎片而误删；
 * - 背景孔洞用 **4 邻域**，与常见图像形态学约定一致，斜缝不会被误判为封闭孔洞。
 *
 * 前景判定沿 C1 契约：`data[i] > threshold` 为主体像素。
 * 所有函数都不修改入参，返回新的 `SubjectMask`（`data` 为新数组）。
 *
 * 1.2 变更（蒙版残缺修复）：
 * - 新增滞后阈值（hysteresis）：模型在低对比区域（棕发贴棕背景、深色衣服贴暗背景）
 *   的置信度会落在「弱响应带」，单一 Otsu 阈值会把成片的主体内部误判成背景。
 *   只要是与强前景（> threshold）连通的弱响应像素（> low），一律并入前景；
 * - 去噪 / 填孔默认面积阈值改为**按图像面积比例**计算（`scaledMaskCleanupAreas`），
 *   绝对像素数（8 / 16）在百万级像素照片上等于没清；
 * - 新增不透明度归一化：把前景数值重新映射到 [FEATHER_OPAQUE_FLOOR, 255]，
 *   背景 ≤ threshold。此前前景内部数值可能只有 60–125，C3 把蒙版值直接当
 *   alpha 用，抠图整体半透明，采样后 alpha<128 的格子全部变空格——这正是
 *   「识别出来的主体残缺、发白」的直接原因。
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
 * 默认值（见 `DEFAULT_MASK_POST_PROCESS`）：滞后阈值开、清理面积按图像面积
 * 比例计算（`scaledMaskCleanupAreas`），羽化半径 1。
 */
export interface MaskPostProcessOptions {
  /** 开启滞后阈值（把与强前景连通的弱响应带并入前景）。默认 `true`。 */
  hysteresis?: boolean;
  /**
   * 滞后低阈值占 `threshold` 的比例（0–1]。弱响应像素值需 **大于**
   * `threshold × lowRatio` 才有资格被并入。默认 `0.55`；设为 `0` 关闭。
   */
  hysteresisLowRatio?: number;
  /** 开启去噪（清除小面积孤立前景连通块）。默认 `true`。 */
  smoothDenoise?: boolean;
  /**
   * 去噪面积阈值：前景连通块像素数 **小于** 该值时清除。
   * 缺省时按图像面积自动缩放（`scaledMaskCleanupAreas`）；显式传数则用绝对值。
   */
  denoiseMinArea?: number;
  /** 开启填孔（填充不与图像边界连通的背景孔洞）。默认 `true`。 */
  fillHoles?: boolean;
  /**
   * 填孔面积上限：封闭背景连通块像素数 **不超过** 该值时填充。
   * 缺省时按图像面积自动缩放；显式传数则用绝对值。
   */
  fillHolesMaxArea?: number;
  /** 开启边缘羽化。默认 `true`。 */
  feather?: boolean;
  /** 羽化半径（像素，整数）。默认 `1`；设为 `0` 关闭羽化。 */
  featherRadius?: number;
}

/**
 * 按图像面积缩放的清理面积。
 *
 * 为什么不再用固定像素数：8 / 16 像素是按小图（几百像素宽）标定的，
 * 在 1200×1600 的照片上，200 像素的噪声块、50×50 的破洞都清不掉/填不上。
 * 比例按经验标定：
 * - 去噪 0.02%（1500×2000 → 600 像素，约 25×25 的碎块）；
 * - 填孔 0.3%（1500×2000 → 9000 像素，约 95×95 的洞）；
 * 两者都设绝对下限，小图行为与旧默认一致。
 */
export function scaledMaskCleanupAreas(
  width: number,
  height: number,
): { denoiseMinArea: number; fillHolesMaxArea: number } {
  const area = Math.max(1, width * height);
  return {
    denoiseMinArea: Math.max(8, Math.round(area * 0.0002)),
    fillHolesMaxArea: Math.max(16, Math.round(area * 0.003)),
  };
}

/** 默认后处理参数（清理面积在运行时按蒙版尺寸解析）。 */
export const DEFAULT_MASK_POST_PROCESS: Readonly<
  Required<Omit<MaskPostProcessOptions, "denoiseMinArea" | "fillHolesMaxArea">>
> &
  Pick<Required<MaskPostProcessOptions>, "denoiseMinArea" | "fillHolesMaxArea"> =
  Object.freeze({
    hysteresis: true,
    hysteresisLowRatio: 0.55,
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
 * 解析并校验后处理参数。缺省字段使用默认值；
 * 清理面积缺省时按蒙版面积自动缩放。
 *
 * 导出以便 UI 侧在真正执行前展示"实际生效的参数"。
 */
export function resolveMaskPostProcessOptions(
  options: MaskPostProcessOptions = {},
  maskSize?: { width: number; height: number },
): Required<MaskPostProcessOptions> {
  const resolved: Required<MaskPostProcessOptions> = {
    hysteresis: options.hysteresis ?? DEFAULT_MASK_POST_PROCESS.hysteresis,
    hysteresisLowRatio:
      options.hysteresisLowRatio ?? DEFAULT_MASK_POST_PROCESS.hysteresisLowRatio,
    smoothDenoise: options.smoothDenoise ?? DEFAULT_MASK_POST_PROCESS.smoothDenoise,
    denoiseMinArea:
      options.denoiseMinArea ??
      (maskSize
        ? scaledMaskCleanupAreas(maskSize.width, maskSize.height).denoiseMinArea
        : DEFAULT_MASK_POST_PROCESS.denoiseMinArea),
    fillHoles: options.fillHoles ?? DEFAULT_MASK_POST_PROCESS.fillHoles,
    fillHolesMaxArea:
      options.fillHolesMaxArea ??
      (maskSize
        ? scaledMaskCleanupAreas(maskSize.width, maskSize.height).fillHolesMaxArea
        : DEFAULT_MASK_POST_PROCESS.fillHolesMaxArea),
    feather: options.feather ?? DEFAULT_MASK_POST_PROCESS.feather,
    featherRadius: options.featherRadius ?? DEFAULT_MASK_POST_PROCESS.featherRadius,
  };
  for (const key of ["smoothDenoise", "fillHoles", "feather", "hysteresis"] as const) {
    if (typeof resolved[key] !== "boolean") {
      throw invalidOptions(`${key} must be a boolean; got ${String(resolved[key])}`);
    }
  }
  if (!Number.isFinite(resolved.hysteresisLowRatio) || resolved.hysteresisLowRatio < 0) {
    throw invalidOptions(
      `hysteresisLowRatio must be a non-negative finite number; got ${String(resolved.hysteresisLowRatio)}`,
    );
  }
  if (resolved.hysteresisLowRatio > 1) {
    throw invalidOptions(
      `hysteresisLowRatio must be within [0, 1]; got ${String(resolved.hysteresisLowRatio)}`,
    );
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
 * 滞后阈值（hysteresis）：把与强前景连通的弱响应带并入前景。
 *
 * 单一 Otsu 阈值在低对比场景会把成片主体内部（棕发贴棕背景、深色衣服贴暗
 * 背景）判成背景——这些像素的模型置信度落在「弱响应带」，但它们与高置信度
 * 的主体核心（脸、手）空间连通。Canny 边缘检测的滞后思想同样适用：
 * - 强种子：`value > threshold`，无条件是前景；
 * - 候补：`threshold × lowRatio < value ≤ threshold`，只有当它能沿
 *   候补/强像素 **4 邻域连通** 到某个强种子时才并入。
 * 4 邻域比 8 邻域保守：斜对角的孤悬弱块不会被牵连。
 *
 * 返回被并入的像素数（0 表示没有像素被抢救）。
 */
function applyHysteresis(mask: SubjectMask, lowRatio: number): number {
  if (lowRatio <= 0) return 0;
  const { width, height, threshold, data } = mask;
  const low = threshold * lowRatio;
  if (low >= threshold) return 0;

  const count = width * height;
  const eligible = new Uint8Array(count); // 候补：> low
  const queue = new Int32Array(count);
  let front = 0;
  let back = 0;

  for (let i = 0; i < count; i += 1) {
    const value = data[i] ?? 0;
    if (value > threshold) {
      // 强种子直接入队，从它们向外扩散。
      queue[back] = i;
      back += 1;
    } else if (value > low) {
      eligible[i] = 1;
    }
  }

  const NEIGHBORS_4_HYST: readonly (readonly [number, number])[] = NEIGHBORS_4;
  let absorbed = 0;
  while (front < back) {
    const index = queue[front] ?? 0;
    front += 1;
    const x = index % width;
    const y = (index - x) / width;
    for (const [dx, dy] of NEIGHBORS_4_HYST) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbor = ny * width + nx;
      if ((eligible[neighbor] ?? 0) === 0) continue;
      eligible[neighbor] = 0;
      data[neighbor] = Math.max(threshold + 1, data[neighbor] ?? 0);
      absorbed += 1;
      queue[back] = neighbor;
      back += 1;
    }
  }
  return absorbed;
}

/** 不透明度归一化的前景下限：归一化后任何前景像素的 alpha 都 ≥ 该值。 */
export const OPAQUE_FLOOR = 129;

/**
 * 不透明度归一化：把蒙版数值重新映射成「可见 alpha」语义。
 *
 * 为什么需要：分割输出的数值是模型置信度（0–255），前景内部经常只有
 * 60–150；而 C3 合成把蒙版值直接当 alpha 权重使用，采样层又以
 * alpha < 128 作为空格判定——低置信度前景会整片半透明甚至变空格，
 * 表现为「抠出来的主体发白、残缺」。
 *
 * 映射（以空格判定线 128 为对称中心，保证覆盖率 ≤ 50% 的格子仍是空格）：
 * - 前景（> threshold）：[threshold, 255] 线性映射到 [OPAQUE_FLOOR, 255]；
 * - 背景（≤ threshold）：[0, threshold] 线性映射到 [0, 127]。
 *
 * 前提：threshold < OPAQUE_FLOOR（adaptiveMaskThreshold 已把 Otsu 夹在
 * [48, 200]）。只改数值不改前景判定：`v > threshold` 的像素归一化后仍然
 * > threshold（129 > 任何 ≤128 的重映射值，且阈值上限 200 < 255）。
 */
function applyOpacityNormalization(mask: SubjectMask): void {
  const { threshold, data } = mask;
  const backgroundCeiling = OPAQUE_FLOOR - 2;
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i] ?? 0;
    if (value > threshold) {
      const span = 255 - threshold;
      data[i] =
        span > 0
          ? Math.min(
              255,
              OPAQUE_FLOOR + Math.round(((value - threshold) / span) * (255 - OPAQUE_FLOOR)),
            )
          : 255;
    } else if (threshold > 0) {
      data[i] = Math.min(backgroundCeiling, Math.round((value / threshold) * backgroundCeiling));
    } else {
      data[i] = Math.min(backgroundCeiling, value);
    }
  }
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
 * 巨型封闭孔洞救援（空心蒙版修复）。
 *
 * 失败模式：线稿 / 白底平涂角色在 DIS 系模型上的显著性图是"描边亮、内部≈0"，
 * 单一阈值后蒙版只剩一圈轮廓线（前景薄、内部全是封闭背景）。旧逻辑的
 * fillHolesMaxArea 只有几千像素，这种动辄几十万像素的内部根本填不上，
 * 用户看到的是"只剩描边的镂空主体"。
 *
 * 修复判据（必须同时满足才填）：
 * - 封闭背景连通块面积 > 总面积 × 0.12（真"洞穿"级别的巨洞）；
 * - 与它相邻的最大前景连通块面积 < 洞面积 × 0.6（包围者是薄壳/线条，
 *   而不是相框、拱门这类"厚前景围出合法空洞"的结构）。
 * 人像叉腰三角缝、相框中空这类合法空洞面积远小于 12% 或包围前景很厚，
 * 都不会触发。
 *
 * 返回填充的像素数。
 */
function applyGiantHoleRescue(mask: SubjectMask): number {
  const { width, height, threshold, data } = mask;
  const count = width * height;
  if (count === 0) return 0;

  const isForeground = (index: number): boolean => (data[index] ?? 0) > threshold;

  // 1) 前景连通块编号与面积（8 邻域与去噪一致，但这里 4/8 只影响块边界归属，
  //    不影响"包围壳是否薄"的判断，取实现更简单的 4 邻域）。
  const fgLabel = new Int32Array(count).fill(-1);
  const fgAreas: number[] = [];
  {
    const stack = new Int32Array(count);
    for (let start = 0; start < count; start += 1) {
      if (fgLabel[start] !== -1 || !isForeground(start)) continue;
      const label = fgAreas.length;
      let top = 0;
      stack[top] = start;
      top += 1;
      fgLabel[start] = label;
      let size = 0;
      while (top > 0) {
        top -= 1;
        const index = stack[top] ?? 0;
        size += 1;
        const x = index % width;
        const y = (index - x) / width;
        for (const [dx, dy] of NEIGHBORS_4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (fgLabel[neighbor] !== -1) continue;
          if (!isForeground(neighbor)) continue;
          fgLabel[neighbor] = label;
          stack[top] = neighbor;
          top += 1;
        }
      }
      fgAreas.push(size);
    }
  }

  // 2) 从边界洪泛外部背景；封闭孔洞 = 非外部背景。
  const external = new Uint8Array(count);
  {
    const stack = new Int32Array(count);
    const floodExternal = (start: number): void => {
      if (external[start] !== 0 || isForeground(start)) return;
      let top = 0;
      stack[top] = start;
      top += 1;
      external[start] = 1;
      while (top > 0) {
        top -= 1;
        const index = stack[top] ?? 0;
        const x = index % width;
        const y = (index - x) / width;
        for (const [dx, dy] of NEIGHBORS_4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (external[neighbor] !== 0) continue;
          if (isForeground(neighbor)) continue;
          external[neighbor] = 1;
          stack[top] = neighbor;
          top += 1;
        }
      }
    };
    for (let x = 0; x < width; x += 1) {
      floodExternal(x);
      if (height > 1) floodExternal((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      floodExternal(y * width);
      if (width > 1) floodExternal(y * width + width - 1);
    }
  }

  // 3) 逐个封闭背景块检查救援判据（面积 > 12% 且包围壳面积 < 洞 × 0.6）。
  const visited = new Uint8Array(count);
  const stack = new Int32Array(count);
  const component = new Int32Array(count);
  let rescuedPixels = 0;

  for (let start = 0; start < count; start += 1) {
    if (visited[start] !== 0) continue;
    if (isForeground(start) || external[start] !== 0) {
      visited[start] = 1;
      continue;
    }
    let top = 0;
    stack[top] = start;
    top += 1;
    visited[start] = 1;
    let size = 0;
    let adjacentBestArea = 0;
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
        if (isForeground(neighbor)) {
          const label = fgLabel[neighbor] ?? -1;
          const area = label >= 0 ? (fgAreas[label] ?? 0) : 0;
          if (area > adjacentBestArea) adjacentBestArea = area;
          continue;
        }
        if (visited[neighbor] !== 0) continue;
        visited[neighbor] = 1;
        stack[top] = neighbor;
        top += 1;
      }
    }

    if (size > count * 0.12 && adjacentBestArea > 0 && adjacentBestArea < size * 0.6) {
      for (let i = 0; i < size; i += 1) {
        data[component[i] ?? 0] = 255;
      }
      rescuedPixels += size;
    }
  }

  return rescuedPixels;
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
 * 完整后处理管线：滞后阈值 → 去噪 → 填孔 → 有效边界框 → 羽化 → 不透明度归一化。
 *
 * 返回的 `bbox` 在羽化前计算，因此不会因羽化扩散而变大；
 * 若需要"羽化后的像素范围"，请对返回的 `mask` 再调用 `computeMaskBBox`。
 * 不透明度归一化只拉伸数值、不改变 `> threshold` 的前景判定，放在 bbox 之后
 * 不影响任何几何结论。
 */
export function postProcessMask(
  mask: SubjectMask,
  options: MaskPostProcessOptions = {},
): MaskPostProcessResult {
  validateMask(mask);
  const resolved = resolveMaskPostProcessOptions(options, {
    width: mask.width,
    height: mask.height,
  });

  let current = cloneMask(mask);
  let absorbedByHysteresis = 0;
  let removedComponents = 0;
  let filledPixels = 0;

  if (resolved.hysteresis && resolved.hysteresisLowRatio > 0) {
    absorbedByHysteresis = applyHysteresis(current, resolved.hysteresisLowRatio);
  }

  if (resolved.smoothDenoise) {
    const result = applyDenoise(current, resolved.denoiseMinArea);
    current = result.mask;
    removedComponents = result.componentCount;
  }

  if (resolved.fillHoles) {
    const result = applyFillHoles(current, resolved.fillHolesMaxArea);
    current = result.mask;
    filledPixels = result.filledPixels;
    // 空心蒙版救援：线稿/平涂角色只剩描边时，把"洞穿级"的封闭内部填回。
    filledPixels += applyGiantHoleRescue(current);
  }

  const bbox = computeMaskBBox(current);

  if (resolved.feather && resolved.featherRadius > 0) {
    current = featherMask(current, resolved.featherRadius);
  }

  applyOpacityNormalization(current);

  return {
    mask: current,
    bbox,
    removedComponents,
    filledPixels: filledPixels + absorbedByHysteresis,
  };
}
