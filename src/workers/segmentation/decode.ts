/**
 * C4 · Worker 内图片解码（DOM / OffscreenCanvas 边界）。
 *
 * 主线程只传原始编码字节，避免在响应式 state 中持有整张位图；
 * Worker 内用 `createImageBitmap` 解码，再用 `OffscreenCanvas` 读出 RGBA。
 */

import { SegmentationError } from "../../core/subject/segmentation/errors";
import type { RgbaImage } from "../../core/subject/segmentation/types";

/** 解码图片字节为 RGBA。失败统一抛 `E_INPUT_INVALID`。 */
export async function decodeImageToRgba(bytes: Uint8Array, mimeType: string): Promise<RgbaImage> {
  if (bytes.byteLength === 0) {
    throw new SegmentationError("E_INPUT_INVALID", "图片字节为空", false);
  }
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    throw new SegmentationError(
      "E_MODEL_UNSUPPORTED",
      "当前浏览器不支持 OffscreenCanvas / createImageBitmap，无法在 Worker 内识别主体",
      false,
    );
  }

  let bitmap: ImageBitmap;
  try {
    // 复制成独立的 ArrayBuffer：Blob 不接受可能指向 SharedArrayBuffer 的视图。
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    const blob = new Blob([body], { type: mimeType || "application/octet-stream" });
    bitmap = await createImageBitmap(blob);
  } catch (error) {
    throw new SegmentationError(
      "E_INPUT_INVALID",
      `图片解码失败：${error instanceof Error ? error.message : String(error)}`,
      false,
    );
  }

  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (width < 1 || height < 1) {
      throw new SegmentationError("E_INPUT_INVALID", "图片尺寸为空", false);
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new SegmentationError(
        "E_MODEL_UNSUPPORTED",
        "无法创建 OffscreenCanvas 2D 上下文",
        false,
      );
    }
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, width, height);
    return { width, height, data: imageData.data };
  } finally {
    bitmap.close();
  }
}
