/**
 * S09 · 四模式默认策略。
 *
 * 规格 4.4 的硬约束（逐条对齐 docs/TECHNICAL_SPEC.md）：
 *
 * | 模式       | 默认抖动 | 用户可否开启 | 优化重点                     |
 * |------------|----------|--------------|------------------------------|
 * | photo      | none     | 可以         | 五官、明暗层次               |
 * | anime      | none     | 不可以       | 描边、眼睛高光、色块边界     |
 * | logo       | none     | 不可以       | 文字、几何边缘、透明背景     |
 * | landscape  | none     | 可以         | 天空 / 水面渐变、大面积区域  |
 *
 * 数值默认值全部按 **CIEDE2000** 的色差单位标定（见 PARAMS.md §1）。
 * 目标函数是：
 *
 *   score = ΔE(cell, candidate)
 *         + isolatedPenalty   · 该候选是否让格子变成 4-邻域孤立
 *         + edgeProtectWeight · edgeStrength · 该格子是否改色
 *
 * 因而一次“修复孤立豆”的改色要成立，需要
 *
 *   ΔE(当前色, 候选色) + edgeProtectWeight·edgeStrength < isolatedPenalty
 *
 * 四个模式就是围绕这个不等式给出不同的保守程度：
 * - photo：中等保护，允许修复孤立点，但不牺牲五官附近的边缘；
 * - anime：边缘保护权重高于孤立点惩罚，描边格基本不改色；
 * - logo：最保守，只允许色差极小、且不在边缘上的合并；
 * - landscape：边缘保护最弱、孤立点惩罚最强，优先消除渐变中的杂点。
 *
 * 这些是**保守起点**，不是审美结论；调参方法与禁止事项见 PARAMS.md。
 */

import type { ImageMode, ModeProfile } from "./types";

/**
 * photo：照片 / 人物 / 宠物。
 *
 * - 边缘权重 3：五官附近的单格改色要先付出 3 ΔE 的代价；
 * - 孤立惩罚 6：允许把 ΔE < 6 的孤立豆并入邻色；
 * - 合并阈值 5：只合并肉眼较接近的颜色，避免吃掉眼睛高光；
 * - 2 轮：常规照片在 1–2 轮内即可到达不动点；
 * - 8 个候选：规格默认值。
 */
const PHOTO_PROFILE: ModeProfile = Object.freeze({
  defaultDithering: "none",
  allowUserDithering: true,
  edgeProtectWeight: 3,
  isolatedPenalty: 6,
  colorMergeThreshold: 5,
  localRefinePasses: 2,
  neighborCandidateCount: 8,
});

/**
 * anime：二次元角色。
 *
 * - 边缘权重 6 高于孤立惩罚 5：即使能修复孤立点，边缘格也不会改色
 *   （5 − 6·edgeStrength < ΔE，edgeStrength = 1 时无解），保住描边；
 * - 合并阈值 4：色块内部允许小幅合并，但不穿越明显的色块边界；
 * - 强制关闭抖动，避免碎点破坏色块。
 */
const ANIME_PROFILE: ModeProfile = Object.freeze({
  defaultDithering: "none",
  allowUserDithering: false,
  edgeProtectWeight: 6,
  isolatedPenalty: 5,
  colorMergeThreshold: 4,
  localRefinePasses: 3,
  neighborCandidateCount: 8,
});

/**
 * logo：图标 / 文字 / 透明 PNG。
 *
 * - 最保守：合并阈值 2，只合并几乎同色的色卡；
 * - 边缘权重 8 远高于孤立惩罚 3，硬边与字母完全不参与改色；
 * - 空格 (-1) 永远不参与优化，透明背景不会被填色。
 */
const LOGO_PROFILE: ModeProfile = Object.freeze({
  defaultDithering: "none",
  allowUserDithering: false,
  edgeProtectWeight: 8,
  isolatedPenalty: 3,
  colorMergeThreshold: 2,
  localRefinePasses: 2,
  neighborCandidateCount: 8,
});

/**
 * landscape：天空 / 山脉 / 水面。
 *
 * - 孤立惩罚 8：最积极消除大面积渐变中的单格杂点；
 * - 合并阈值 6：允许较大范围的邻近色合并，减少色带颗粒；
 * - 边缘权重 2.5：仍保留山脊 / 建筑轮廓，但弱于 photo；
 * - 允许用户手动开启 FS 抖动（默认仍是 none）。
 */
const LANDSCAPE_PROFILE: ModeProfile = Object.freeze({
  defaultDithering: "none",
  allowUserDithering: true,
  edgeProtectWeight: 2.5,
  isolatedPenalty: 8,
  colorMergeThreshold: 6,
  localRefinePasses: 3,
  neighborCandidateCount: 8,
});

/**
 * 返回指定模式的默认策略。
 *
 * 返回值是冻结对象：调用方若要局部调参，请自行 `{ ...getModeProfile(mode), ... }`
 * 复制一份，禁止修改共享默认值（否则同一次生成中的其它格子会读到被污染的权重）。
 *
 * 运行时校验 mode：类型系统之外的调用方（JS / 反序列化参数）也必须被挡住，
 * 未知模式一律抛 RangeError，绝不回退到 photo。
 */
export function getModeProfile(mode: ImageMode): ModeProfile {
  switch (mode) {
    case "photo":
      return PHOTO_PROFILE;
    case "anime":
      return ANIME_PROFILE;
    case "logo":
      return LOGO_PROFILE;
    case "landscape":
      return LANDSCAPE_PROFILE;
    default:
      throw new RangeError(
        `getModeProfile expected "photo" | "anime" | "logo" | "landscape"; received ${String(mode)}`,
      );
  }
}
