/**
 * S04 颜色科学内核公共出口。
 *
 * 本目录之外只应通过 "./core/color"（或 "@/core/color"）导入，
 * 不要直接依赖内部文件名，便于后续替换实现。
 */

export type { ColorMetricName, Lab, Mat3, Oklab, RGB } from "./types";

export {
  RGB_CHANNEL_MAX,
  RGB_CHANNEL_MIN,
  RGB_CHANNEL_SCALE,
  SRGB_UNIT_MAX,
  SRGB_UNIT_MIN,
  assertFiniteLab,
  assertFiniteNumber,
  assertFiniteOklab,
  assertRgb,
  assertUnitInterval,
  clampToUnit,
} from "./types";

export {
  SRGB_ENCODED_THRESHOLD,
  SRGB_GAMMA_EXPONENT,
  SRGB_GAMMA_OFFSET,
  SRGB_GAMMA_SCALE,
  SRGB_INVERSE_GAMMA_EXPONENT,
  SRGB_LINEAR_SEGMENT_SLOPE,
  SRGB_LINEAR_THRESHOLD,
  linearToSrgb,
  srgbToLinear,
} from "./srgb";

export {
  CIE_LAB_EPSILON,
  CIE_LAB_KAPPA,
  D65_WHITE_X,
  D65_WHITE_Y,
  D65_WHITE_Z,
  LAB_A_SCALE,
  LAB_B_SCALE,
  LAB_LIGHTNESS_OFFSET,
  LAB_LIGHTNESS_SCALE,
  SRGB_TO_XYZ_D65,
  XYZ_D65_TO_SRGB_LINEAR,
  labToRgb,
  rgbToLab,
} from "./lab";

export {
  OKLAB_LAB_TO_LMS_CUBE_ROOT,
  OKLAB_LINEAR_SRGB_TO_LMS,
  OKLAB_LMS_CUBE_TO_LINEAR_SRGB,
  OKLAB_LMS_TO_LAB,
  oklabToRgb,
  rgbToOklab,
} from "./oklab";

export {
  CIEDE2000_FULL_TURN_DEG,
  CIEDE2000_HUE_LIMIT_DEG,
  CIEDE2000_KC,
  CIEDE2000_KH,
  CIEDE2000_KL,
  CIEDE2000_POW25_7,
  deltaE2000,
  deltaEOklab,
} from "./ciede2000";

export { hexToRgb, rgbToHex } from "./hex";
