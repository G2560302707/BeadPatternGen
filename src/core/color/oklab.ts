/**
 * Oklab（Björn Ottosson, 2020）↔ 8 位 sRGB。
 *
 * 参考：Björn Ottosson, "A perceptual color space for image processing",
 * 2020-12-23, https://bottosson.github.io/posts/oklab/ 。
 * 采用标准 M1/M2 矩阵路线：
 *   线性 sRGB → LMS（M1）→ 逐分量立方根 → Oklab（M2）。
 * 不使用任何近似幂函数替代立方根或矩阵。
 *
 * 输入域策略见 types.ts：RGB 越界 / NaN 抛 RangeError；
 * oklabToRgb 的输出按规格 clamp 到 0–255 并四舍五入。
 */

import { linearToSrgb, srgbToLinear } from "./srgb";
import {
  RGB_CHANNEL_MAX,
  RGB_CHANNEL_MIN,
  RGB_CHANNEL_SCALE,
  assertFiniteOklab,
  assertRgb,
  clampToUnit,
} from "./types";
import type { Mat3, Oklab, RGB } from "./types";

/**
 * M1：线性 sRGB → LMS，行优先。
 * 来源：Ottosson (2020) 正文给出的矩阵，10 位小数。
 */
export const OKLAB_LINEAR_SRGB_TO_LMS: Mat3 = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

/**
 * M2：立方根后的 LMS → Oklab，行优先。
 * 来源：Ottosson (2020) 正文矩阵。
 */
export const OKLAB_LMS_TO_LAB: Mat3 = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

/**
 * M2 的逆：Oklab → 立方根后的 LMS，行优先。
 * 第 0 列全为 1（L 系数），其余列即 Ottosson 给出的逆矩阵系数。
 */
export const OKLAB_LAB_TO_LMS_CUBE_ROOT: Mat3 = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
];

/**
 * M1 的逆：LMS 立方值 → 线性 sRGB，行优先。
 * 来源：Ottosson (2020) 正文逆矩阵。
 */
export const OKLAB_LMS_CUBE_TO_LINEAR_SRGB: Mat3 = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];

/**
 * 线性光通道 → 0–255 整数。
 * 依次：饱和到 [0,1] → sRGB 编码 → ×255 → Math.round → 再饱和到 [0,255]。
 * 与 lab.ts 中的 encodeChannel 保持逐运算一致。
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
 * 8 位 sRGB → Oklab。
 * RGB 任一通道非有限或在 [0,255] 之外时抛 RangeError。
 */
export function rgbToOklab(rgb: RGB): Oklab {
  assertRgb(rgb);

  // 线性化求值顺序：r, g, b 依次固定。
  const linearR = srgbToLinear(rgb.r / RGB_CHANNEL_SCALE);
  const linearG = srgbToLinear(rgb.g / RGB_CHANNEL_SCALE);
  const linearB = srgbToLinear(rgb.b / RGB_CHANNEL_SCALE);

  // M1 · [r, g, b]，固定左结合：((m00·r + m01·g) + m02·b)。
  const l =
    OKLAB_LINEAR_SRGB_TO_LMS[0][0] * linearR +
    OKLAB_LINEAR_SRGB_TO_LMS[0][1] * linearG +
    OKLAB_LINEAR_SRGB_TO_LMS[0][2] * linearB;
  const m =
    OKLAB_LINEAR_SRGB_TO_LMS[1][0] * linearR +
    OKLAB_LINEAR_SRGB_TO_LMS[1][1] * linearG +
    OKLAB_LINEAR_SRGB_TO_LMS[1][2] * linearB;
  const s =
    OKLAB_LINEAR_SRGB_TO_LMS[2][0] * linearR +
    OKLAB_LINEAR_SRGB_TO_LMS[2][1] * linearG +
    OKLAB_LINEAR_SRGB_TO_LMS[2][2] * linearB;

  // 立方根：M1 系数全为正，线性 sRGB 非负 ⇒ LMS 非负，Math.cbrt 无负零分支歧义。
  const lCubeRoot = Math.cbrt(l);
  const mCubeRoot = Math.cbrt(m);
  const sCubeRoot = Math.cbrt(s);

  // M2 · [l', m', s']，固定左结合。
  return {
    L:
      OKLAB_LMS_TO_LAB[0][0] * lCubeRoot +
      OKLAB_LMS_TO_LAB[0][1] * mCubeRoot +
      OKLAB_LMS_TO_LAB[0][2] * sCubeRoot,
    a:
      OKLAB_LMS_TO_LAB[1][0] * lCubeRoot +
      OKLAB_LMS_TO_LAB[1][1] * mCubeRoot +
      OKLAB_LMS_TO_LAB[1][2] * sCubeRoot,
    b:
      OKLAB_LMS_TO_LAB[2][0] * lCubeRoot +
      OKLAB_LMS_TO_LAB[2][1] * mCubeRoot +
      OKLAB_LMS_TO_LAB[2][2] * sCubeRoot,
  };
}

