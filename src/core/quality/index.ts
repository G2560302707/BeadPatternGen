/**
 * S08 质量诊断包对外入口。
 *
 * 只暴露可解释的计数与位置：没有「质量评分」「还原度」这类无可靠定义的数字。
 * 本包无外部依赖，也不修改传入的 PatternView。
 */

export {
  DEFAULT_HIGH_DELTA_THRESHOLD,
  DEFAULT_MAX_FRAGMENT_SIZE,
  DEFAULT_MIN_THIN_RUN,
  DEFAULT_QUALITY_OPTIONS,
  EMPTY_CELL,
} from "./types";
export type { DiagnosticReport, FragmentInfo, PatternView, ThinRunInfo } from "./types";
export { findIsolated } from "./isolated";
export { findFragments } from "./fragments";
export { findThinRuns } from "./thin-runs";
export { buildReport } from "./report";
