import { findFragments } from "./fragments";
import { findIsolated } from "./isolated";
import { findThinRuns } from "./thin-runs";
import { EMPTY_CELL, assertViewShape } from "./types";
import type { DiagnosticReport, PatternView } from "./types";

/**
 * 汇总一次只读质量诊断。
 *
 * perCellDelta 约定：长度必须为 width * height；空格位置的值被忽略。
 * 高色差判定为严格大于阈值（perCellDelta[i] > highDeltaThreshold），等于阈值不算。
 *
 * 浮点确定性：本模块不对 ΔE 做任何求和、求平均或排序，只做逐格的一次比较，
 * 因此不存在浮点累加顺序问题，也不会产生末位误差导致的回归抖动。NaN 的比较结果
 * 恒为 false，会被安全跳过；±Infinity 按 IEEE-754 正常比较。
 *
 * 本函数不修改 p.cells 或 perCellDelta，只返回索引与计数，不产生任何评分百分比。
 */
export function buildReport(
  p: PatternView,
  perCellDelta: Float32Array, // 长度 = width*height，空格位置忽略
  options: { maxFragmentSize: number; minThinRun: number; highDeltaThreshold: number },
): DiagnosticReport {
  const n = assertViewShape(p);
  if (perCellDelta.length !== n) {
    throw new RangeError(
      `quality: perCellDelta.length ${perCellDelta.length} !== width*height ${n}`,
    );
  }

  const { cells } = p;
  const highDelta: number[] = [];
  let nonEmptyCells = 0;

  // 单次升序扫描：highDelta 与 nonEmptyCells 天然有序。
  for (let index = 0; index < n; index += 1) {
    const cell = cells[index];
    if (cell === undefined || cell === EMPTY_CELL) {
      continue;
    }
    nonEmptyCells += 1;

    const delta = perCellDelta[index];
    if (delta !== undefined && delta > options.highDeltaThreshold) {
      highDelta.push(index);
    }
  }

  return {
    isolated: findIsolated(p),
    fragments: findFragments(p, options.maxFragmentSize),
    thinRuns: findThinRuns(p, options.minThinRun),
    highDelta,
    nonEmptyCells,
  };
}
