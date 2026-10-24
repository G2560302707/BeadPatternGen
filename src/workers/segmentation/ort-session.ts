/**
 * C4 · onnxruntime-web 适配器（Worker 边界）。
 *
 * - 默认 WASM 执行提供者；检测到 WebGPU 且调用方开启时优先 WebGPU；
 * - WebGPU 创建失败或推理时崩溃会自动回退 WASM（只回退一次）；
 * - 没有 COOP/COEP 时强制单线程，避免 SharedArrayBuffer 不可用导致初始化失败；
 * - wasm 资源路径指向 `/ort/`，由 `pnpm ort:sync` 从 node_modules 复制。
 */

import * as ort from "onnxruntime-web";
import { SegmentationError } from "../../core/subject/segmentation/errors";
import type {
  SegmentationModelSpec,
  SegmentationSession,
} from "../../core/subject/segmentation/types";

export interface CreateOrtSessionOptions {
  /** 部署 base，必须以 `/` 结尾。 */
  baseUrl: string;
  /** 是否尝试 WebGPU（失败自动回退 WASM）。 */
  preferWebGPU?: boolean;
}

let configuredBaseUrl: string | null = null;

/** 配置全局 ORT 环境；重复调用只在 baseUrl 变化时重设 wasm 路径。 */
export function configureOrt(baseUrl: string): void {
  if (configuredBaseUrl !== baseUrl) {
    ort.env.wasm.wasmPaths = `${baseUrl}ort/`;
    configuredBaseUrl = baseUrl;
  }

  const isolated = typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : false;
  const cores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 4;
  // 多线程 wasm 需要 SharedArrayBuffer => 需要 COOP/COEP。没有隔离时退回单线程。
  ort.env.wasm.numThreads = isolated ? Math.max(1, Math.min(4, cores)) : 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = "error";
}

function canUseWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

async function createSession(
  bytes: Uint8Array,
  providers: readonly "webgpu"[] | readonly "wasm"[],
): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(bytes, {
    executionProviders: providers as unknown as ort.InferenceSession.ExecutionProviderConfig[],
    graphOptimizationLevel: "all",
  });
}

function selectOutput(
  session: ort.InferenceSession,
  results: ort.InferenceSession.OnnxValueMapType,
  outputIndex: number,
): Float32Array {
  const names = session.outputNames;
  const index = outputIndex >= 0 && outputIndex < names.length ? outputIndex : 0;
  const name = names[index];
  if (name === undefined) {
    throw new SegmentationError("E_MODEL_UNSUPPORTED", "模型没有输出张量", false);
  }
  const tensor = results[name];
  if (!tensor || !(tensor.data instanceof Float32Array)) {
    throw new SegmentationError(
      "E_MODEL_UNSUPPORTED",
      "模型输出不是 float32 张量，当前仅支持 u2net 家族的显著性输出",
      false,
    );
  }
  return tensor.data;
}

/**
 * 创建可复用的推理会话。会话创建失败统一抛 `E_MODEL_LOAD_FAILED`。
 */
export async function createOrtSession(
  bytes: Uint8Array,
  model: SegmentationModelSpec,
  options: CreateOrtSessionOptions,
): Promise<SegmentationSession> {
  configureOrt(options.baseUrl);

  let active: ort.InferenceSession;
  let provider: "wasm" | "webgpu" = "wasm";

  if (options.preferWebGPU === true && canUseWebGPU()) {
    try {
      active = await createSession(bytes, ["webgpu"]);
      provider = "webgpu";
    } catch {
      active = await createWasmSession(bytes);
    }
  } else {
    active = await createWasmSession(bytes);
  }

  const inputName = model.inputName ?? active.inputNames[0];
  if (inputName === undefined) {
    await active.release().catch(() => undefined);
    throw new SegmentationError("E_MODEL_UNSUPPORTED", "模型没有输入张量", false);
  }

  let disposed = false;

  return {
    get provider() {
      return provider;
    },
    async run(input: Float32Array): Promise<Float32Array> {
      if (disposed) throw new SegmentationError("E_INFERENCE_FAILED", "推理会话已释放", false);
      const expected = 3 * model.inputWidth * model.inputHeight;
      if (input.length !== expected) {
        throw new SegmentationError(
          "E_INPUT_INVALID",
          `模型输入长度应为 ${expected}，实际为 ${input.length}`,
          false,
        );
      }
      const tensor = new ort.Tensor("float32", input, [1, 3, model.inputHeight, model.inputWidth]);
      try {
        const results = await active.run({ [inputName]: tensor });
        return selectOutput(active, results, model.outputIndex);
      } catch (error) {
        if (provider === "webgpu") {
          // 设备丢失 / 驱动问题：回退 WASM 并重试一次。
          console.warn("[segmentation] WebGPU 推理失败，已回退 WASM 重试");
          await active.release().catch(() => undefined);
          active = await createWasmSession(bytes);
          provider = "wasm";
          const results = await active.run({ [inputName]: tensor });
          return selectOutput(active, results, model.outputIndex);
        }
        if (error instanceof SegmentationError) throw error;
        throw new SegmentationError(
          "E_INFERENCE_FAILED",
          `推理失败：${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await active.release().catch(() => undefined);
    },
  };
}

async function createWasmSession(bytes: Uint8Array): Promise<ort.InferenceSession> {
  try {
    return await createSession(bytes, ["wasm"]);
  } catch (error) {
    throw new SegmentationError(
      "E_MODEL_LOAD_FAILED",
      `模型初始化失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
}
