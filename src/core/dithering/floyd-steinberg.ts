/**
 * S07 · 确定性抖动：Floyd–Steinberg。
 *
 * 参考：R. W. Floyd, L. Steinberg, "An adaptive algorithm for spatial greyscale",
 * Proceedings of the Society for Information Display 17(2), 1976, pp. 75–77。
 *
 * 本文件把「确定性」当作硬契约而不是实现细节：
 *
 * 1. 遍历顺序固定为行优先（y 升序、x 升序），不做蛇形扫描；
 * 2. 扩散核固定为 右 7/16、左下 3/16、下 5/16、右下 1/16（系数和 = 1）；
 * 3. 越界或落在空格上的扩散量直接丢弃，按固定顺序累加进 residualError；
 * 4. 累积颜色保存在 Float32Array 中，写入时由 Float32Array 完成 float32 舍入，
 *    绝不使用整数中间值（那会把小数误差截断成 0，渐变将出现色带）；
 * 5. 不出现 Math.random、Date、Set/Map 遍历顺序等任何非确定来源。
 *
 * 浮点累加顺序（写死，改顺序会改变末位）：
 * - 单个格子的累积颜色 = 初始采样值
 *   + 左上格扩散来的 3/16
 *   + 上方格扩散来的 5/16
 *   + 右上格扩散来的 1/16
 *   + 左方格扩散来的 7/16。
 *   这个顺序由行优先遍历自然决定：上一行按 x 升序先处理完，再处理当前行的左邻。
 * - 每个邻格按「右 → 左下 → 下 → 右下」的固定顺序写入；
 * - residualError 按「格子行优先 → 邻格固定顺序 → 通道 r → g → b」顺序累加。
 */

import { RGB_CHANNEL_MAX, RGB_CHANNEL_MIN, assertRgb, hexToRgb } from "../color";
import type { RGB } from "../color";
import type { BeadColor, PaletteIndex } from "../palette";
import type { DitherOptions, DitherResult } from "./types";

/**
 * Floyd–Steinberg 扩散系数。来源：Floyd & Steinberg (1976) 原文的 4 邻域核，
 * 分母固定为 16（7 + 3 + 5 + 1 = 16）。
 */
const WEIGHT_RIGHT = 7 / 16;
const WEIGHT_LOWER_LEFT = 3 / 16;
const WEIGHT_DOWN = 5 / 16;
const WEIGHT_LOWER_RIGHT = 1 / 16;

/** strength 的默认值。来源：S07 实现契约第 4 条。 */
const DEFAULT_STRENGTH = 1;

/** strength 的合法闭区间。来源：S07 实现契约第 4 条（0–1）。 */
const MIN_STRENGTH = 0;
const MAX_STRENGTH = 1;

/** 空格的输出索引。来源：DitherResult.indices 的注释（-1 表示空格）。 */
const EMPTY_CELL = -1;

/** 一个扩散目标。dx/dy 以「当前格子」为原点，y 轴向下。 */
interface DiffusionTarget {
  readonly dx: number;
  readonly dy: number;
  readonly weight: number;
}

/**
 * 扩散目标表，顺序即写入顺序，也是 residualError 的累加顺序。
 * 来源：Floyd & Steinberg (1976) 的经典 4 邻域核。
 */
const DIFFUSION_TARGETS: readonly DiffusionTarget[] = [
  { dx: 1, dy: 0, weight: WEIGHT_RIGHT },
  { dx: -1, dy: 1, weight: WEIGHT_LOWER_LEFT },
  { dx: 0, dy: 1, weight: WEIGHT_DOWN },
  { dx: 1, dy: 1, weight: WEIGHT_LOWER_RIGHT },
];

