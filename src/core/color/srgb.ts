/**
 * sRGB 传递函数（非线性编码 ↔ 线性光）。
 *
 * 来源：IEC 61966-2-1:1999《Multimedia systems and equipment —
 * Colour measurement and management — Part 2-1: Default RGB colour space — sRGB》，
 * 第 6.5 节 / 附录 A 的分段定义：
 *
 *   解码（encoded → linear）：
 *     C_lin = C/12.92                        , C ≤ 0.04045
 *     C_lin = ((C + 0.055) / 1.055) ^ 2.4     , C > 0.04045
 *
 *   编码（linear → encoded）：
 *     C = 12.92 · C_lin                       , C_lin ≤ 0.0031308
 *     C = 1.055 · C_lin ^ (1/2.4) − 0.055     , C_lin > 0.0031308
 *
 * 输入域策略见 types.ts：非有限数或越界一律抛 RangeError，不做静默 clamp。
 */

import { SRGB_UNIT_MAX, SRGB_UNIT_MIN, assertUnitInterval } from "./types";

/** 线性段斜率 12.92（IEC 61966-2-1:1999 §6.5）。 */
export const SRGB_LINEAR_SEGMENT_SLOPE = 12.92;

/** 伽马段缩放 1.055（IEC 61966-2-1:1999 §6.5）。 */
export const SRGB_GAMMA_SCALE = 1.055;

/** 伽马段偏移 0.055（IEC 61966-2-1:1999 §6.5）。 */
export const SRGB_GAMMA_OFFSET = 0.055;

/** 伽马指数 2.4（IEC 61966-2-1:1999 §6.5）。 */
export const SRGB_GAMMA_EXPONENT = 2.4;

/** 逆伽马指数 1/2.4（由 2.4 直接推导）。 */
export const SRGB_INVERSE_GAMMA_EXPONENT = 1 / 2.4;

/** 编码域分段阈值 0.04045（IEC 61966-2-1:1999 §6.5）。 */
export const SRGB_ENCODED_THRESHOLD = 0.04045;

/** 线性域分段阈值 0.0031308（IEC 61966-2-1:1999 §6.5）。 */
export const SRGB_LINEAR_THRESHOLD = 0.0031308;

/**
 * 非线性 sRGB 编码值 → 线性光。
 * 输入必须有限且位于 [0, 1]；否则抛 RangeError。
 */
export function srgbToLinear(c: number): number {
  assertUnitInterval(c, "srgbToLinear input");
  if (c <= SRGB_ENCODED_THRESHOLD) {
    // 固定求值顺序：先除法，单独返回，避免与伽马分支共享中间变量。
    return c / SRGB_LINEAR_SEGMENT_SLOPE;
  }
  return Math.pow((c + SRGB_GAMMA_OFFSET) / SRGB_GAMMA_SCALE, SRGB_GAMMA_EXPONENT);
}

/**
 * 线性光 → 非线性 sRGB 编码值，输出保证位于 [0, 1]。
 * 输入必须有限且位于 [0, 1]；否则抛 RangeError。
 *
 * 末尾 clamp 的原因：规格要求输出严格位于 0–1。实际在 c = 1 时
 * 1.055·1 − 0.055 因二进制舍入得到 0.9999999999999999；clamp 不改变该值，
 * 但可保证将来常量调整或极端输入下输出域不被突破（对 c = 0 无影响）。
 */
export function linearToSrgb(c: number): number {
  assertUnitInterval(c, "linearToSrgb input");
  const encoded =
    c <= SRGB_LINEAR_THRESHOLD
      ? c * SRGB_LINEAR_SEGMENT_SLOPE
      : SRGB_GAMMA_SCALE * Math.pow(c, SRGB_INVERSE_GAMMA_EXPONENT) - SRGB_GAMMA_OFFSET;
  if (encoded < SRGB_UNIT_MIN) return SRGB_UNIT_MIN;
  if (encoded > SRGB_UNIT_MAX) return SRGB_UNIT_MAX;
  return encoded;
}
