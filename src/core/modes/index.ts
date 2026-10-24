/**
 * S09 · 四模式策略与局部优化 —— 公共出口。
 *
 * 目录之外只应通过 "./core/modes"（或 "@/core/modes"）导入。
 * 内部实现文件名（profiles.ts / refine.ts）不是公共契约，便于后续替换。
 */

export type { DitheringMode, ImageMode, ModeProfile, RefineOptions } from "./types";
export { getModeProfile } from "./profiles";
export { refineLocally, scoreCandidate } from "./refine";
export type { CandidateScoreTerms } from "./refine";
