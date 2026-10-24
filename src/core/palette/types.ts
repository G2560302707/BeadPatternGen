/**
 * S05 · 色卡索引与最近邻匹配 —— 公共类型、错误模型与输入守卫。
 *
 * 错误模型：本模块所有**可预期**的失败都抛 PaletteError，并携带
 * 机器可读的 code（PaletteErrorCode）。消息里同时回显出问题的色号、
 * 下标或原始 hex，便于上层日志定位。绝不静默返回空数组、-1 或兜底颜色。
 *
 * 输入域策略（与 S04 一致，全包唯一策略：抛错）：
 * - RGB 采样必须是有限数且每个通道位于 [0, 255]；
 * - 色卡 hex 必须能被 S04 的 hexToRgb 解析（恰好 "#RGB" 或 "#RRGGBB"）；
 * - 同一色卡内 code 必须唯一（hex 允许重复：不同色号可能是同一实测色）。
 *
 * 选择“抛错”而不是“输入 clamp”的原因：索引层是抖动与配色优化的唯一入口，
 * 静默容错会把坏数据伪装成合法色号，最终导致用户买到错误颜色的豆子。
 */

import type { ColorMetricName, RGB } from "../color";

/** 8 位 sRGB 通道下限。来源：IEC 61966-2-1:1999 的 8 位量化域。 */
export const SAMPLE_CHANNEL_MIN = 0;

/** 8 位 sRGB 通道上限。来源：IEC 61966-2-1:1999 的 8 位量化域。 */
export const SAMPLE_CHANNEL_MAX = 255;

/** Spec 5.1 色卡条目；字段名不得重命名。 */
export interface BeadColor {
  code: string;
  name: string;
  hex: string;
  manufacturer: string;
  series?: string;
}

/** nearest() 的返回值。index 是构建时入参数组的下标，不是色号。 */
export interface PaletteMatch {
  index: number;
  distance: number;
}

/**
 * 只读色卡索引。构建后内部缓存不可变，可安全在多次查询间共享。
 *
 * size：色卡颜色数。
 * nearest：返回候选集合中距离最近的颜色；距离完全相等时取更小的 index。
 */
export interface PaletteIndex {
  readonly size: number;
  nearest(color: RGB, candidates?: readonly number[]): PaletteMatch;
}

/** 全部可预期错误码；断言用常量字符串，避免测试依赖错误消息文案。 */
export type PaletteErrorCode =
  | "EMPTY_PALETTE"
  | "INVALID_PALETTE_ENTRY"
  | "INVALID_HEX"
  | "DUPLICATE_CODE"
  | "INVALID_METRIC"
  | "INVALID_SAMPLE"
  | "EMPTY_SAMPLES"
  | "INVALID_MAX_COLORS"
  | "INVALID_CANDIDATES"
  | "INVALID_CANDIDATE_INDEX";

/**
 * 带机器可读 code 的错误。
 * 继承 Error 以保留堆栈；name 固定为 "PaletteError"，便于日志过滤。
 */
export class PaletteError extends Error {
  readonly code: PaletteErrorCode;

  constructor(code: PaletteErrorCode, message: string) {
    super(message);
    this.name = "PaletteError";
    this.code = code;
  }
}

/** 断言单个通道是有限数且在 [0, 255]。 */
function assertSampleChannel(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PaletteError(
      "INVALID_SAMPLE",
      `${label} must be a finite number; received ${String(value)}`,
    );
  }
  if (value < SAMPLE_CHANNEL_MIN || value > SAMPLE_CHANNEL_MAX) {
    throw new PaletteError(
      "INVALID_SAMPLE",
      `${label} must be within [${SAMPLE_CHANNEL_MIN}, ${SAMPLE_CHANNEL_MAX}]; received ${value}`,
    );
  }
}

/**
 * 断言样本是合法 8 位 RGB。
 * label 由调用方给出（例如 "nearest(color)" 或 "samples[17].r"），
 * 保证错误能定位到具体查询 / 样本下标。
 */
export function assertSampleColor(color: RGB, label: string): void {
  if (color === null || typeof color !== "object") {
    throw new PaletteError(
      "INVALID_SAMPLE",
      `${label} must be an object with r/g/b channels; received ${String(color)}`,
    );
  }
  assertSampleChannel(color.r, `${label}.r`);
  assertSampleChannel(color.g, `${label}.g`);
  assertSampleChannel(color.b, `${label}.b`);
}

/**
 * 运行时校验 metric。
 * 类型系统已限定 ColorMetricName；此守卫只防御 JS 调用方或反序列化数据。
 */
export function assertColorMetricName(metric: ColorMetricName): void {
  if (metric !== "ciede2000" && metric !== "oklab") {
    throw new PaletteError(
      "INVALID_METRIC",
      `metric must be "ciede2000" or "oklab"; received ${String(metric)}`,
    );
  }
}
