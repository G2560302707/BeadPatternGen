/**
 * S06 · 面积采样（纯函数，无 DOM 依赖）。
 *
 * 本文件刻意不引用 document / canvas / Worker：入参是结构上兼容 ImageData 的对象，
 * 只读取 width / height / data。S10 装配 Worker 时可把本模块整体搬进去。
 *
 * 采样语义：
 * - 目标网格的每个格子在 crop 内对应一个连续矩形区域；
 * - 按源像素与格区矩形的真实交叠面积加权（非整数比例不做取整近似）；
 * - 颜色在 sRGB 空间求平均，不转线性光；
 * - 透明度：颜色按 coverage × (alpha/255) 预乘累计，避免透明像素的任意 RGB 污染；
 *   alpha 输出为本格按覆盖面积的算术平均值；
 * - alphaPolicy="empty" 且平均 alpha < 128 时，该格输出 alpha=0，作为“空格”标记；
 * - alphaPolicy="background" 时，逐像素合成到 backgroundHex 上，输出 RGB 已不透明化，
 *   但 alpha 字段仍保留平均 alpha（透明度信息不被静默丢弃）；
 * - 格区面积 < 1 平方像素（放大网格）时，退化为格中心最近的单个源像素，权重记为 1，
 *   保证永不出现 0 面积 / NaN。
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AlphaPolicy = "empty" | "background";

/** 空格的 alpha 判定阈值。写入 docs：VECTORS.md 同步注明。 */
export const EMPTY_ALPHA_THRESHOLD = 128;

const EPSILON = 1e-9;

export type SamplingErrorCode =
  "INVALID_IMAGE" | "INVALID_GRID" | "INVALID_CROP" | "INVALID_ALPHA_POLICY" | "INVALID_BACKGROUND";

export class SamplingError extends Error {
  readonly code: SamplingErrorCode;

  constructor(code: SamplingErrorCode, message: string) {
    super(message);
    this.name = "SamplingError";
    this.code = code;
  }
}

export interface SampledGrid {
  /** 长度 gridW*gridH*3，sRGB 0–255。 */
  rgb: Uint8ClampedArray;
  /** 长度 gridW*gridH，0–255。empty 策略下空格为 0。 */
  alpha: Uint8Array;
}

export interface CellSpan {
  px: number;
  py: number;
  weight: number;
}

export interface CellCoverage {
  spans: CellSpan[];
  /** 格区在源图中的几何面积（平方像素）。放大退化时仍报告真实几何面积。 */
  regionArea: number;
  nearestFallback: boolean;
}

interface RGBColor {
  r: number;
  g: number;
  b: number;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new SamplingError(
      "INVALID_CROP",
      `${label} must be a finite number; got ${String(value)}`,
    );
  }
}

function validateImage(img: ImageData): void {
  if (!img || typeof img !== "object") {
    throw new SamplingError("INVALID_IMAGE", "img must be an ImageData-like object");
  }
  if (
    !Number.isInteger(img.width) ||
    !Number.isInteger(img.height) ||
    img.width < 1 ||
    img.height < 1
  ) {
    throw new SamplingError(
      "INVALID_IMAGE",
      `img.width/height must be positive integers; got ${String(img.width)}×${String(img.height)}`,
    );
  }
  const expected = img.width * img.height * 4;
  if (!img.data || img.data.length !== expected) {
    throw new SamplingError(
      "INVALID_IMAGE",
      `img.data.length must be width*height*4=${expected}; got ${String(img.data?.length)}`,
    );
  }
}

function validateGrid(gridW: number, gridH: number): void {
  if (!Number.isInteger(gridW) || !Number.isInteger(gridH) || gridW < 1 || gridH < 1) {
    throw new SamplingError(
      "INVALID_GRID",
      `gridW/gridH must be positive integers; got ${String(gridW)}×${String(gridH)}`,
    );
  }
}

function validateCrop(imgW: number, imgH: number, crop: CropRect): void {
  assertFinite(crop.x, "crop.x");
  assertFinite(crop.y, "crop.y");
  assertFinite(crop.width, "crop.width");
  assertFinite(crop.height, "crop.height");
  if (crop.width <= 0 || crop.height <= 0) {
    throw new SamplingError(
      "INVALID_CROP",
      `crop.width/height must be > 0; got ${crop.width}×${crop.height}`,
    );
  }
  if (crop.x < -EPSILON || crop.y < -EPSILON) {
    throw new SamplingError("INVALID_CROP", `crop origin must be >= 0; got (${crop.x}, ${crop.y})`);
  }
  if (crop.x + crop.width > imgW + 1e-6 || crop.y + crop.height > imgH + 1e-6) {
    throw new SamplingError(
      "INVALID_CROP",
      `crop extends past image ${imgW}×${imgH}: ${JSON.stringify(crop)}`,
    );
  }
}

