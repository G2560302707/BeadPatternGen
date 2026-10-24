/**
 * S04 颜色科学内核 —— 公共类型、输入域策略与共享数值守卫。
 *
 * 输入域策略（全包唯一策略）：**抛错**。
 * - RGB 通道必须是有限数且落在 [0, 255]，否则抛 RangeError。
 * - sRGB 传递函数入参必须是有限数且落在 [0, 1]，否则抛 RangeError。
 * - Lab / Oklab 的 L、a、b 只要求是有限数（C* 空间本身无界，允许超色域）；
 *   labToRgb / oklabToRgb 的 **输出 RGB** 按规格 clamp 到 0–255 并四舍五入。
 * - hex 不是 "#RGB" 或 "#RRGGBB"（必须带 #、不允许空白）时抛 RangeError。
 *
 * 选择“抛错”而不是“输入 clamp”的原因：静默 clamp 会掩盖上游采样 / 解码错误；
 * S04 是整条流水线的地基，越早暴露非法输入越好。
 */

/** sRGB 8 位通道值，0–255。 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** CIE L*a*b*，D65 白点。L 通常 0–100，a/b 无界。 */
export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** Oklab（Ottosson 2020）。L 通常 0–1，a/b 无界。 */
export interface Oklab {
  L: number;
  a: number;
  b: number;
}

export type ColorMetricName = "ciede2000" | "oklab";

/** 3×3 矩阵，行优先；只读元组避免调用方改写系数。 */
export type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/** IEC 61966-2-1 8 位量化下限。 */
export const RGB_CHANNEL_MIN = 0;

/** IEC 61966-2-1 8 位量化上限。 */
export const RGB_CHANNEL_MAX = 255;

/** 8 位量化除数：channel / 255 ∈ [0, 1]。 */
export const RGB_CHANNEL_SCALE = 255;

/** sRGB 归一化域下限。 */
export const SRGB_UNIT_MIN = 0;

/** sRGB 归一化域上限。 */
export const SRGB_UNIT_MAX = 1;

/**
 * 断言 value 是有限数（拒绝 NaN、±Infinity）。
 * 抛 RangeError 而不是 TypeError：错误发生在数值域而非类型层面。
 */
export function assertFiniteNumber(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number; received ${String(value)}`);
  }
}

/** 断言 RGB 三个通道均为有限数且在 [0, 255]。 */
export function assertRgb(rgb: RGB): void {
  assertFiniteNumber(rgb.r, "RGB.r");
  assertFiniteNumber(rgb.g, "RGB.g");
  assertFiniteNumber(rgb.b, "RGB.b");
  if (rgb.r < RGB_CHANNEL_MIN || rgb.r > RGB_CHANNEL_MAX) {
    throw new RangeError(`RGB.r must be within [0, 255]; received ${rgb.r}`);
  }
  if (rgb.g < RGB_CHANNEL_MIN || rgb.g > RGB_CHANNEL_MAX) {
    throw new RangeError(`RGB.g must be within [0, 255]; received ${rgb.g}`);
  }
  if (rgb.b < RGB_CHANNEL_MIN || rgb.b > RGB_CHANNEL_MAX) {
    throw new RangeError(`RGB.b must be within [0, 255]; received ${rgb.b}`);
  }
}

/** 断言入参是有限数且在 [0, 1]（sRGB 传递函数域）。 */
export function assertUnitInterval(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value < SRGB_UNIT_MIN || value > SRGB_UNIT_MAX) {
    throw new RangeError(`${label} must be within [0, 1]; received ${value}`);
  }
}

/** 断言 Lab 三个分量均为有限数；不限制量纲范围。 */
export function assertFiniteLab(lab: Lab, label: string): void {
  assertFiniteNumber(lab.L, `${label}.L`);
  assertFiniteNumber(lab.a, `${label}.a`);
  assertFiniteNumber(lab.b, `${label}.b`);
}

/** 断言 Oklab 三个分量均为有限数；不限制量纲范围。 */
export function assertFiniteOklab(oklab: Oklab, label: string): void {
  assertFiniteNumber(oklab.L, `${label}.L`);
  assertFiniteNumber(oklab.a, `${label}.a`);
  assertFiniteNumber(oklab.b, `${label}.b`);
}

/**
 * 把中间线性值饱和到 [0, 1]。
 * 写法刻意保证：NaN → 0、-Infinity → 0、+Infinity → 1。
 * 在有限且量纲正常的输入下不会出现 NaN；此分支只防御极端外推值
 * （例如 |a| 极大时矩阵项出现 Infinity - Infinity）导致的非确定性。
 */
export function clampToUnit(value: number): number {
  if (!(value > SRGB_UNIT_MIN)) return SRGB_UNIT_MIN;
  if (value > SRGB_UNIT_MAX) return SRGB_UNIT_MAX;
  return value;
}
