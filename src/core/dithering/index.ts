/**
 * S07 · 确定性抖动 —— 公共出口。
 *
 * 目录之外只应通过 "./core/dithering"（或 "@/core/dithering"）导入。
 * 扩散系数、遍历顺序等实现细节刻意不导出，避免上层绕过 floydSteinberg
 * 自行拼装出第二套「近似实现」。
 */

export type { DitherOptions, DitherResult } from "./types";
export { floydSteinberg } from "./floyd-steinberg";
