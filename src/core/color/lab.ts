/**
 * CIE L*a*b*（D65）↔ 8 位 sRGB。
 *
 * 参考：
 * - CIE 15:2004《Colorimetry, 3rd edition》：L*a*b* 定义、分段函数 f(t)、
 *   常数 ε = 216/24389、κ = 24389/27。
 * - IEC 61966-2-1:1999：sRGB 线性化与 D65 白点。
 * - Bruce Lindbloom, "RGB/XYZ Matrices"（sRGB D65 矩阵，与 IEC 61966-2-1 一致）。
 *
 * 输入域策略见 types.ts：RGB 越界 / NaN 抛 RangeError；
 * labToRgb 的输出按规格 clamp 到 0–255 并四舍五入。
 */

import { linearToSrgb, srgbToLinear } from "./srgb";
import {
  RGB_CHANNEL_MAX,
  RGB_CHANNEL_MIN,
  RGB_CHANNEL_SCALE,
  assertFiniteLab,
  assertRgb,
  clampToUnit,
} from "./types";
import type { Lab, Mat3, RGB } from "./types";

/**
 * D65 白点（Y 归一化为 1）。
 * 来源：CIE 15:2004 / IEC 61966-2-1 的 D65 色度坐标 x=0.3127、y=0.3290
 * 推出的 X=0.95047、Z=1.08883。三个数值按任务规格写死。
 */
export const D65_WHITE_X = 0.95047;
export const D65_WHITE_Y = 1.0;
export const D65_WHITE_Z = 1.08883;

/** ε = 216/24389 = 0.008856451679035631…（CIE 15:2004 精确有理数定义）。 */
export const CIE_LAB_EPSILON = 216 / 24389;

/** κ = 24389/27 = 903.2962962962963…（CIE 15:2004 精确有理数定义）。 */
export const CIE_LAB_KAPPA = 24389 / 27;

/** L* 系数 116（CIE 15:2004）。 */
export const LAB_LIGHTNESS_SCALE = 116;

/** L* 偏移 16（CIE 15:2004）。 */
export const LAB_LIGHTNESS_OFFSET = 16;

/** a* 系数 500（CIE 15:2004）。 */
export const LAB_A_SCALE = 500;

/** b* 系数 200（CIE 15:2004）。 */
export const LAB_B_SCALE = 200;

/**
 * 线性 sRGB → XYZ（D65），行优先。
 * 来源：IEC 61966-2-1:1999 派生矩阵 / Bruce Lindbloom sRGB D65 矩阵。
 * 每行求和分别为 0.95047、1.0000001、1.0888300；最后一位差异来自公开系数的
 * 十进制截断，白点处 L* 因此为 100.00000387 而非严格 100，属预期行为。
 */
export const SRGB_TO_XYZ_D65: Mat3 = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];

/**
 * XYZ（D65）→ 线性 sRGB，行优先（上式的逆矩阵，Bruce Lindbloom 公开系数）。
 */
export const XYZ_D65_TO_SRGB_LINEAR: Mat3 = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];

/**
 * CIE 分段函数 f(t)。
 * f(t) = t^(1/3)                     , t > ε
 *      = (κ·t + 16) / 116            , t ≤ ε
 * 使用 Math.cbrt 而非 Math.pow(t, 1/3)，避免负零与额外舍入。
 */
function labF(t: number): number {
  if (t > CIE_LAB_EPSILON) {
    return Math.cbrt(t);
  }
  return (CIE_LAB_KAPPA * t + LAB_LIGHTNESS_OFFSET) / LAB_LIGHTNESS_SCALE;
}

/**
 * f 的反函数。
 * f⁻¹(t) = t³                         , t³ > ε
 *        = (116·t − 16) / κ           , t³ ≤ ε
 * t³ 用 t*t*t 写死，不用 Math.pow，保证跨引擎位级一致。
 */
function labFInverse(t: number): number {
  const tCubed = t * t * t;
  if (tCubed > CIE_LAB_EPSILON) {
    return tCubed;
  }
  return (LAB_LIGHTNESS_SCALE * t - LAB_LIGHTNESS_OFFSET) / CIE_LAB_KAPPA;
}

