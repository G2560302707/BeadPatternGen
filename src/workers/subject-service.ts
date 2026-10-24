/**
 * C6 · 主体识别 / 构图预览的浏览器接线。
 *
 * core 层的 `detectSubjects` / `composePreview` 只依赖注入的函数；
 * 这里把真实依赖接上：
 * - 分割：单例 `SegmentationClient`（内部持有 Worker，模型只加载一次）；
 * - 存储：`defaultSubjectRepository`（IndexedDB，主体 / 蒙版 / 构图记录）。
 *
 * UI / feature 层只调用本文件，不直接 new Worker、也不直接开 IDB。
 * 参数与返回值的契约见 `docs/SUBJECT_COMPOSITION_CONTRACT.md` 第 8 章与第 10 章。
 */

import { composePreview } from "../core/composition";
import type { ComposePreviewResult, RgbaImage } from "../core/composition";
import { detectSubjects } from "../core/subject";
import type {
  CompositionParams,
  DetectSubjectsDeps,
  DetectSubjectsResult,
  MaskPostProcessOptions,
  SegmentationRunner,
  Subject,
  SubjectCandidate,
  SubjectProgressEvent,
  SubjectWithMask,
} from "../core/subject";
import { defaultSubjectRepository } from "../storage/subject-repository";
import { SegmentationClient } from "./segmentation-client";

let client: SegmentationClient | null = null;

function segmentationClient(): SegmentationClient {
  if (!client) client = new SegmentationClient();
  return client;
}

/** 与 `SegmentationClient.segment` 同签名；单独抽出便于替换实现 / 测试注入。 */
const runSegmentation: SegmentationRunner = (input, callbacks) =>
  segmentationClient().segment(input, callbacks);

/** S3b · 区域重识别等高级用法直接复用单例 Worker 客户端。 */
export function segmentInBrowser(
  input: Parameters<SegmentationRunner>[0],
  callbacks?: Parameters<SegmentationRunner>[1],
): Promise<SubjectCandidate[]> {
  return segmentationClient().segment(input, callbacks);
}

export interface DetectSubjectsInBrowserOptions {
  /** 原图 id（UI 侧稳定值），主体记录以它为 `sourceImageId`。 */
  sourceImageId: string;
  imageBytes: Uint8Array;
  mimeType: string;
  modelId?: string;
  maxCandidates?: number;
  /** UI 任务号；只用于给进度事件打标，与 Worker 内部 taskId 无关。 */
  taskId?: number;
  /** 是否落库，缺省 true；`false` 用于预览 / 测试。 */
  persist?: boolean;
  /** 重新识别时先删除同一 `sourceImageId` 的旧主体（含蒙版 Blob）。 */
  replaceExisting?: boolean;
  postProcess?: MaskPostProcessOptions;
  onProgress?: (event: SubjectProgressEvent) => void;
  /** 注入分割实现（mock / 测试）；缺省走 onnx Worker。 */
  segment?: SegmentationRunner;
}

/**
 * `detectSubjects(image)` 的浏览器实现：
 * Worker 推理 → C2 后处理 → C1 落库 → 返回 `Subject[]`（含后处理后的候选）。
 */
export async function detectSubjectsInBrowser(
  options: DetectSubjectsInBrowserOptions,
): Promise<DetectSubjectsResult> {
  const persist = options.persist !== false;
  // 只有需要落库时才打开数据库：预览 / 测试模式不依赖 IndexedDB。
  const repo = persist ? defaultSubjectRepository.get() : null;

  const deps: DetectSubjectsDeps = {
    segment: options.segment ?? runSegmentation,
    ...(repo ? { saveSubject: (subject, mask) => repo.saveSubject(subject, mask) } : {}),
    ...(repo
      ? {
          listSubjects: (sourceImageId) => repo.listSubjects(sourceImageId),
          removeSubject: (subjectId) => repo.removeSubject(subjectId),
        }
      : {}),
    ...(options.postProcess === undefined ? {} : { postProcess: options.postProcess }),
    ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  };

  return detectSubjects(
    {
      sourceImageId: options.sourceImageId,
      imageBytes: options.imageBytes,
      mimeType: options.mimeType,
      ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
      ...(options.maxCandidates === undefined ? {} : { maxCandidates: options.maxCandidates }),
      ...(options.persist === undefined ? {} : { persist: options.persist }),
      ...(options.replaceExisting === undefined
        ? {}
        : { replaceExisting: options.replaceExisting }),
    },
    deps,
  );
}

