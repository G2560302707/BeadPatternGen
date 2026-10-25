/**
 * S06 · 面积采样（纯函数，无 DOM 依赖）。
 *
 * 本文件刻意不引用 document / canvas / Worker：入参是结构上兼容 ImageData 的对象，
 * 只读取 width / height / data。S10 装配 Worker 时可把本模块整体搬进去。
 *
 * 采样语义：
 * - 目标网格的每个格子在 crop 内对应一个连续矩形区域；
 * - 按源像素与格区矩形的真实交叠面积加权（非整数比例不做取整近似）；
 * - 颜色在**线性光空间**求平均（1.1 变更）：sRGB 值先经 sRGB EOTF 展开成线性
 *   亮度再加权平均，最后编码回 sRGB。直接在 sRGB 上平均会把暗色"稀释"
 *   （50% 黑 + 50% 白得到 188 而不是物理正确的 128），小格数图纸的描边、
 *   眼睛、阴影都会因此发灰发虚；
 * - 透明度：颜色按 coverage × (alpha/255) 预乘累计，避免透明像素的任意 RGB 污染；
 *   alpha 输出为本格按覆盖面积的算术平均值；
 * - alphaPolicy="empty" 且平均 alpha < 128 时，该格输出 alpha=0，作为"空格"标记；
 * - alphaPolicy="background" 时，逐像素合成到 backgroundHex 上（线性光合成），
 *   输出 RGB 已不透明化，但 alpha 字段仍保留平均 alpha（透明度信息不被静默丢弃）；
 * - **细暗线保留**（1.1 变更）：格内若存在明显暗于格子均值的细线/描边内容
 *   （面积占比小、对比足够），把格子颜色向暗线颜色偏移。面积平均会把
 *   1–3 像素的描边稀释成灰蒙蒙的中间色，这是小尺寸图纸"失真"的主要来源之一；
 * - 格区面积 < 1 平方像素（放大网格）时，退化为格中心最近的单个源像素，权重记 1，
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

/**
 * 细暗线判定：像素亮度需要比格子平均亮度至少暗多少（sRGB 亮度 0–255）。
 * 低于该差值的明暗差被视为普通纹理/渐变，不做偏置。
 */
const DARK_LINE_LUMA_DELTA = 20;

/**
 * 细暗线偏置的强度曲线分母：亮度差达到该值时部分偏置达到上限。
 * 柔和阴影（差 ~40）只轻微偏置；超过该值的实线条（描边、文字）直接整格取线色。
 */
const DARK_LINE_FULL_CONTRAST = 130;

/** 整格取线色要求的线色亮度上限（足够暗才算"描边"而不是普通暗色块）。 */
const DARK_LINE_FULL_DARK_LUMA = 100;

/**
 * 细暗线最大面积占比：超过该值说明暗色是成块的阴影/色块而不是细线
 * （动画的平面阴影常占格子的 20–40%，绝不能被偏置加黑）。23% 以下才视为线状内容。
 */
const DARK_LINE_MAX_DARK_FRACTION = 0.22;

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

/** sRGB → 线性光查找表（0–255 → 0–1）。 */
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 线性光 → sRGB 字节（0–1 → 0–255）。 */
function linearToSrgbByte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 255;
  const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