/**
 * 线性光通道 → 0–255 整数。
 * 依次：饱和到 [0,1] → sRGB 编码 → ×255 → Math.round → 再饱和到 [0,255]。
 * 求值顺序写死，便于回归测试稳定复现。
 */
function encodeChannel(linear: number): number {
  const encoded = linearToSrgb(clampToUnit(linear));
  const scaled = encoded * RGB_CHANNEL_SCALE;
  const rounded = Math.round(scaled);
  if (rounded < RGB_CHANNEL_MIN) return RGB_CHANNEL_MIN;
  if (rounded > RGB_CHANNEL_MAX) return RGB_CHANNEL_MAX;
  return rounded;
}

/**
 * 8 位 sRGB → CIE L*a*b*（D65）。
 * RGB 任一通道非有限或在 [0,255] 之外时抛 RangeError。
 */
export function rgbToLab(rgb: RGB): Lab {
  assertRgb(rgb);

  // 线性化求值顺序：r, g, b 依次固定。
  const linearR = srgbToLinear(rgb.r / RGB_CHANNEL_SCALE);
  const linearG = srgbToLinear(rgb.g / RGB_CHANNEL_SCALE);
  const linearB = srgbToLinear(rgb.b / RGB_CHANNEL_SCALE);

  // 矩阵乘法固定左结合：((m00·v0 + m01·v1) + m02·v2)。
  const x =
    SRGB_TO_XYZ_D65[0][0] * linearR +
    SRGB_TO_XYZ_D65[0][1] * linearG +
    SRGB_TO_XYZ_D65[0][2] * linearB;
  const y =
    SRGB_TO_XYZ_D65[1][0] * linearR +
    SRGB_TO_XYZ_D65[1][1] * linearG +
    SRGB_TO_XYZ_D65[1][2] * linearB;
  const z =
    SRGB_TO_XYZ_D65[2][0] * linearR +
    SRGB_TO_XYZ_D65[2][1] * linearG +
    SRGB_TO_XYZ_D65[2][2] * linearB;

  // 白点归一化后代入 f。
  const fx = labF(x / D65_WHITE_X);
  const fy = labF(y / D65_WHITE_Y);
  const fz = labF(z / D65_WHITE_Z);

  return {
    L: LAB_LIGHTNESS_SCALE * fy - LAB_LIGHTNESS_OFFSET,
    a: LAB_A_SCALE * (fx - fy),
    b: LAB_B_SCALE * (fy - fz),
  };
}

/**
 * CIE L*a*b*（D65）→ 8 位 sRGB。
 * L/a/b 只要求有限；结果超出 sRGB 色域时，逐通道 clamp 到 0–255 后四舍五入。
 */
export function labToRgb(lab: Lab): RGB {
  assertFiniteLab(lab, "labToRgb input");

  const fy = (lab.L + LAB_LIGHTNESS_OFFSET) / LAB_LIGHTNESS_SCALE;
  const fx = fy + lab.a / LAB_A_SCALE;
  const fz = fy - lab.b / LAB_B_SCALE;

  const xr = labFInverse(fx);
  const yr = labFInverse(fy);
  const zr = labFInverse(fz);

  const x = xr * D65_WHITE_X;
  const y = yr * D65_WHITE_Y;
  const z = zr * D65_WHITE_Z;

  // 与 rgbToLab 相同的左结合顺序。
  const linearR =
    XYZ_D65_TO_SRGB_LINEAR[0][0] * x +
    XYZ_D65_TO_SRGB_LINEAR[0][1] * y +
    XYZ_D65_TO_SRGB_LINEAR[0][2] * z;
  const linearG =
    XYZ_D65_TO_SRGB_LINEAR[1][0] * x +
    XYZ_D65_TO_SRGB_LINEAR[1][1] * y +
    XYZ_D65_TO_SRGB_LINEAR[1][2] * z;
  const linearB =
    XYZ_D65_TO_SRGB_LINEAR[2][0] * x +
    XYZ_D65_TO_SRGB_LINEAR[2][1] * y +
    XYZ_D65_TO_SRGB_LINEAR[2][2] * z;

  return {
    r: encodeChannel(linearR),
    g: encodeChannel(linearG),
    b: encodeChannel(linearB),
  };
}
