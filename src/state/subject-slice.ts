/**
 * C6 · 主体识别 / 智能构图的 store 切片契约。
 *
 * UI 只在 `workspace-store` 里绑定这些字段，不再各自定义状态形状。
 * 这里只定义类型、默认值与纯函数默认值工厂，不引入 React / Zustand。
 *
 * 大数组约定（见 `docs/SUBJECT_COMPOSITION_CONTRACT.md`）：
 * - `subjectCandidates` 携带完整蒙版，仅用于当前会话的叠加渲染；
 * - 落库后的 `Subject` 元数据由 `src/storage/subject-repository.ts` 管理，
 *   不放进响应式 state。
 */

import type { RgbaImage } from "../core/composition";
import type { CompositionParams, SubjectCandidate, SubjectPipelineStage } from "../core/subject";
import { DEFAULT_COMPOSITION_PARAMS } from "../core/subject";
import { editingParams } from "../features/composition-workbench/layout";
import type { AspectPreset, PositionPreset } from "../features/composition-workbench/layout";

export type SubjectDetectStatus = "idle" | "running" | "success" | "error";

export interface SubjectProgressState {
  status: SubjectDetectStatus;
  taskId: number;
  /** 完整链路阶段：C4 四段 + C2 `mask-cleanup` + C1 `persist`。 */
  stage: SubjectPipelineStage | null;
  done: number;
  total: number;
  message: string;
}

export interface SubjectErrorState {
  code: string;
  message: string;
  recoverable: boolean;
}

/** 主体识别切片。 */
export interface SubjectSliceState {
  subjectProgress: SubjectProgressState;
  subjectError: SubjectErrorState | null;
  subjectCandidates: SubjectCandidate[];
  selectedSubjectId: string | null;
  manualBoxHint: boolean;
}

/** 构图切片（参数可序列化；合成像素不进入 state）。 */
export interface CompositionSliceState {
  compositionParams: CompositionParams;
  compositionAspect: AspectPreset;
  compositionPosition: PositionPreset;
  compositionBackgroundImage: RgbaImage | null;
}

export const IDLE_SUBJECT_PROGRESS: Readonly<SubjectProgressState> = Object.freeze({
  status: "idle",
  taskId: 0,
  stage: null,
  done: 0,
  total: 0,
  message: "",
});

/** 每次重置都返回新对象，避免多个 store 更新共享同一个可变数组。 */
export function createSubjectSlice(): SubjectSliceState {
  return {
    subjectProgress: { ...IDLE_SUBJECT_PROGRESS },
    subjectError: null,
    subjectCandidates: [],
    selectedSubjectId: null,
    manualBoxHint: false,
  };
}

export function createCompositionSlice(): CompositionSliceState {
  return {
    compositionParams: editingParams(DEFAULT_COMPOSITION_PARAMS),
    compositionAspect: "square",
    compositionPosition: "center",
    compositionBackgroundImage: null,
  };
}

/** 图片会话 id：主体记录以它为 `sourceImageId`。 */
export function createImageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
