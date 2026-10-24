/**
 * S09 · 四模式策略与局部优化 —— 公共类型。
 *
 * 字段名与函数签名由拆解文档逐字固定，不得重命名、增删或调整顺序。
 *
 * 关于 `ImageMode`：
 * - 规格要求本目录只允许 import `../color` 与 `../palette`，因此这里**重复声明**
 *   `ImageMode`，而不是从 `../pattern` 导入。
 * - 它与 `src/core/pattern/types.ts` 中的 `ImageMode` 是同一个字符串联合类型，
 *   结构完全相容，调用方可以互相赋值，不存在运行时耦合。
 */

import type { ColorMetricName } from "../color";
import type { BeadColor, PaletteIndex } from "../palette";

/**
 * 图片处理模式。
 * 与规格 5.1 的 `ImageMode` 保持逐字一致；新增值必须先改规格再改这里。
 */
export type ImageMode = "photo" | "anime" | "logo" | "landscape";

/** 抖动模式。默认一律 "none"；仅 photo / landscape 允许用户手动开启。 */
export type DitheringMode = "none" | "floyd-steinberg";

/**
 * 单模式的可调策略。
 *
 * 所有“色差”类参数的数值单位都跟随 `RefineOptions.metric`：
 * - `ciede2000`：CIEDE2000，常用范围 0–100；
 * - `oklab`：Oklab 欧氏距离，常用范围 0–1。
 *
 * `profiles.ts` 的默认值按 CIEDE2000 标定；切换 metric 时需要同步缩放，
 * 详见 PARAMS.md。这里不在运行时自动换算，避免把“度量选择”藏进隐式策略。
 */
export interface ModeProfile {
  defaultDithering: "none" | "floyd-steinberg";
  /** false 表示 UI 必须禁用抖动开关；anime / logo 为 false。 */
  allowUserDithering: boolean;
  /** 边缘保护强度：权重越大，边缘格越不愿意改色。 */
  edgeProtectWeight: number;
  /** 孤立点惩罚：权重越大，越倾向于把孤立豆合并到邻近色。 */
  isolatedPenalty: number;
  /** ΔE 小于该值的当前色 / 候选色视为可合并。 */
  colorMergeThreshold: number;
  /** 局部优化迭代轮数；0 表示完全关闭局部优化。 */
  localRefinePasses: number;
  /** 每格参与比较的邻近色卡数量（不含当前色；当前色总会保留）。 */
  neighborCandidateCount: number;
}

/**
 * `refineLocally` 的入参。
 *
 * 槽位约定：
 * - `cells[i] === -1` 表示空格；其它值必须是 `palette` 的合法下标。
 * - `perCellDelta[i]` 是**原始采样色到当前色**的 ΔE，而不是到候选色的 ΔE。
 *   本模块用它计算候选色的保守（上界）保真度，见 refine.ts 的目标函数说明。
 * - `edgeStrength[i]` 由调用方（S08/S10 的结构分析）提供，0–1。
 *
 * 不修改任何入参数组；返回值是新分配的 `Int16Array`。
 */
export interface RefineOptions {
  width: number;
  height: number;
  cells: Int16Array;
  palette: readonly BeadColor[];
  index: PaletteIndex;
  metric: ColorMetricName;
  perCellDelta: Float32Array;
  edgeStrength: Float32Array;
  profile: ModeProfile;
}
