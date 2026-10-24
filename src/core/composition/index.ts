/**
 * S11 · C3 构图引擎 —— 公共出口。
 *
 * 目录之外只应通过 `./core/composition`（或 `@/core/composition`）导入。
 */

export type {
  ComposeInput,
  ComposeResult,
  CompositionErrorCode,
  CompositionOverflow,
  CompositionPlan,
  CompositionPositionOffset,
  CompositionRect,
  CompositionSuggestion,
  RgbaData,
  RgbaImage,
} from "./types";
export {
  COMPOSITION_ALGORITHM_VERSION,
  COMPOSITION_POSITION_PRESETS,
  CompositionError,
} from "./types";
export { computeCompositionPlan } from "./geometry";
export { composeImage } from "./compose";
/** C6：composePreview 组装（主体读取 → 合成 → 构图参数落库）。 */
export type { ComposePreviewDeps, ComposePreviewInput, ComposePreviewResult } from "./preview";
export { composePreview } from "./preview";