/**
 * Oklab → 8 位 sRGB。
 * L/a/b 只要求有限；结果超出 sRGB 色域时，逐通道 clamp 到 0–255 后四舍五入。
 */
export function oklabToRgb(ok: Oklab): RGB {
  assertFiniteOklab(ok, "oklabToRgb input");

  // M2⁻¹ · [L, a, b]，固定左结合。
  const lCubeRoot =
    OKLAB_LAB_TO_LMS_CUBE_ROOT[0][0] * ok.L +
    OKLAB_LAB_TO_LMS_CUBE_ROOT[0][1] * ok.a +
    OKLAB_LAB_TO_LMS_CUBE_ROOT[0][2] * ok.b;
  const mCubeRoot =
    OKLAB_LAB_TO_LMS_CUBE_ROOT[1][0] * ok.L +
    OKLAB_LAB_TO_LMS_CUBE_ROOT[1][1] * ok.a +
    OKLAB_LAB_TO_LMS_CUBE_ROOT[1][2] * ok.b;
  const sCubeRoot =
    OKLAB_LAB_TO_LMS_CUBE_ROOT[2][0] * ok.L +
    OKLAB_LAB_TO_LMS_CUBE_ROOT[2][1] * ok.a +
    OKLAB_LAB_TO_LMS_CUBE_ROOT[2][2] * ok.b;

  // 立方用乘法写死（t*t*t，左结合），不用 Math.pow，保证位级可复现。
  const l = lCubeRoot * lCubeRoot * lCubeRoot;
  const m = mCubeRoot * mCubeRoot * mCubeRoot;
  const s = sCubeRoot * sCubeRoot * sCubeRoot;

  // M1⁻¹ · [l, m, s]，固定左结合。
  const linearR =
    OKLAB_LMS_CUBE_TO_LINEAR_SRGB[0][0] * l +
    OKLAB_LMS_CUBE_TO_LINEAR_SRGB[0][1] * m +
    OKLAB_LMS_CUBE_TO_LINEAR_SRGB[0][2] * s;
  const linearG =
    OKLAB_LMS_CUBE_TO_LINEAR_SRGB[1][0] * l +
    OKLAB_LMS_CUBE_TO_LINEAR_SRGB[1][1] * m +
    OKLAB_LMS_CUBE_TO_LINEAR_SRGB[1][2] * s;
  const linearB =
    OKLAB_LMS_CUBE_TO_LINEAR_SRGB[2][0] * l +
    OKLAB_LMS_CUBE_TO_LINEAR_SRGB[2][1] * m +
    OKLAB_LMS_CUBE_TO_LINEAR_SRGB[2][2] * s;

  return {
    r: encodeChannel(linearR),
    g: encodeChannel(linearG),
    b: encodeChannel(linearB),
  };
}
