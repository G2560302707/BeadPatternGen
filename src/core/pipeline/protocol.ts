/**
 * S10 · Worker 消息协议。
 *
 * 落地（写入 UI state）之前必须比对 taskId；不匹配的响应直接丢弃。
 * cells 以 Transferable ArrayBuffer 传递，避免结构化克隆整表拷贝。
 */

import type { DiagnosticReport } from "../quality";
import type { BeadPattern, PatternStats } from "../pattern";
import type { GenerateInput } from "./generate";

export type PipelineStage = "sample" | "subset" | "match" | "dither" | "refine" | "diagnose";

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  sample: "采样",
  subset: "选色",
  match: "匹配",
  dither: "抖动",
  refine: "优化",
  diagnose: "诊断",
};

export interface GenerateWorkerRequest {
  type: "generate";
  taskId: number;
  payload: GenerateInput;
}

export interface CancelWorkerRequest {
  type: "cancel";
  taskId: number;
}

export type WorkerRequest = GenerateWorkerRequest | CancelWorkerRequest;

export interface ProgressWorkerResponse {
  type: "progress";
  taskId: number;
  stage: PipelineStage;
  done: number;
  total: number;
}

export interface DoneWorkerResponse {
  type: "done";
  taskId: number;
  pattern: BeadPattern;
  diagnostic: DiagnosticReport;
  stats: PatternStats;
}

export interface ErrorWorkerResponse {
  type: "error";
  taskId: number;
  code: string;
  message: string;
}

export type WorkerResponse = ProgressWorkerResponse | DoneWorkerResponse | ErrorWorkerResponse;

export interface TransferableMessage {
  message: WorkerResponse;
  transfer: Transferable[];
}

/**
 * 单调递增 taskId 闸门：任何响应在落地前比对 currentTaskId。
 * 校验写在落地这一刻，而不是请求发出时。
 */
export interface MessageGate {
  currentTaskId: number;
  nextTaskId: () => number;
  accept: <T extends { taskId: number }>(message: T) => T | null;
  reset: () => void;
}

export function createMessageGate(startAt = 0): MessageGate {
  let currentTaskId = startAt;
  return {
    get currentTaskId() {
      return currentTaskId;
    },
    nextTaskId() {
      currentTaskId += 1;
      return currentTaskId;
    },
    accept(message) {
      if (message.taskId !== currentTaskId) return null;
      return message;
    },
    reset() {
      currentTaskId = startAt;
    },
  };
}

export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((done / total) * 100)));
}

export function transferableDone(response: DoneWorkerResponse): TransferableMessage {
  return {
    message: response,
    transfer: [response.pattern.cells.buffer],
  };
}
