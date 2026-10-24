/**
 * C4 · 模型加载与缓存（Cache Storage）。
 *
 * 行为：
 * 1. 先查 Cache Storage；命中则直接读字节，不再发请求（离线可用）；
 * 2. 未命中则流式下载，边下边上报字节进度；
 * 3. 下载完成后校验字节数与 SHA-256，再写回缓存；
 * 4. 校验失败删除坏缓存并抛 `E_MODEL_LOAD_FAILED`，下次可重试。
 *
 * Cache Storage 不可用时（隐私模式等）自动降级为纯网络加载，不阻塞功能。
 */

import { SegmentationError } from "../../core/subject/segmentation/errors";

type Bytes = Uint8Array<ArrayBuffer>;

export interface LoadModelBytesOptions {
  url: string;
  cacheName: string;
  /** 期望字节数；用于进度分母与完整性校验。 */
  byteLength?: number;
  /** 期望 SHA-256（小写十六进制）；缺省时只校验字节数。 */
  sha256?: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** 便于测试注入。 */
  fetcher?: typeof fetch;
  /** 便于测试注入；不传时按 `cacheName` 打开全局 Cache Storage。 */
  cache?: Cache | null;
}

function abortError(): SegmentationError {
  return new SegmentationError("E_CANCELLED", "模型加载已取消", true);
}

function isAbort(error: unknown): boolean {
  return (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function readCached(cache: Cache, url: string): Promise<Bytes | null> {
  try {
    const response = await cache.match(url);
    if (!response) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function openCache(name: string): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

async function readStream(
  response: Response,
  total: number,
  onProgress: ((done: number, total: number) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<Bytes> {
  if (response.body === null) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress?.(buffer.byteLength, Math.max(total, buffer.byteLength));
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let reported = 0;
  const step = Math.max(64 * 1024, Math.floor(total / 100) || 64 * 1024);

  for (;;) {
    if (isAborted(signal)) {
      await reader.cancel().catch(() => undefined);
      throw abortError();
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    chunks.push(value);
    received += value.byteLength;
    if (received - reported >= step) {
      reported = received;
      onProgress?.(received, Math.max(total, received));
    }
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.(received, Math.max(total, received));
  return bytes;
}

async function sha256Hex(bytes: Bytes): Promise<string | null> {
  if (typeof crypto === "undefined" || typeof crypto.subtle?.digest !== "function") return null;
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function integrityError(message: string): SegmentationError {
  return new SegmentationError("E_MODEL_LOAD_FAILED", message, true);
}

/** 加载模型字节。抛出的错误统一为 `SegmentationError`。 */
export async function loadModelBytes(options: LoadModelBytesOptions): Promise<Bytes> {
  const { url, cacheName, byteLength, sha256, signal, onProgress } = options;
  const fetcher = options.fetcher ?? fetch;
  const cache = options.cache !== undefined ? options.cache : await openCache(cacheName);

  if (isAborted(signal)) throw abortError();

  if (cache) {
    const cached = await readCached(cache, url);
    if (cached) {
      if (byteLength !== undefined && cached.byteLength !== byteLength) {
        await cache.delete(url).catch(() => undefined);
      } else {
        onProgress?.(cached.byteLength, cached.byteLength);
        return cached;
      }
    }
  }

  const total = byteLength ?? 0;
  let response: Response;
  try {
    response = await fetcher(url, { ...(signal ? { signal } : {}) });
  } catch (error) {
    if (isAbort(error) || isAborted(signal)) throw abortError();
    throw new SegmentationError(
      "E_MODEL_LOAD_FAILED",
      `模型下载失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }

  if (!response.ok) {
    throw new SegmentationError(
      "E_MODEL_LOAD_FAILED",
      `模型下载失败：HTTP ${response.status} ${response.statusText}`,
      true,
    );
  }

  const headerLength = Number(response.headers.get("content-length") ?? 0);
  const expected = total > 0 ? total : Number.isFinite(headerLength) ? headerLength : 0;
  let bytes: Bytes;
  try {
    bytes = await readStream(response, expected, onProgress, signal);
  } catch (error) {
    if (error instanceof SegmentationError) throw error;
    if (isAbort(error) || isAborted(signal)) throw abortError();
    throw new SegmentationError(
      "E_MODEL_LOAD_FAILED",
      `模型读取失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }

  if (byteLength !== undefined && bytes.byteLength !== byteLength) {
    throw integrityError(
      `模型文件大小不符：期望 ${byteLength} 字节，实际 ${bytes.byteLength} 字节。请重新下载。`,
    );
  }

  if (sha256 !== undefined) {
    const actual = await sha256Hex(bytes);
    if (actual !== null && actual !== sha256.toLowerCase()) {
      if (cache) await cache.delete(url).catch(() => undefined);
      throw integrityError("模型文件校验失败（SHA-256 不匹配）。缓存已清除，请重试。");
    }
  }

  if (cache) {
    try {
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      await cache.put(
        url,
        new Response(body, {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(bytes.byteLength),
          },
        }),
      );
    } catch {
      // 缓存失败只是少了离线加速，不影响本次识别。
    }
  }

  return bytes;
}
