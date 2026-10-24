/**
 * S10 · 生成会话：Worker、进度、取消、taskId 落地闸门。
 */

import { createMessageGate, PIPELINE_STAGE_LABELS, progressPercent } from "../core/pipeline";
import type { GenerateInput, WorkerResponse } from "../core/pipeline";
import { lockedPalette, lockedPaletteColors } from "../features/palette-panel/locked-palette";
import { useWorkspaceStore } from "./workspace-store";

const gate = createMessageGate();
let worker: Worker | null = null;
let disposed = false;
/** R7 · 当前任务发起时刻（performance.now），用于状态栏真实耗时。 */
let startedAt = 0;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/generate.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    landResponse(event.data);
  };
  worker.onerror = (event) => {
    if (disposed) return;
    useWorkspaceStore.getState().setError({
      code: "E_WORKER",
      message: event.message || "生成 Worker 失败",
    });
    useWorkspaceStore.getState().setGeneration({
      status: "error",
      taskId: gate.currentTaskId,
      stage: null,
      done: 0,
      total: 0,
      message: event.message || "生成 Worker 失败",
      elapsedMs: null,
    });
  };
  return worker;
}

function landResponse(message: WorkerResponse): void {
  if (disposed) return;
  const accepted = gate.accept(message);
  if (accepted === null) return;

  const store = useWorkspaceStore.getState();
  if (message.type === "progress") {
    store.setGeneration({
      status: "running",
      taskId: message.taskId,
      stage: message.stage,
      done: message.done,
      total: message.total,
      message: `${PIPELINE_STAGE_LABELS[message.stage]} ${progressPercent(message.done, message.total)}%`,
      elapsedMs: startedAt > 0 ? performance.now() - startedAt : null,
    });
    return;
  }

  if (message.type === "error") {
    if (message.code === "E_CANCELLED") {
      store.setGeneration({
        status: "idle",
        taskId: message.taskId,
        stage: null,
        done: 0,
        total: 0,
        message: "",
        elapsedMs: null,
      });
      return;
    }
    store.setError({ code: message.code, message: message.message });
    store.setGeneration({
      status: "error",
      taskId: message.taskId,
      stage: null,
      done: 0,
      total: 0,
      message: message.message,
      elapsedMs: null,
    });
    return;
  }

  const elapsedMs = startedAt > 0 ? performance.now() - startedAt : null;
  store.applyGenerated(message.pattern, message.diagnostic, message.stats, elapsedMs);
}

export function startGeneration(): void {
  const state = useWorkspaceStore.getState();
  if (!state.sample || !state.image || !state.crop) {
    state.setError({ code: "E_NO_SAMPLE", message: "请先应用裁剪并采样，再生成图纸。" });
    return;
  }
  if (state.generation.status === "running") {
    ensureWorker().postMessage({ type: "cancel", taskId: gate.currentTaskId });
  }

  const taskId = gate.nextTaskId();
  const rgb = new Uint8ClampedArray(state.sample.rgb);
  const alpha = new Uint8Array(state.sample.alpha);
  const payload: GenerateInput = {
    rgb,
    alpha,
    width: state.sample.width,
    height: state.sample.height,
    palette: lockedPaletteColors(),
    paletteId: lockedPalette.paletteId,
    paletteVersion: lockedPalette.version,
    maxColors: state.maxColors,
    mode: state.mode,
    dithering: state.dithering,
    colorMetric: state.colorMetric,
    transparentPolicy: state.alphaPolicy,
    ditherStrength: 1,
    source: {
      originalWidth: state.image.width,
      originalHeight: state.image.height,
      aspectRatio: state.image.width / state.image.height,
      crop: {
        x: state.crop.x,
        y: state.crop.y,
        width: state.crop.width,
        height: state.crop.height,
      },
    },
    title: state.image.fileName,
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `pattern-${taskId}`,
  };
  if (state.alphaPolicy === "background") {
    payload.backgroundHex = state.backgroundHex;
  }

  disposed = false;
  startedAt = performance.now();
  state.clearError();
  state.clearGenerated();
  state.setGeneration({
    status: "running",
    taskId,
    stage: "sample",
    done: 0,
    total: state.sample.width * state.sample.height,
    message: `${PIPELINE_STAGE_LABELS.sample} 0%`,
    elapsedMs: null,
  });
  ensureWorker().postMessage({ type: "generate", taskId, payload }, [
    payload.rgb.buffer,
    payload.alpha.buffer,
  ]);
}

export function cancelGeneration(): void {
  const taskId = gate.currentTaskId;
  worker?.postMessage({ type: "cancel", taskId });
  gate.nextTaskId();
  const store = useWorkspaceStore.getState();
  store.clearGenerated();
  store.setGeneration({
    status: "idle",
    taskId: gate.currentTaskId,
    stage: null,
    done: 0,
    total: 0,
    message: "",
    elapsedMs: null,
  });
}

export function disposeGeneration(): void {
  disposed = true;
  worker?.terminate();
  worker = null;
}
