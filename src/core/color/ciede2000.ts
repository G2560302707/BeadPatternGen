/**
 * CIEDE2000 色差（kL = kC = kH = 1）与 Oklab 欧氏色差。
 *
 * CIEDE2000 来源：
 * - CIE 142-2001《Improvement to Industrial Colour-Difference Evaluation》。
 * - G. Sharma, W. Wu, E. N. Dalal, "The CIEDE2000 Color-Difference Formula:
 *   Implementation Notes, Supplementary Test Data, and Mathematical Observations",
 *   Color Research & Application 30(1), 2005, pp. 21–30.
 *   本文的 34 组标准测试对用于 VECTORS.md 与 color.test.ts。
 *
 * 色相角约定：以 atan2(b, a′) 计算并归一化到 [0, 360)。
 * 当 C′ = 0 时色相无定义，按 Sharma 等 (2005) §3.2 的约定取 0。
 * Δh′ 与 h̄′ 的 ±360° 回绕按原文公式分支处理，不使用取模“修补”。
 */

import { assertFiniteLab, assertFiniteOklab } from "./types";
import type { Lab, Oklab } from "./types";

/** 明度权重 kL = 1（CIE 142-2001 默认条件）。 */
export const CIEDE2000_KL = 1;

/** 彩度权重 kC = 1（CIE 142-2001 默认条件）。 */
export const CIEDE2000_KC = 1;

/** 色相权重 kH = 1（CIE 142-2001 默认条件）。 */
export const CIEDE2000_KH = 1;

/** 色相回绕判定边界 180°（Sharma 等 2005, 式 (10)–(13)）。 */
export const CIEDE2000_HUE_LIMIT_DEG = 180;

/** 一整圈 360°（色相归一化）。 */
export const CIEDE2000_FULL_TURN_DEG = 360;

/** 25⁷ = 6103515625，用于 G 与 R_C 的 7 次幂项（CIE 142-2001）。 */
export const CIEDE2000_POW25_7 = 6103515625;

/** 角度 → 弧度。来源：π/180 的定义。 */
const DEG_TO_RAD = Math.PI / 180;

/** G 的外层系数 0.5（CIE 142-2001 式 (2)）。 */
const G_MIDPOINT = 0.5;

/** T 的四项系数（Sharma 等 2005, 式 (14)）。 */
const T_WEIGHT_1 = 0.17;
const T_WEIGHT_2 = 0.24;
const T_WEIGHT_3 = 0.32;
const T_WEIGHT_4 = 0.2;

/** T 的四项相位：−30°、0°、+6°、−63°（Sharma 等 2005, 式 (14)）。 */
const T_PHASE_1_DEG = 30;
const T_PHASE_2_MULTIPLIER = 2;
const T_PHASE_3_MULTIPLIER = 3;
const T_PHASE_3_OFFSET_DEG = 6;
const T_PHASE_4_MULTIPLIER = 4;
const T_PHASE_4_OFFSET_DEG = 63;

/** Δθ = 30°·exp(−((h̄′−275°)/25°)²) 的三个参数（CIE 142-2001 式 (19)）。 */
const DELTA_THETA_SCALE_DEG = 30;
const DELTA_THETA_CENTER_DEG = 275;
const DELTA_THETA_WIDTH_DEG = 25;

/** R_C 的外层系数 2（CIE 142-2001 式 (20)）。 */
const R_C_SCALE = 2;

/** S_L 参数：0.015、中心 50、开方内常数 20（CIE 142-2001 式 (16)）。 */
const S_L_SCALE = 0.015;
const S_L_CENTER = 50;
const S_L_RADICAND = 20;

/** S_C 参数 0.045（CIE 142-2001 式 (17)）。 */
const S_C_SCALE = 0.045;

/** S_H 参数 0.015（CIE 142-2001 式 (18)）。 */
const S_H_SCALE = 0.015;

/**
 * 色相角（度），归一化到 [0, 360)。
 * 先 atan2，再除以 DEG_TO_RAD 转为度，最后 +360 后取模；
 * 运算顺序固定，避免不同写法在阈值附近产生末位差异。
 */
function hueAngleDegrees(b: number, aPrime: number): number {
  return (Math.atan2(b, aPrime) / DEG_TO_RAD + CIEDE2000_FULL_TURN_DEG) % CIEDE2000_FULL_TURN_DEG;
}

/**
 * CIEDE2000 色差，kL = kC = kH = 1。
 * 输入分量必须是有限数（否则抛 RangeError）；量纲范围不限。
 */
