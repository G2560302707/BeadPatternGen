/**
 * S08 质量诊断：公共类型、空格哨兵与默认阈值。
 *
 * 自包含约束：本目录的实现文件不 import 本目录之外的任何模块。
 * EMPTY_CELL 必须与 src/core/pattern/limits.ts 中的 EMPTY_CELL 保持同值（-1）；
 * 这里重复声明是为了让 quality 包可以脱离 S03 独立编译与测试。
 */

export interface PatternView {
  width: number;
  height: number;
  cells: Int16Array;
}

export interface FragmentInfo {
  size: number;
  cells: number[];
}
export interface ThinRunInfo {
  row: number;
  col: number;
  length: number;
  orientation: "h" | "v";
}

export interface DiagnosticReport {
  isolated: number[]; // 孤立豆格索引，升序
  fragments: FragmentInfo[]; // 小碎片，按 size 升序、同 size 按最小索引升序
  thinRuns: ThinRunInfo[]; // 细线风险，按 row、col 升序
  highDelta: number[]; // 高色差格索引，升序
  nonEmptyCells: number;
}

/**
 * 空格哨兵。cells 中只有严格等于 -1 的值被视为空格。
 * 来源：src/core/pattern/limits.ts 的 EMPTY_CELL（图纸编码约定）。
 */
export const EMPTY_CELL = -1 as const;

/**
 * 小型碎片上限。来源：TECHNICAL_SPEC 4.6「小型碎片：连通分量大小 ≤ 2 的区域」。
 * 仅作为默认值；buildReport 的阈值始终由调用方显式传入。
 */
export const DEFAULT_MAX_FRAGMENT_SIZE = 2;

/**
 * 细线游程下限。来源：经验值。5 mm 拼豆上宽度小于 3 格、且两侧被异色包围的
 * 单豆游程难以稳定成型，因此默认把长度 1–2 的游程列为风险。
 */
export const DEFAULT_MIN_THIN_RUN = 3;

/**
 * 高色差阈值（CIEDE2000 ΔE）。来源：经验值。CIEDE2000 的 JND 约为 2.3，
 * 但拼豆受珠体、光照与色卡离散化影响，取 10 作为「明显可辨」的保守工程值。
 * 该值需要后续用基准图校准，本模块不把它包装成「还原度」百分比。
 */
export const DEFAULT_HIGH_DELTA_THRESHOLD = 10;

/** 默认诊断参数组合，便于调用方与测试共享同一组具名常量。 */
export const DEFAULT_QUALITY_OPTIONS = {
  maxFragmentSize: DEFAULT_MAX_FRAGMENT_SIZE,
  minThinRun: DEFAULT_MIN_THIN_RUN,
  highDeltaThreshold: DEFAULT_HIGH_DELTA_THRESHOLD,
} as const;

/**
 * 校验 PatternView 的形状并返回单元格总数 width * height。
 *
 * 诊断函数假设 cells 长度与网格一致（S03 的 validatePattern 已保证这一点）。
 * 这里做一次 O(1) 防御性检查，避免越界读取伪装成「非空格」而产生不可解释的结果。
 */
export function assertViewShape(p: PatternView): number {
  const { width, height, cells } = p;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`quality: invalid view dimensions ${width}x${height}`);
  }
  const n = width * height;
  if (cells.length !== n) {
    throw new RangeError(`quality: cells.length ${cells.length} !== width*height ${n}`);
  }
  return n;
}