function parseHexColor(hex: string): RGBColor {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match?.[1]) {
    throw new SamplingError(
      "INVALID_BACKGROUND",
      `backgroundHex must be #RRGGBB; got ${JSON.stringify(hex)}`,
    );
  }
  const body = match[1];
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

function toByte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function overlap(start: number, end: number, pixelStart: number): number {
  const left = Math.max(start, pixelStart);
  const right = Math.min(end, pixelStart + 1);
  return right > left ? right - left : 0;
}

interface CellVisit {
  regionArea: number;
  nearestFallback: boolean;
  spanCount: number;
}

/**
 * 遍历一个输出格覆盖的源像素，并给出每个像素的真实交叠面积权重。
 * 放大网格导致格区面积 < 1 时，只访问最近单像素，权重 1。
 */
function visitCellPixels(
  imgW: number,
  imgH: number,
  gridW: number,
  gridH: number,
  crop: CropRect,
  cellX: number,
  cellY: number,
  visit: (px: number, py: number, weight: number) => void,
): CellVisit {
  const x0 = crop.x + (cellX * crop.width) / gridW;
  const x1 = crop.x + ((cellX + 1) * crop.width) / gridW;
  const y0 = crop.y + (cellY * crop.height) / gridH;
  const y1 = crop.y + ((cellY + 1) * crop.height) / gridH;
  const regionArea = (x1 - x0) * (y1 - y0);

  if (regionArea < 1 - EPSILON) {
    const centerX = (x0 + x1) / 2;
    const centerY = (y0 + y1) / 2;
    const px = Math.min(imgW - 1, Math.max(0, Math.floor(centerX)));
    const py = Math.min(imgH - 1, Math.max(0, Math.floor(centerY)));
    visit(px, py, 1);
    return { regionArea, nearestFallback: true, spanCount: 1 };
  }

  const pxStart = Math.max(0, Math.floor(x0));
  const pxEnd = Math.min(imgW, Math.ceil(x1));
  const pyStart = Math.max(0, Math.floor(y0));
  const pyEnd = Math.min(imgH, Math.ceil(y1));

  let spanCount = 0;
  for (let py = pyStart; py < pyEnd; py += 1) {
    const wy = overlap(y0, y1, py);
    if (wy <= 0) continue;
    for (let px = pxStart; px < pxEnd; px += 1) {
      const wx = overlap(x0, x1, px);
      if (wx <= 0) continue;
      visit(px, py, wx * wy);
      spanCount += 1;
    }
  }

  // 浮点边界极端情况下（格区恰好落在像素边界且被 epsilon 判为空）兜底最近像素。
  if (spanCount === 0) {
    const px = Math.min(imgW - 1, Math.max(0, Math.floor((x0 + x1) / 2)));
    const py = Math.min(imgH - 1, Math.max(0, Math.floor((y0 + y1) / 2)));
    visit(px, py, 1);
    return { regionArea, nearestFallback: true, spanCount: 1 };
  }

  return { regionArea, nearestFallback: false, spanCount };
}

/**
 * 测试与调试用：返回一个格子的源像素覆盖明细。
 * weight 之和在正常路径等于 regionArea（即归一化后总和为 1）。
 */
export function computeCellCoverage(
  imageWidth: number,
  imageHeight: number,
  gridW: number,
  gridH: number,
  crop: CropRect,
  cellX: number,
  cellY: number,
): CellCoverage {
  validateGrid(gridW, gridH);
  validateCrop(imageWidth, imageHeight, crop);
  if (
    !Number.isInteger(cellX) ||
    !Number.isInteger(cellY) ||
    cellX < 0 ||
    cellY < 0 ||
    cellX >= gridW ||
    cellY >= gridH
  ) {
    throw new SamplingError(
      "INVALID_GRID",
      `cell (${cellX}, ${cellY}) must be integers inside ${gridW}×${gridH}`,
    );
  }
  const spans: CellSpan[] = [];
  const result = visitCellPixels(
    imageWidth,
    imageHeight,
    gridW,
    gridH,
    crop,
    cellX,
    cellY,
    (px, py, weight) => {
      spans.push({ px, py, weight });
    },
  );
  return { spans, regionArea: result.regionArea, nearestFallback: result.nearestFallback };
}