/** 快速感知亮度（sRGB 编码值上的 Rec.709 加权，仅用于细暗线检测）。 */
function srgbLuma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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
  const backgroundLinear = background
    ? {
        r: SRGB_TO_LINEAR[background.r] ?? 0,
        g: SRGB_TO_LINEAR[background.g] ?? 0,
        b: SRGB_TO_LINEAR[background.b] ?? 0,
      }
    : null;

  for (let cellY = 0; cellY < gridH; cellY += 1) {
    for (let cellX = 0; cellX < gridW; cellX += 1) {
      let areaSum = 0;
      let alphaWeightSum = 0; // Σ coverage × alpha/255
      let linR = 0;
      let linG = 0;
      let linB = 0;
      let lumaWeightSum = 0; // Σ coverage × alpha/255 × luma（细暗线检测用）
      let alphaSum = 0; // Σ coverage × alpha（0–255）

      visitCellPixels(img.width, img.height, gridW, gridH, crop, cellX, cellY, (px, py, weight) => {
        const offset = (py * img.width + px) * 4;
        const r = data[offset] ?? 0;
        const g = data[offset + 1] ?? 0;
        const b = data[offset + 2] ?? 0;
        const a = data[offset + 3] ?? 0;
        const aRatio = a / 255;
        const linWr = weight * (SRGB_TO_LINEAR[r] ?? 0);
        const linWg = weight * (SRGB_TO_LINEAR[g] ?? 0);
        const linWb = weight * (SRGB_TO_LINEAR[b] ?? 0);

        if (backgroundLinear) {
          // background 策略：线性光空间逐像素合成 fg×a + bg×(1-a) 再累计。
          const wa = weight * aRatio;
          const wb = weight - wa;
          linR += linWr + backgroundLinear.r * wb;
          linG += linWg + backgroundLinear.g * wb;
          linB += linWb + backgroundLinear.b * wb;
          lumaWeightSum += weight * srgbLuma(r, g, b);
        } else {
          // empty 策略：只累计可见内容的线性预乘颜色。
          linR += linWr * aRatio;
          linG += linWg * aRatio;
          linB += linWb * aRatio;
          lumaWeightSum += weight * aRatio * srgbLuma(r, g, b);
        }

        areaSum += weight;
        alphaWeightSum += weight * aRatio;
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

      // 细暗线偏置的分母：background 策略下所有像素都可见（含合成的背景），
      // empty 策略下只有可见内容参与均值。
      const meanDenominator = backgroundLinear ? areaSum : alphaWeightSum;
      const dark = collectDarkLineAverage(
        img,
        gridW,
        gridH,
        crop,
        cellX,
        cellY,
        lumaWeightSum / meanDenominator,
        meanDenominator,
      );
      if (dark !== null && dark.lumaMeanDelta >= DARK_LINE_LUMA_DELTA) {
        // 判据分三类（互斥，从强到弱）：
        // 1. 轮廓线：线状内容 + 格子贴着透明区（主体边界）——这是剪影描边，
        //    强力保色（整格或 0.9 混合），断在边界上最伤观感；
        // 2. 深色主块：占比 ≥ 35% 的真深内容（眼睛虹膜）被高光稀释——向深色收敛；
        // 3. 内部细线：主体内部的发丝线、五官线——只做温和染色，且强度随
        //    线条在格内的覆盖率缩放；小格数下细线淡化为浅色阴影而不是
        //    一条突兀的黑条纹（对照优秀作品：小图纸上五官线是"淡"的）。
        const touchesTransparency =
          !backgroundLinear && alphaWeightSum < areaSum * 0.95;
        const lineLike = dark.thinness >= 0.5 && dark.fraction <= DARK_LINE_MAX_DARK_FRACTION;
        const fullLine =
          lineLike &&
          touchesTransparency &&
          dark.lumaMeanDelta >= DARK_LINE_FULL_CONTRAST &&
          dark.darkLuma <= DARK_LINE_FULL_DARK_LUMA;
        const darkBlob =
          !lineLike &&
          dark.fraction >= 0.35 &&
          dark.darkLuma <= DARK_LINE_FULL_DARK_LUMA &&
          dark.lumaMeanDelta >= 80;
        const blend = fullLine
          ? 1
          : darkBlob
            ? Math.min(0.9, 0.35 + dark.fraction)
            : lineLike
              ? touchesTransparency
                ? Math.min(0.9, dark.lumaMeanDelta / 90)
                : Math.min(0.5, (dark.lumaMeanDelta / 160) * Math.min(1, dark.fraction / 0.15))
              : 0;
        if (blend > 0) {
          linR = linR * (1 - blend) + dark.r * blend * meanDenominator;
          linG = linG * (1 - blend) + dark.g * blend * meanDenominator;
          linB = linB * (1 - blend) + dark.b * blend * meanDenominator;
        }
      }

      if (backgroundLinear) {
        outR = linearToSrgbByte(linR / areaSum);
        outG = linearToSrgbByte(linG / areaSum);
        outB = linearToSrgbByte(linB / areaSum);
        // 背景策略不产生空格；alpha 仍输出真实平均值。
        outAlpha = toByte(avgAlpha);
      } else if (alphaWeightSum > EPSILON) {
        outR = linearToSrgbByte(linR / alphaWeightSum);
        outG = linearToSrgbByte(linG / alphaWeightSum);
        outB = linearToSrgbByte(linB / alphaWeightSum);
        outAlpha = avgAlpha < EMPTY_ALPHA_THRESHOLD ? 0 : toByte(avgAlpha);
      } else {
        // 全透明：颜色无定义，置 0；alpha=0 即空格标记。
        outR = 0;
        outG = 0;
        outB = 0;
        outAlpha = 0;
      }

      const rgbOffset = cellIndex * 3;
      rgb[rgbOffset] = outR;
      rgb[rgbOffset + 1] = outG;
      rgb[rgbOffset + 2] = outB;
      alpha[cellIndex] = outAlpha;
    }
  }

  return { rgb, alpha };
}

/**
 * 细暗线检测的第二遍扫描：累计「明显暗于格子平均」的可见内容的平均线性色。
 *
 * - `meanLuma`：格子可见内容的平均 sRGB 亮度（调用方算好）；
 * - 只统计亮度 < meanLuma − DARK_LINE_LUMA_DELTA 的像素；
 * - `weightSum` 为归一化分母（background 策略传 areaSum，empty 策略传 alphaWeightSum）；
 * - 暗内容权重占比 < 1.2% 时视为噪声（JPEG 颗粒），返回 null 不偏置；
 * - 放大网格（格区面积 < 1）时格子只是单个源像素，没有"被平均稀释"的问题，
 *   格子中心最近像素的 luma 与自身均值相同（差为 0），darkLumaLimit ≤ 0 自然短路。
 *
 * 返回的 r/g/b 已按权重归一（线性光）。`thinness` 是线状证据：暗像素中
 * 「4 邻域里暗邻居 < 2 个」的比例——细线的暗像素彼此接触面小（比例高），
 * 成块阴影的暗像素四周都是暗的（比例低）。这是区分"要保的描边"与
 * "不能加重的平面阴影"的关键判据。
 */
function collectDarkLineAverage(
  img: ImageData,
  gridW: number,
  gridH: number,
  crop: CropRect,
  cellX: number,
  cellY: number,
  meanLuma: number,
  weightSum: number,
): {
  r: number;
  g: number;
  b: number;
  fraction: number;
  darkLuma: number;
  lumaMeanDelta: number;
  thinness: number;
} | null {
  if (weightSum <= EPSILON) return null;
  const darkLumaLimit = meanLuma - DARK_LINE_LUMA_DELTA;
  if (darkLumaLimit <= 0) return null;

  const data = img.data;
  const imgW = img.width;
  const isDark = (px: number, py: number): boolean => {
    if (px < 0 || py < 0 || px >= imgW || py >= img.height) return false;
    const offset = (py * imgW + px) * 4;
    if (((data[offset + 3] ?? 0) / 255) <= 0) return false;
    const luma = srgbLuma(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0);
    return luma < darkLumaLimit;
  };

  let darkWeight = 0;
  let darkR = 0;
  let darkG = 0;
  let darkB = 0;
  let darkLumaSum = 0;
  let thinWeight = 0;

  visitCellPixels(img.width, img.height, gridW, gridH, crop, cellX, cellY, (px, py, weight) => {
    const offset = (py * img.width + px) * 4;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    const a = (data[offset + 3] ?? 0) / 255;
    if (a <= 0) return;
    const luma = srgbLuma(r, g, b);
    if (luma >= darkLumaLimit) return;
    darkWeight += weight * a;
    darkR += weight * a * (SRGB_TO_LINEAR[r] ?? 0);
    darkG += weight * a * (SRGB_TO_LINEAR[g] ?? 0);
    darkB += weight * a * (SRGB_TO_LINEAR[b] ?? 0);
    darkLumaSum += weight * a * luma;
    let darkNeighbors = 0;
    if (isDark(px - 1, py)) darkNeighbors += 1;
    if (isDark(px + 1, py)) darkNeighbors += 1;
    if (isDark(px, py - 1)) darkNeighbors += 1;
    if (isDark(px, py + 1)) darkNeighbors += 1;
    if (darkNeighbors < 2) thinWeight += weight * a;
  });

  if (darkWeight <= EPSILON) return null;
  const fraction = darkWeight / weightSum;
  // 上限 0.92：格子几乎全暗时均值就是答案，无需偏置。
  // 线状/主块规则各自还有更严的比例门槛（见调用方）。
  if (fraction < 0.012 || fraction > 0.92) return null;
  return {
    r: darkR / darkWeight,
    g: darkG / darkWeight,
    b: darkB / darkWeight,
    fraction,
    darkLuma: darkLumaSum / darkWeight,
    lumaMeanDelta: meanLuma - darkLumaSum / darkWeight,
    thinness: thinWeight / darkWeight,
  };
}
