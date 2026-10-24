/**
 * S07 · 确定性抖动 —— 公共类型。
 *
 * 字段名与 `floydSteinberg` 的参数顺序由拆解文档逐字固定，不得重命名。
 * 本文件不包含任何实现，只有两个数据结构。
 */

import type { ColorMetricName } from "../color";

export interface DitherOptions {
  /** 0–1，误差扩散强度的缩放系数，默认 1。 */
  strength: number;
  /**
   * 色差度量名。
   *
   * 由调用方保证与构建 `PaletteIndex` 时使用的 metric 一致；
   * `PaletteIndex` 接口不暴露自身 metric，抖动层无法在运行时反查，
   * 因此这里只做合法性校验（"ciede2000" | "oklab"），不做一致性断言。
   */
  metric: ColorMetricName;
}

export interface DitherResult {
  /** 长度 = width*height；-1 表示空格。 */
  indices: Int16Array;
  /** 全部被丢弃的边界误差绝对值之和，用于诊断。 */
  residualError: number;
}
