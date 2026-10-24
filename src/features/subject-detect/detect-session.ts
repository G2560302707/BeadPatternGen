/**
 * 主体识别会话：taskId 闸门 + mock/真实数据源切换。
 *
 * 真实与 mock 都走 C6 `detectSubjectsInBrowser()`：
 * 分割（onnx 或 mock runner）→ C2 后处理 → C1 落库。
 * mock 只替换分割来源，落库 / 构图与生产一致。
 */

import { createMessageGate, type MessageGate } from "../../core/pipeline";
import {
  SEGMENTATION_STAGE_LABELS,
  SUBJECT_PIPELINE_STAGE_LABELS,
  wrapSubjectIntegrationError,
  type DetectSubjectsResult,
  type SubjectProgressEvent,
} from "../../core/subject";
import { useWorkspaceStore } from "../../state/workspace-store";
import type { ImageSession } from "../../state/workspace-store";
import {
  cancelSubjectDetectionInBrowser,
  detectSubjectsInBrowser,
  disposeSubjectDetectionInBrowser,
} from "../../workers/subject-service";
import { imageIdFor, segmentationInputFor } from "./image-input";
import { createMockSegmentationRunner } from "./mock-detect";
import { tryRestoreSubjects } from "./restore";
import { USE_MOCK_DETECTION } from "./source";

const gate: MessageGate = createMessageGate();
let disposed = false;

function isCurrentTask(taskId: number): boolean {
  if (disposed) return false;
  return useWorkspaceStore.getState().subjectProgress.taskId === taskId;
}

function landProgress(event: SubjectProgressEvent): void {
  if (!isCurrentTask(event.taskId)) return;
  const total = Math.max(1, event.total);
  useWorkspaceStore.getState().setSubjectProgress({
    status: "running",
    taskId: event.taskId,
    stage: event.stage,
    done: event.done,
    total: event.total,
    message: `${SUBJECT_PIPELINE_STAGE_LABELS[event.stage]} ${Math.round((event.done / total) * 100)}%`,
  });
}

function landResult(taskId: number, result: DetectSubjectsResult): void {
  if (!isCurrentTask(taskId)) return;
  const store = useWorkspaceStore.getState();
  if (result.candidates.length === 0) {
    store.setSubjectError({
      code: "E_NO_SUBJECT",
      message: "没有找到主体。可手动框选（占位）或按整图继续。",
      recoverable: true,
    });
    store.setImportPhase("ready");
    return;
  }
  store.setSubjectCandidates(result.candidates);
  store.setImportPhase("ready");
}

function fail(taskId: number, error: unknown): void {
  const wrapped = wrapSubjectIntegrationError(error);
  if (wrapped.code === "E_CANCELLED") return;
  if (!isCurrentTask(taskId)) return;
  useWorkspaceStore.getState().setSubjectError({
    code: wrapped.code,
    message: wrapped.message,
    recoverable: wrapped.recoverable,
  });
  useWorkspaceStore.getState().setImportPhase("ready");
}

async function runDetection(
  taskId: number,
  image: ImageSession,
  replaceExisting: boolean,
): Promise<void> {
  try {
    const sourceImageId = image.sourceImageId || imageIdFor(image);
    const prepared =
      image.sourceBytes && image.sourceMimeType
        ? { bytes: image.sourceBytes, mimeType: image.sourceMimeType }
        : await segmentationInputFor(image);
    if (!isCurrentTask(taskId)) return;

    const result = await detectSubjectsInBrowser({
      sourceImageId,
      imageBytes: prepared.bytes,
      mimeType: prepared.mimeType,
      taskId,
      replaceExisting,
      onProgress: landProgress,
      ...(USE_MOCK_DETECTION
        ? { segment: createMockSegmentationRunner(image.width, image.height) }
        : {}),
    });
    landResult(taskId, result);
  } catch (error) {
    fail(taskId, error);
  }
}

/** 同一张图识别过几次：0 = 首次（导入后自动识别），≥1 = 用户点「重新识别」。 */
const detectionRuns = new WeakMap<ImageSession, number>();

/** 导入后：能从 IndexedDB 恢复则跳过分割，否则走识别。 */
export function restoreOrDetectSubjects(): void {
  const store = useWorkspaceStore.getState();
  const image = store.image;
  if (!image) {
    store.setError({ code: "E_NO_IMAGE", message: "请先导入图片再识别主体。" });
    return;
  }
  store.setImportPhase("detecting");
  void (async () => {
    try {
      if (await tryRestoreSubjects(image)) {
        detectionRuns.set(image, 1);
        return;
      }
    } catch {
      /* 库未就绪或记录损坏：重新识别 */
    }
    startSubjectDetection();
  })();
}

export function startSubjectDetection(): void {
  const store = useWorkspaceStore.getState();
  const image = store.image;
  if (!image) {
    store.setError({ code: "E_NO_IMAGE", message: "请先导入图片再识别主体。" });
    return;
  }

  disposed = false;
  const taskId = gate.nextTaskId();
  const runs = detectionRuns.get(image) ?? 0;
  detectionRuns.set(image, runs + 1);

  store.resetSubject();
  store.setImportPhase("detecting");
  store.setSubjectProgress({
    status: "running",
    taskId,
    stage: "load-model",
    done: 0,
    total: 4,
    message: USE_MOCK_DETECTION
      ? SEGMENTATION_STAGE_LABELS["load-model"]
      : "准备识别输入…",
  });

  void runDetection(taskId, image, runs > 0);
}

export function cancelSubjectDetection(): void {
  gate.nextTaskId();
  cancelSubjectDetectionInBrowser();
  useWorkspaceStore.getState().resetSubject();
}

export function disposeSubjectDetection(): void {
  disposed = true;
  gate.nextTaskId();
  disposeSubjectDetectionInBrowser();
}