/** 断言正整数尺寸。 */
function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer; received ${String(value)}`);
  }
}

/**
 * 把累积颜色夹到 [0, 255]。
 *
 * 为什么必须夹：
 * - `PaletteIndex.nearest` 的输入域契约是「有限数且每通道位于 [0, 255]」，
 *   误差扩散后的累积值可能短暂越界（例如 255 的格子收到正的扩散量）。
 *   不夹会让 nearest 抛错，整张图无法生成。
 * - 误差按**夹取后**的值计算。若按越界值计算，越界误差会被继续扩散，
 *   在黑白两色之间形成误差雪崩；夹取后再量化可保证误差有界。
 *
 * 写法与 S04 的 clampToUnit 一致：先用 `!(value > min)` 把 NaN 归到 min，
 * 保证任何非有限输入都不会传播进 nearest。
 */
function clampChannel(value: number): number {
  if (!(value > RGB_CHANNEL_MIN)) return RGB_CHANNEL_MIN;
  if (value > RGB_CHANNEL_MAX) return RGB_CHANNEL_MAX;
  return value;
}

/**
 * 解析并校验 strength：缺省为 1，必须是 [0, 1] 内的有限数。
 * 采用「抛错」而不是静默夹取，与 S04 / S05 的输入域策略保持一致。
 */
function resolveStrength(options: DitherOptions): number {
  if (options === null || typeof options !== "object") {
    throw new RangeError("options must be an object; received " + String(options));
  }

  // 类型上 strength 是必填字段；这里仍接受 undefined，便于 JS 调用方省略。
  const raw: number | undefined = options.strength;
  const strength = raw === undefined ? DEFAULT_STRENGTH : raw;

  if (typeof strength !== "number" || !Number.isFinite(strength)) {
    throw new RangeError(`options.strength must be a finite number; received ${String(strength)}`);
  }
  if (strength < MIN_STRENGTH || strength > MAX_STRENGTH) {
    throw new RangeError(
      `options.strength must be within [${MIN_STRENGTH}, ${MAX_STRENGTH}]; received ${strength}`,
    );
  }
  return strength;
}

/** 校验 metric 的运行时取值；类型系统之外的调用方（JS / 反序列化）也要挡住。 */
function assertMetric(options: DitherOptions): void {
  const metric = options.metric;
  if (metric !== "ciede2000" && metric !== "oklab") {
    throw new RangeError(
      `options.metric must be "ciede2000" or "oklab"; received ${String(metric)}`,
    );
  }
}

/**
 * 校验尺寸与数组长度。
 *
 * 校验顺序写死为：尺寸 → samples 长度 → alphaMask 长度。
 * 调用方依赖错误信息定位问题，因此顺序也是契约的一部分（测试覆盖）。
 */
function assertInputShape(
  samples: readonly RGB[],
  alphaMask: readonly boolean[],
  width: number,
  height: number,
): number {
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");

  const cellCount = width * height;

  if (!Array.isArray(samples) || samples.length !== cellCount) {
    throw new RangeError(
      `samples.length must equal width*height=${cellCount}; received ${String(samples?.length)}`,
    );
  }
  if (!Array.isArray(alphaMask) || alphaMask.length !== cellCount) {
    throw new RangeError(
      `alphaMask.length must equal width*height=${cellCount}; received ${String(
        alphaMask?.length,
      )}`,
    );
  }
  return cellCount;
}

/**
 * 把 palette 的 hex 预解析成 RGB。
 * 索引与 palette 必须一一对应，否则 nearest 返回的下标无法回查颜色，
 * 误差计算会静默取到错误的色卡色。
 */
function resolvePalette(palette: readonly BeadColor[], index: PaletteIndex): RGB[] {
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new RangeError("palette must be a non-empty array of BeadColor");
  }
  if (index === null || typeof index !== "object") {
    throw new RangeError("index must be a PaletteIndex");
  }
  if (index.size !== palette.length) {
    throw new RangeError(
      `index.size (${index.size}) must equal palette.length (${palette.length}); ` +
        "the palette index must be built from this exact palette",
    );
  }

  const rgb: RGB[] = [];
  for (let position = 0; position < palette.length; position += 1) {
    const entry = palette[position];
    if (entry === undefined || entry === null || typeof entry !== "object") {
      throw new RangeError(`palette[${position}] must be a BeadColor object`);
    }
    rgb.push(hexToRgb(entry.hex));
  }
  return rgb;
}

/**
 * Floyd–Steinberg 抖动主入口。签名按 S07 规格固定，不要改名或改参数顺序。
 *
 * 量化一律走 `index.nearest`；本文件不重复实现任何色差或最近邻逻辑。
 * `options.metric` 只做合法性校验：色卡索引构建时已经固定了度量，
 * 调用方必须保证二者一致（见 types.ts 的说明）。
 */
export function floydSteinberg(
  samples: readonly RGB[],
  alphaMask: readonly boolean[],
  width: number,
  height: number,
  palette: readonly BeadColor[],
  index: PaletteIndex,
  options: DitherOptions,
): DitherResult {
  const cellCount = assertInputShape(samples, alphaMask, width, height);
  const strength = resolveStrength(options);
  assertMetric(options);
  const paletteRgb = resolvePalette(palette, index);

  // 累积颜色。float32 存储是契约：写入时即舍入，读取时再参与 double 运算。
  const accumR = new Float32Array(cellCount);
  const accumG = new Float32Array(cellCount);
  const accumB = new Float32Array(cellCount);

  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const sample = samples[cellIndex];
    if (sample === undefined) {
      // 长度已校验，正常路径不可达；保留守卫避免 undefined 混入数值运算。
      throw new RangeError(`internal: missing sample at index ${cellIndex}`);
    }
    assertRgb(sample);

    const masked = alphaMask[cellIndex];
    if (typeof masked !== "boolean") {
      throw new RangeError(`alphaMask[${cellIndex}] must be a boolean; received ${String(masked)}`);
    }

    accumR[cellIndex] = sample.r;
    accumG[cellIndex] = sample.g;
    accumB[cellIndex] = sample.b;
  }

  const indices = new Int16Array(cellCount);
  let residualError = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cellIndex = y * width + x;

      // 空格：不读取累积值、不量化、不发射误差。输出 -1。
      if (alphaMask[cellIndex] === true) {
        indices[cellIndex] = EMPTY_CELL;
        continue;
      }

      const queryR = clampChannel(accumR[cellIndex] ?? 0);
      const queryG = clampChannel(accumG[cellIndex] ?? 0);
      const queryB = clampChannel(accumB[cellIndex] ?? 0);

      // 唯一的量化入口。distance 不参与误差计算：误差定义在 sRGB 通道空间，
      // 与度量无关；metric 只决定「最近」是谁。
      const match = index.nearest({ r: queryR, g: queryG, b: queryB });
      indices[cellIndex] = match.index;

      const matched = paletteRgb[match.index];
      if (matched === undefined) {
        throw new RangeError(
          `internal: palette index ${match.index} has no RGB (palette length ${paletteRgb.length})`,
        );
      }

      const errorR = queryR - matched.r;
      const errorG = queryG - matched.g;
      const errorB = queryB - matched.b;

      // newErr = err * strength；strength=0 时下面所有 delta 恰为 ±0，
      // 累积数组不变，因此自然退化为「逐格最近邻」。
      const scaledR = errorR * strength;
      const scaledG = errorG * strength;
      const scaledB = errorB * strength;

      for (const target of DIFFUSION_TARGETS) {
        const targetX = x + target.dx;
        const targetY = y + target.dy;

        const deltaR = scaledR * target.weight;
        const deltaG = scaledG * target.weight;
        const deltaB = scaledB * target.weight;

        const outside = targetX < 0 || targetX >= width || targetY >= height;
        const masked = !outside && alphaMask[targetY * width + targetX] === true;

        if (outside || masked) {
          // 边界外或空格：丢弃，不回绕。按 r → g → b 固定顺序累加绝对值。
          residualError += Math.abs(deltaR);
          residualError += Math.abs(deltaG);
          residualError += Math.abs(deltaB);
          continue;
        }

        const targetIndex = targetY * width + targetX;
        accumR[targetIndex] = (accumR[targetIndex] ?? 0) + deltaR;
        accumG[targetIndex] = (accumG[targetIndex] ?? 0) + deltaG;
        accumB[targetIndex] = (accumB[targetIndex] ?? 0) + deltaB;
      }
    }
  }

  return { indices, residualError };
}