export interface ComposePreviewInBrowserOptions {
  subjectId: string;
  params: CompositionParams;
  /** 原图 RGBA；尺寸必须与主体蒙版一致。 */
  source: RgbaImage;
  backgroundImage?: RgbaImage;
  /** 更新已有构图时复用 id / 创建时间。 */
  compositionId?: string;
  createdAt?: string;
  /** 是否保存构图参数，缺省 true。 */
  persist?: boolean;
}

/**
 * `composePreview(subjectId, composition)` 的浏览器实现：
 * C1 读取主体 → C3 合成 →（可选）C1 保存构图参数。
 *
 * 合成像素不落库：UI 直接用返回的 `image` 上屏。
 */
export async function composePreviewInBrowser(
  options: ComposePreviewInBrowserOptions,
): Promise<ComposePreviewResult> {
  const repo = defaultSubjectRepository.get();
  const persist = options.persist !== false;

  return composePreview(
    {
      subjectId: options.subjectId,
      params: options.params,
      source: options.source,
      ...(options.backgroundImage === undefined
        ? {}
        : { backgroundImage: options.backgroundImage }),
      ...(options.compositionId === undefined ? {} : { compositionId: options.compositionId }),
      ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    },
    {
      loadSubject: (subjectId) => repo.loadSubject(subjectId),
      ...(persist ? { saveComposition: (composition) => repo.saveComposition(composition) } : {}),
    },
  );
}

/** 某张原图已保存的主体（只读元数据，不含蒙版）。 */
export function listSubjectsForImage(sourceImageId: string): Promise<Subject[]> {
  return defaultSubjectRepository.get().listSubjects(sourceImageId);
}

/** 某张原图已保存的主体（含蒙版），供再导入时跳过分割。 */
export async function loadSubjectsWithMasksForImage(
  sourceImageId: string,
): Promise<SubjectWithMask[]> {
  const repo = defaultSubjectRepository.get();
  const listed = await repo.listSubjects(sourceImageId);
  const loaded = [];
  for (const item of listed) {
    loaded.push(await repo.loadSubject(item.id));
  }
  return loaded;
}

function newMaskId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `mask-${Date.now().toString(36)}`;
}

/**
 * 把当前会话里改过的蒙版写回 IndexedDB（画笔 / 确认前）。
 * 尚无记录时新建主体，这样手绘 / 首次确认也能走 `composePreview`。
 */
export async function persistSubjectMaskInBrowser(candidate: SubjectCandidate): Promise<boolean> {
  const repo = defaultSubjectRepository.get();
  try {
    let maskId = newMaskId();
    let createdAt = candidate.createdAt;
    let confidence = candidate.confidence;
    let label = candidate.label;
    try {
      const existing = await repo.loadSubject(candidate.id);
      maskId = existing.maskId;
      createdAt = existing.createdAt;
      confidence = existing.confidence;
      label = existing.label;
    } catch {
      /* 新建 */
    }
    await repo.saveSubject(
      {
        id: candidate.id,
        sourceImageId: candidate.sourceImageId,
        maskId,
        bbox: candidate.bbox,
        confidence,
        label,
        createdAt,
      },
      candidate.mask,
    );
    return true;
  } catch {
    return false;
  }
}

/** 取消当前识别；Promise 会以 `E_CANCELLED` 拒绝，UI 应静默忽略。 */
export function cancelSubjectDetectionInBrowser(): void {
  client?.cancel();
}

/** 终止 Worker 并释放资源（模型权重随 Worker 一起回收）。 */
export function disposeSubjectDetectionInBrowser(): void {
  client?.dispose();
  client = null;
}
