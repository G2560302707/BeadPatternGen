/**
 * C6 · 主体识别的核心装配（纯逻辑，无 DOM）。
 *
 * 把 C4 的分割结果串上 C2 的蒙版后处理与 C1 的落库，形成文档第 8 章定义的
 * `detectSubjects(image) → Subject[]`：
 *
 * ```text
 * SegmentationClient.segment()        # C4，Worker 内完成模型推理
 *   → postProcessMask(candidate.mask) # C2，去噪 / 填孔 / bbox / 羽化
 *   → saveSubject(subject, mask)      # C1，元数据 + 蒙版 Blob
 * ```
 *
 * 浏览器依赖（Worker、IndexedDB）通过 `deps` 注入；core 层不 import
 * `src/workers` 或 `src/storage`，因此本函数可以在 Node 中做确定性回归。
 * 生产接线见 `src/workers/subject-service.ts`。
 *
 * 候选 id 直接复用为 `Subject.id`：UI 用候选 id 选中主体后，可以零映射地
 * 找到已落库记录。蒙版使用独立 id，避免与主体 id 撞键。
 */

import { isSubjectCandidate } from "./guards";
import { postProcessMask } from "./mask";
import type { MaskPostProcessOptions, MaskPostProcessResult } from "./mask";
import {
  SubjectIntegrationError,
  wrapSubjectIntegrationError,
  type SubjectProgressEvent,
} from "./protocol";
import { SUBJECT_LABEL_MAIN } from "./types";
import type {
  SegmentationInput,
  SegmentationProgressResponse,
  Subject,
  SubjectCandidate,
  SubjectMask,
} from "./types";

/** 与 `SegmentationClient.segment()` 结构一致的回调。 */
export interface SegmentationRunnerCallbacks {
  onProgress?: (progress: SegmentationProgressResponse) => void;
}

/**
 * 分割执行器。生产实现是 `SegmentationClient.segment`，
 * 测试可直接返回构造好的候选，不需要 onnxruntime。
 */
export type SegmentationRunner = (
  input: SegmentationInput,
  callbacks?: SegmentationRunnerCallbacks,
) => Promise<SubjectCandidate[]>;

export interface DetectSubjectsInput {
  /** 原图 id；用作所有候选 / 主体的 `sourceImageId`。 */
  sourceImageId: string;
  /** 原图原始编码字节（PNG / JPEG / WebP），可被 Worker 解码。 */
  imageBytes: Uint8Array;
  mimeType: string;
  modelId?: string;
  /** 候选数量上限；二期只做单主体，默认由 Worker 决定（1）。 */
  maxCandidates?: number;
  /** 是否落库；缺省 true（前提是提供了 `saveSubject`）。 */
  persist?: boolean;
  /**
   * 落库前先删除同一 `sourceImageId` 的旧主体（含蒙版 Blob）。
   * 缺省 false：重复识别会累积新记录。UI 的「重新识别」应传 true。
   */
  replaceExisting?: boolean;
}

export interface DetectSubjectsDeps {
  /** 必填：C4 分割入口。 */
  segment: SegmentationRunner;
  /** 可选：C1 落库入口；不传则只检测、不写库（预览 / 测试模式）。 */
  saveSubject?: (subject: Subject, mask: SubjectMask) => Promise<Subject>;
  /** 可选：删除旧主体，仅在 `replaceExisting: true` 时调用（需配合 `listSubjects`）。 */
  listSubjects?: (sourceImageId: string) => Promise<Subject[]>;
  removeSubject?: (subjectId: string) => Promise<void>;
  /** C2 后处理参数；缺省使用保守默认值。 */
  postProcess?: MaskPostProcessOptions;
  /** 消息协议里的 taskId，用于 UI 过滤过期事件；缺省 0。 */
  taskId?: number;
  /** 进度回调，阶段含 C2 的 `mask-cleanup` 与 C1 的 `persist`。 */
  onProgress?: (event: SubjectProgressEvent) => void;
  /** 主体 / 蒙版 id 生成；测试可注入固定值。 */
  createId?: () => string;
  /** 时间戳；测试可注入固定值。 */
  now?: () => string;
}

/** 单个候选的后处理统计，便于日志与诊断。 */
export interface CandidatePostProcessReport {
  candidateId: string;
  removedComponents: number;
  filledPixels: number;
}

export interface DetectSubjectsResult {
  sourceImageId: string;
  /** 后处理后的候选（含完整蒙版），UI 可直接叠加渲染。 */
  candidates: SubjectCandidate[];
  /** 已落库的主体元数据；`persist: false` 或无 `saveSubject` 时为空数组。 */
  subjects: Subject[];
  /** 每个成功候选的后处理统计。 */
  postProcessed: CandidatePostProcessReport[];
  /** 后处理阶段被丢弃的候选数（整块被去噪清除）。 */
  droppedCandidates: number;
  /** `replaceExisting: true` 时被删除的旧主体；缺省为空数组。 */
  replaced: Subject[];
}

function defaultCreateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `subject-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function assertInput(input: DetectSubjectsInput): void {
  if (typeof input.sourceImageId !== "string" || input.sourceImageId.length === 0) {
    throw new SubjectIntegrationError("E_INPUT_INVALID", "sourceImageId 不能为空", false);
  }
  if (!(input.imageBytes instanceof Uint8Array) || input.imageBytes.byteLength === 0) {
    throw new SubjectIntegrationError("E_INPUT_INVALID", "图片字节为空或类型不正确", false);
  }
  if (typeof input.mimeType !== "string" || input.mimeType.length === 0) {
    throw new SubjectIntegrationError("E_INPUT_INVALID", "mimeType 不能为空", false);
  }
  if (
    input.maxCandidates !== undefined &&
    (!Number.isInteger(input.maxCandidates) || input.maxCandidates < 1)
  ) {
    throw new SubjectIntegrationError("E_INPUT_INVALID", "maxCandidates 必须是正整数", false);
  }
}

function toSegmentationInput(input: DetectSubjectsInput): SegmentationInput {
  return {
    sourceImageId: input.sourceImageId,
    imageBytes: input.imageBytes,
    mimeType: input.mimeType,
    ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    ...(input.maxCandidates === undefined ? {} : { maxCandidates: input.maxCandidates }),
  };
}

async function runDetect(
  input: DetectSubjectsInput,
  deps: DetectSubjectsDeps,
): Promise<DetectSubjectsResult> {
  assertInput(input);

  const taskId = deps.taskId ?? 0;
  const createId = deps.createId ?? defaultCreateId;
  const now = deps.now ?? (() => new Date().toISOString());
  const emit = (stage: SubjectProgressEvent["stage"], done: number, total: number): void => {
    deps.onProgress?.({ taskId, stage, done, total });
  };

  let rawCandidates: SubjectCandidate[];
  try {
    rawCandidates = await deps.segment(toSegmentationInput(input), {
      onProgress: (progress) => emit(progress.stage, progress.done, progress.total),
    });
  } catch (error) {
    throw wrapSubjectIntegrationError(error);
  }

  if (rawCandidates.length === 0) {
    throw new SubjectIntegrationError("E_NO_SUBJECT", "没有找到主体", true);
  }

  const shouldPersist = input.persist !== false && deps.saveSubject !== undefined;
  const candidates: SubjectCandidate[] = [];
  const subjects: Subject[] = [];
  const postProcessed: CandidatePostProcessReport[] = [];
  let droppedCandidates = 0;
  /** `replaceExisting` 生效时被清掉的旧主体，随结果返回便于调用方确认。 */
  const replaced: Subject[] = [];

  if (shouldPersist && input.replaceExisting === true) {
    if (!deps.listSubjects || !deps.removeSubject) {
      throw new SubjectIntegrationError(
        "E_INPUT_INVALID",
        "replaceExisting 需要同时提供 listSubjects 与 removeSubject",
        false,
      );
    }
    try {
      const existing = await deps.listSubjects(input.sourceImageId);
      for (const previous of existing) {
        await deps.removeSubject(previous.id);
        replaced.push(previous);
      }
    } catch (error) {
      throw wrapSubjectIntegrationError(error);
    }
  }

  emit("mask-cleanup", 0, rawCandidates.length);
  if (shouldPersist) emit("persist", 0, rawCandidates.length);
  for (const [index, candidate] of rawCandidates.entries()) {
    if (!isSubjectCandidate(candidate)) {
      throw new SubjectIntegrationError(
        "E_SUBJECT_INVALID",
        `候选 ${String(index)} 不满足 SubjectCandidate 契约`,
        false,
      );
    }
    if (candidate.sourceImageId !== input.sourceImageId) {
      throw new SubjectIntegrationError(
        "E_SUBJECT_INVALID",
        `候选来源图 ${candidate.sourceImageId} 与当前原图 ${input.sourceImageId} 不一致`,
        false,
      );
    }

    let processed: MaskPostProcessResult;
    try {
      processed = postProcessMask(candidate.mask, deps.postProcess ?? {});
    } catch (error) {
      throw wrapSubjectIntegrationError(error);
    }

    if (processed.bbox === null) {
      // 整块前景都被当作噪点清除：该候选没有可拼的主体，丢弃。
      droppedCandidates += 1;
    } else {
      const next: SubjectCandidate = {
        ...candidate,
        mask: processed.mask,
        bbox: processed.bbox,
      };
      candidates.push(next);
      postProcessed.push({
        candidateId: candidate.id,
        removedComponents: processed.removedComponents,
        filledPixels: processed.filledPixels,
      });

      if (shouldPersist && deps.saveSubject) {
        const subject: Subject = {
          id: candidate.id,
          sourceImageId: input.sourceImageId,
          maskId: createId(),
          bbox: processed.bbox,
          confidence: candidate.confidence,
          label: candidate.label.length > 0 ? candidate.label : SUBJECT_LABEL_MAIN,
          createdAt: now(),
        };
        try {
          subjects.push(await deps.saveSubject(subject, processed.mask));
        } catch (error) {
          throw wrapSubjectIntegrationError(error);
        }
        emit("persist", subjects.length, rawCandidates.length);
      }
    }

    emit("mask-cleanup", index + 1, rawCandidates.length);
  }

  if (candidates.length === 0) {
    throw new SubjectIntegrationError(
      "E_NO_SUBJECT",
      "后处理后没有剩余的主体像素，请换一张主体更清晰的图片",
      true,
    );
  }

  return {
    sourceImageId: input.sourceImageId,
    candidates,
    subjects,
    postProcessed,
    droppedCandidates,
    replaced,
  };
}

/**
 * 执行一次完整的主体识别。
 *
 * @throws {SubjectIntegrationError} 输入非法 / 无主体 / 后处理失败 / 落库失败。
 */
export async function detectSubjects(
  input: DetectSubjectsInput,
  deps: DetectSubjectsDeps,
): Promise<DetectSubjectsResult> {
  try {
    return await runDetect(input, deps);
  } catch (error) {
    throw wrapSubjectIntegrationError(error);
  }
}