/**
 * 面积采样主入口。签名按 S06 规格固定，不要改名或改参数顺序。
 *
 * 纯函数约束：只读取 img.width / img.height / img.data，不访问 DOM。
 */
export function sampleToGrid(
  img: ImageData,
  gridW: number,
  gridH: number,
  crop: CropRect,
  alphaPolicy: AlphaPolicy,
  backgroundHex?: string,
): SampledGrid {
  validateImage(img);
  validateGrid(gridW, gridH);
  validateCrop(img.width, img.height, crop);
  if (alphaPolicy !== "empty" && alphaPolicy !== "background") {
    throw new SamplingError(
      "INVALID_ALPHA_POLICY",
      `alphaPolicy must be "empty" or "background"; got ${JSON.stringify(alphaPolicy)}`,
    );
  }
  if (alphaPolicy === "background" && backgroundHex === undefined) {
    throw new SamplingError(
      "INVALID_BACKGROUND",
      'backgroundHex is required when alphaPolicy is "background"',
    );
  }
  const background = alphaPolicy === "background" ? parseHexColor(backgroundHex ?? "") : null;

  const cellCount = gridW * gridH;
  const rgb = new Uint8ClampedArray(cellCount * 3);
  const alpha = new Uint8Array(cellCount);
  const data = img.data;

  for (let cellY = 0; cellY < gridH; cellY += 1) {
    for (let cellX = 0; cellX < gridW; cellX += 1) {
      let areaSum = 0;
      let alphaWeightSum = 0; // Σ coverage × alpha/255
      let premulR = 0;
      let premulG = 0;
      let premulB = 0;
      let alphaSum = 0; // Σ coverage × alpha（0–255）

      visitCellPixels(img.width, img.height, gridW, gridH, crop, cellX, cellY, (px, py, weight) => {
        const offset = (py * img.width + px) * 4;
        const r = data[offset] ?? 0;
        const g = data[offset + 1] ?? 0;
        const b = data[offset + 2] ?? 0;
        const a = data[offset + 3] ?? 0;
        const aRatio = a / 255;

        if (background) {
          // 逐像素 sRGB 合成：fg×a + bg×(1-a)。
          premulR += weight * (r * aRatio + background.r * (1 - aRatio));
          premulG += weight * (g * aRatio + background.g * (1 - aRatio));
          premulB += weight * (b * aRatio + background.b * (1 - aRatio));
        } else {
          // empty 策略：只累计可见内容的预乘颜色，透明像素的 RGB 不参与平均。
          premulR += weight * r * aRatio;
          premulG += weight * g * aRatio;
          premulB += weight * b * aRatio;
          alphaWeightSum += weight * aRatio;
        }

        areaSum += weight;
        alphaSum += weight * a;
      });

      // visitCellPixels 保证至少一个 span；此判断仅防御浮点异常。
      if (areaSum <= EPSILON) {
        continue;
      }

      const cellIndex = cellY * gridW + cellX;
      const avgAlpha = alphaSum / areaSum;
      let outR: number;
      let outG: number;
      let outB: number;
      let outAlpha: number;

      if (background) {
        outR = premulR / areaSum;
        outG = premulG / areaSum;
        outB = premulB / areaSum;
        // 背景策略不产生空格；alpha 仍输出真实平均值。
        outAlpha = toByte(avgAlpha);
      } else if (alphaWeightSum > EPSILON) {
        outR = premulR / alphaWeightSum;
        outG = premulG / alphaWeightSum;
        outB = premulB / alphaWeightSum;
        outAlpha = avgAlpha < EMPTY_ALPHA_THRESHOLD ? 0 : toByte(avgAlpha);
      } else {
        // 全透明：颜色无定义，置 0；alpha=0 即空格标记。
        outR = 0;
        outG = 0;
        outB = 0;
        outAlpha = 0;
      }

      const rgbOffset = cellIndex * 3;
      rgb[rgbOffset] = toByte(outR);
      rgb[rgbOffset + 1] = toByte(outG);
      rgb[rgbOffset + 2] = toByte(outB);
      alpha[cellIndex] = outAlpha;
    }
  }

  return { rgb, alpha };
}