export function deltaE2000(a: Lab, b: Lab): number {
  assertFiniteLab(a, "deltaE2000 first Lab");
  assertFiniteLab(b, "deltaE2000 second Lab");

  const { L: l1, a: a1, b: b1 } = a;
  const { L: l2, a: a2, b: b2 } = b;

  // 式 (2)–(4)：C*、C̄*、G、a′、C′。
  const c1 = Math.sqrt(a1 * a1 + b1 * b1);
  const c2 = Math.sqrt(a2 * a2 + b2 * b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = G_MIDPOINT * (1 - Math.sqrt(cBar7 / (cBar7 + CIEDE2000_POW25_7)));
  const a1Prime = (1 + g) * a1;
  const a2Prime = (1 + g) * a2;
  const c1Prime = Math.sqrt(a1Prime * a1Prime + b1 * b1);
  const c2Prime = Math.sqrt(a2Prime * a2Prime + b2 * b2);

  // 式 (7)：h′，C′ = 0 时按约定取 0。
  const h1Prime = c1Prime === 0 ? 0 : hueAngleDegrees(b1, a1Prime);
  const h2Prime = c2Prime === 0 ? 0 : hueAngleDegrees(b2, a2Prime);

  // 式 (8)–(10)：ΔL′、ΔC′、Δh′。
  const deltaLPrime = l2 - l1;
  const deltaCPrime = c2Prime - c1Prime;
  let deltaHPrimeDegrees: number;
  if (c1Prime * c2Prime === 0) {
    deltaHPrimeDegrees = 0;
  } else if (Math.abs(h2Prime - h1Prime) <= CIEDE2000_HUE_LIMIT_DEG) {
    deltaHPrimeDegrees = h2Prime - h1Prime;
  } else if (h2Prime - h1Prime > CIEDE2000_HUE_LIMIT_DEG) {
    deltaHPrimeDegrees = h2Prime - h1Prime - CIEDE2000_FULL_TURN_DEG;
  } else {
    deltaHPrimeDegrees = h2Prime - h1Prime + CIEDE2000_FULL_TURN_DEG;
  }

  // 式 (11)：ΔH′ = 2·√(C1′·C2′)·sin(Δh′/2)。
  const deltaHPrime =
    2 * Math.sqrt(c1Prime * c2Prime) * Math.sin((deltaHPrimeDegrees / 2) * DEG_TO_RAD);

  // 式 (12)–(13)：L̄′、C̄′、h̄′。
  const lBarPrime = (l1 + l2) / 2;
  const cBarPrime = (c1Prime + c2Prime) / 2;
  let hBarPrime: number;
  if (c1Prime * c2Prime === 0) {
    hBarPrime = h1Prime + h2Prime;
  } else if (Math.abs(h1Prime - h2Prime) <= CIEDE2000_HUE_LIMIT_DEG) {
    hBarPrime = (h1Prime + h2Prime) / 2;
  } else if (h1Prime + h2Prime < CIEDE2000_FULL_TURN_DEG) {
    hBarPrime = (h1Prime + h2Prime + CIEDE2000_FULL_TURN_DEG) / 2;
  } else {
    hBarPrime = (h1Prime + h2Prime - CIEDE2000_FULL_TURN_DEG) / 2;
  }

  // 式 (14)：T。
  const t =
    1 -
    T_WEIGHT_1 * Math.cos((hBarPrime - T_PHASE_1_DEG) * DEG_TO_RAD) +
    T_WEIGHT_2 * Math.cos(T_PHASE_2_MULTIPLIER * hBarPrime * DEG_TO_RAD) +
    T_WEIGHT_3 * Math.cos((T_PHASE_3_MULTIPLIER * hBarPrime + T_PHASE_3_OFFSET_DEG) * DEG_TO_RAD) -
    T_WEIGHT_4 * Math.cos((T_PHASE_4_MULTIPLIER * hBarPrime - T_PHASE_4_OFFSET_DEG) * DEG_TO_RAD);

  // 式 (19)：Δθ。
  const deltaTheta =
    DELTA_THETA_SCALE_DEG *
    Math.exp(-(((hBarPrime - DELTA_THETA_CENTER_DEG) / DELTA_THETA_WIDTH_DEG) ** 2));

  // 式 (20)：R_C。
  const cBarPrime7 = cBarPrime ** 7;
  const rC = R_C_SCALE * Math.sqrt(cBarPrime7 / (cBarPrime7 + CIEDE2000_POW25_7));

  // 式 (16)–(18)：S_L、S_C、S_H。
  const sLDelta = lBarPrime - S_L_CENTER;
  const sL = 1 + (S_L_SCALE * (sLDelta * sLDelta)) / Math.sqrt(S_L_RADICAND + sLDelta * sLDelta);
  const sC = 1 + S_C_SCALE * cBarPrime;
  const sH = 1 + S_H_SCALE * cBarPrime * t;

  // 式 (21)：R_T。
  const rT = -Math.sin(2 * deltaTheta * DEG_TO_RAD) * rC;

  // 式 (22)：合成。加权项顺序写死为 L → C → H → 交叉项。
  const lightTerm = deltaLPrime / (CIEDE2000_KL * sL);
  const chromaTerm = deltaCPrime / (CIEDE2000_KC * sC);
  const hueTerm = deltaHPrime / (CIEDE2000_KH * sH);
  const squared =
    lightTerm * lightTerm + chromaTerm * chromaTerm + hueTerm * hueTerm + rT * chromaTerm * hueTerm;

  // 理论上 squared ≥ 0（RT ∈ [−√3, 0] 的二次型半正定）；
  // Math.max 仅吸收浮点末位可能产生的 −0 / 负微小值，不改变任何正常结果。
  return Math.sqrt(Math.max(0, squared));
}

/**
 * Oklab 欧氏色差：√(ΔL² + Δa² + Δb²)。
 * 输入分量必须是有限数（否则抛 RangeError）。
 */
export function deltaEOklab(a: Oklab, b: Oklab): number {
  assertFiniteOklab(a, "deltaEOklab first Oklab");
  assertFiniteOklab(b, "deltaEOklab second Oklab");

  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;

  // 累加顺序固定为 L → a → b。
  return Math.sqrt(dL * dL + da * da + db * db);
}
